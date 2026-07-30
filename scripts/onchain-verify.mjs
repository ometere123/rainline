// Standalone on-chain verification script for Rainline's payable write path.
//
// The `genlayer` CLI's `write` command hardcodes `value: 0n`, so it cannot exercise
// `buy_policy`, which is `@gl.public.write.payable` and requires real GEN attached. This
// script uses genlayer-js directly to send a real payable buy_policy transaction against
// StudioNet, wait for it to finalize, and print the resulting state so the outcome can be
// recorded as real proof (not simulated) in the README.
//
// The signing key is decrypted in-process from a local V3 keystore file (created via
// `genlayer account create` + `genlayer account export`) and is never written to stdout,
// logs, or passed as a CLI argument.
//
// Usage:
//   node scripts/onchain-verify.mjs <keystorePath> <keystorePassword> [buy|claim|both] [policyId]

import { readFileSync, existsSync } from "node:fs";
import crypto from "node:crypto";
import { createClient, createAccount } from "genlayer-js";
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
if (!keystorePath || !keystorePassword) {
  console.error("Usage: node scripts/onchain-verify.mjs <keystorePath> <keystorePassword> [buy|claim|both] [policyId]");
  process.exit(1);
}

const privateKey = decryptKeystore(keystorePath, keystorePassword);
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
  console.log(`[${label}] status: ${receipt.status}`);
  return receipt;
}

async function main() {
  console.log("Account:", account.address);
  console.log("Contract:", address);

  let policyId = explicitPolicyId;

  if (mode === "buy" || mode === "both") {
    const GEN = 10n ** 18n;
    const now = new Date();
    const start = new Date(now.getTime() - 5 * 60 * 1000).toISOString().replace(/\.\d+Z$/, "Z");
    const end = new Date(now.getTime() + 30 * 1000).toISOString().replace(/\.\d+Z$/, "Z");

    console.log("\n--- buy_policy (payable, real GEN value) ---");
    const hash = await client.writeContract({
      address,
      functionName: "buy_policy",
      args: [
        "RAIN",
        "Onchain Verify Farm, KE",
        "-1.2921",
        "36.8219",
        "More than 80mm of rain in a 24h window during the coverage period counts as a qualifying flood loss.",
        start,
        end,
        2n * GEN,
      ],
      value: 10n * GEN,
    });
    const receipt = await waitAndReport("buy_policy", hash);
    console.log("buy_policy receipt status_name:", receipt.status_name ?? receipt.status);

    const summary = await client.readContract({ address, functionName: "get_summary", args: [] });
    console.log("get_summary after buy_policy:", summary);

    const listing = await client.readContract({ address, functionName: "list_policies_by_holder", args: [account.address, 0n, 5n] });
    console.log("policies for this account:", JSON.stringify(listing, null, 2));
    if (Array.isArray(listing) && listing.length > 0) {
      policyId = listing[listing.length - 1].id;
    }
    console.log("Using policyId for claim step:", policyId);
  }

  if ((mode === "claim" || mode === "both") && policyId) {
    console.log("\n--- check_claim (consensus round, may take several minutes) ---");
    let attempt = 0;
    let receipt;
    while (attempt < 3) {
      attempt += 1;
      try {
        const hash = await client.writeContract({
          address,
          functionName: "check_claim",
          args: [policyId],
        });
        console.log(`[check_claim attempt ${attempt}] tx hash: ${hash}`);
        receipt = await client.waitForTransactionReceipt({
          hash,
          status: "FINALIZED",
          interval: 10000,
          retries: 90, // ~15 min budget
        });
        console.log(`[check_claim attempt ${attempt}] status:`, receipt.status_name ?? receipt.status);
        break;
      } catch (err) {
        console.error(`[check_claim attempt ${attempt}] error:`, err.message ?? err);
        if (attempt >= 3) throw err;
      }
    }

    const policy = await client.readContract({ address, functionName: "get_policy", args: [policyId] });
    console.log("Final policy state:", JSON.stringify(policy, null, 2));
  } else if (mode === "claim" && !policyId) {
    console.error("No policyId provided or discovered for claim mode.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
