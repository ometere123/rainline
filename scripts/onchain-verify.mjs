// Standalone on-chain verification script for Rainline's payable write path.
//
// The `genlayer` CLI's `write` command hardcodes `value: 0n`, so it cannot exercise
// `buy_policy`, which is `@gl.public.write.payable` and requires real GEN attached. This
// script uses genlayer-js directly to send a real payable buy_policy transaction against
// StudioNet, wait for it to finalize, and print the resulting state so the outcome can be
// recorded as real proof (not simulated) in the README.
//
// Signing key resolution, in order:
//   1. RAINLINE_PK env var (0x-prefixed hex private key)
//   2. a local V3 keystore file (path + password as argv[2], argv[3])
//   3. a freshly generated key (StudioNet is gasless with simulated balances)
// The key is never written to stdout or logs.
//
// The insured event is env-overridable so the claim path can be pointed at a real,
// independently verifiable historical weather event rather than a synthetic window:
//   RL_LOCATION, RL_LAT, RL_LON, RL_THRESHOLD, RL_START, RL_END, RL_PREMIUM_GEN,
//   RL_PAYOUT_GEN, RL_PERIL, RL_CLAIM_ATTEMPTS
//
// Usage:
//   node scripts/onchain-verify.mjs [keystorePath] [keystorePassword] [buy|claim|both] [policyId]

import { readFileSync, existsSync } from "node:fs";
import crypto from "node:crypto";
import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...value] = trimmed.split("=");
    process.env[key] ??= value.join("=");
  }
}

function decryptKeystore(path, password) {
  const ks = JSON.parse(readFileSync(path, "utf8"));
  const c = ks.Crypto || ks.crypto;
  const kdf = c.kdfparams;
  const derivedKey = crypto.scryptSync(Buffer.from(password, "utf8"), Buffer.from(kdf.salt, "hex"), kdf.dklen, {
    N: kdf.n,
    r: kdf.r,
    p: kdf.p,
    maxmem: 1024 * 1024 * 1024,
  });
  const ciphertext = Buffer.from(c.ciphertext, "hex");
  const decipher = crypto.createDecipheriv("aes-128-ctr", derivedKey.subarray(0, 16), Buffer.from(c.cipherparams.iv, "hex"));
  const privateKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return "0x" + privateKey.toString("hex");
}

const [, , keystorePath, keystorePassword, mode = "both", explicitPolicyId] = process.argv;

let privateKey;
if (process.env.RAINLINE_PK) {
  privateKey = process.env.RAINLINE_PK;
  console.log("Key source: RAINLINE_PK env var");
} else if (keystorePath && keystorePassword) {
  privateKey = decryptKeystore(keystorePath, keystorePassword);
  console.log("Key source: keystore file");
} else {
  privateKey = generatePrivateKey();
  console.log("Key source: freshly generated (StudioNet is gasless / balances simulated)");
}

const account = createAccount(privateKey);
const address = process.env.NEXT_PUBLIC_RAINLINE_CONTRACT;
const endpoint = process.env.NEXT_PUBLIC_GENLAYER_ENDPOINT ?? "https://studio.genlayer.com/api";

if (!address) {
  console.error("NEXT_PUBLIC_RAINLINE_CONTRACT is not set in .env.local");
  process.exit(1);
}

const client = createClient({ chain: studionet, endpoint, account });

async function waitAndReport(label, hash) {
  console.log(`[${label}] tx hash: ${hash}`);
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: "FINALIZED",
    interval: 5000,
    retries: 100,
  });
  console.log(`[${label}] status: ${receipt.status_name ?? receipt.status}`);
  return receipt;
}

async function main() {
  console.log("Account:", account.address);
  console.log("Contract:", address);

  let policyId = explicitPolicyId;

  if (mode === "buy" || mode === "both") {
    const GEN = 10n ** 18n;
    // Defaults describe Hurricane Harvey over Houston, 26-29 Aug 2017: an event both
    // independent APIs record as catastrophic (ERA5 ~143mm, NASA POWER ~237mm on 27 Aug)
    // and one of the most heavily documented storms on record, so all three evidence legs
    // can be checked against reality by anyone reviewing this.
    const peril = process.env.RL_PERIL ?? "RAIN";
    const location = process.env.RL_LOCATION ?? "Houston, Texas, US";
    const lat = process.env.RL_LAT ?? "29.76";
    const lon = process.env.RL_LON ?? "-95.37";
    const threshold =
      process.env.RL_THRESHOLD ??
      "More than 100mm of rainfall in any single 24h window during the coverage period counts as a qualifying flood loss.";
    const start = process.env.RL_START ?? "2017-08-26T00:00:00Z";
    const end = process.env.RL_END ?? "2017-08-29T00:00:00Z";
    const premium = BigInt(process.env.RL_PREMIUM_GEN ?? "100") * GEN;
    const payout = BigInt(process.env.RL_PAYOUT_GEN ?? "20") * GEN;

    console.log("\n--- buy_policy (payable, real GEN value) ---");
    console.log(`Insured event: ${peril} at ${location} (${lat}, ${lon}) ${start} -> ${end}`);
    console.log(`Premium ${premium / GEN} GEN, payout ${payout / GEN} GEN`);

    const hash = await client.writeContract({
      address,
      functionName: "buy_policy",
      args: [peril, location, lat, lon, threshold, start, end, payout],
      value: premium,
    });
    await waitAndReport("buy_policy", hash);

    const summary = await client.readContract({ address, functionName: "get_summary", args: [] });
    console.log("get_summary after buy_policy:", summary);

    const listing = await client.readContract({
      address,
      functionName: "list_policies_by_holder",
      args: [account.address, 0n, 5n],
    });
    if (Array.isArray(listing) && listing.length > 0) {
      policyId = listing[listing.length - 1].id;
    }
    console.log("Using policyId for claim step:", policyId);
  }

  if ((mode === "claim" || mode === "both") && policyId) {
    console.log("\n--- check_claim (consensus round, may take several minutes) ---");
    const maxAttempts = Number(process.env.RL_CLAIM_ATTEMPTS ?? "3");
    let attempt = 0;
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        const hash = await client.writeContract({
          address,
          functionName: "check_claim",
          args: [policyId],
          value: 0n,
        });
        console.log(`[check_claim attempt ${attempt}] tx hash: ${hash}`);
        const receipt = await client.waitForTransactionReceipt({
          hash,
          status: "FINALIZED",
          interval: 10000,
          retries: 90, // ~15 min budget
        });
        console.log(`[check_claim attempt ${attempt}] tx status:`, receipt.status_name ?? receipt.status);

        const policy = await client.readContract({ address, functionName: "get_policy", args: [policyId] });
        console.log(`[check_claim attempt ${attempt}] verdict:`, policy.verdict, "| policy status:", policy.status);
        console.log("Policy state:", JSON.stringify(policy, null, 2));

        // A payout-bearing or clean-negative verdict is terminal; only abstention is retryable.
        if (policy.verdict && policy.verdict !== "INSUFFICIENT_EVIDENCE") break;
        if (attempt < maxAttempts) {
          console.log("Abstained. Waiting out the recheck cooldown before retrying...");
          await new Promise((r) => setTimeout(r, 1805 * 1000));
        }
      } catch (err) {
        console.error(`[check_claim attempt ${attempt}] error:`, err.message ?? err);
        if (attempt >= maxAttempts) throw err;
      }
    }

    const finalPolicy = await client.readContract({ address, functionName: "get_policy", args: [policyId] });
    console.log("\nFINAL policy state:", JSON.stringify(finalPolicy, null, 2));
    const finalSummary = await client.readContract({ address, functionName: "get_summary", args: [] });
    console.log("FINAL get_summary:", finalSummary);
  } else if (mode === "claim" && !policyId) {
    console.error("No policyId provided or discovered for claim mode.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
