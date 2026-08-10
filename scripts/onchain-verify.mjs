// Standalone on-chain verification script for Rainline's fund-then-quote-then-buy-then-claim
// flow.
//
// The `genlayer` CLI's `write` command hardcodes `value: 0n`, so it cannot exercise any payable
// method (`fund_pool`, `buy_policy_from_quote`). This script uses genlayer-js directly to send
// real transactions against StudioNet, wait for them to finalize, and print the resulting state
// so the outcome can be recorded as real proof (not simulated) in the README.
//
// Signing key resolution, in order:
//   1. RAINLINE_PK env var (0x-prefixed hex private key)
//   2. a local V3 keystore file (path + password as argv[2], argv[3])
//   3. a freshly generated key (StudioNet is gasless with simulated balances)
// The key is never written to stdout or logs.
//
// The insured event is env-overridable so the flow can be pointed at a real location and a
// genuinely future coverage window (the no-retroactive-cover guard forbids reusing historical
// windows once coverage has already elapsed relative to purchase time):
//   RL_LOCATION, RL_LAT, RL_LON, RL_THRESHOLD_VALUE, RL_WINDOW, RL_START, RL_END,
//   RL_REQUESTED_PAYOUT_GEN, RL_FUND_GEN, RL_PERIL, RL_CLAIM_ATTEMPTS
//
// Usage:
//   node scripts/onchain-verify.mjs [keystorePath] [keystorePassword] [fund|quote|buy|claim|all] [quoteOrPolicyId]

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

const [, , keystorePath, keystorePassword, mode = "all", explicitId] = process.argv;

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
const GEN = 10n ** 18n;

async function waitAndReport(label, hash, retries = 100) {
  console.log(`[${label}] tx hash: ${hash}`);
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: "FINALIZED",
    interval: 10000,
    retries,
  });
  console.log(`[${label}] status: ${receipt.status_name ?? receipt.status}`);
  return receipt;
}

function eventArgs() {
  // Defaults point at a genuinely future coverage window (computed at run time, not a fixed
  // historical date) so the no-retroactive-cover guard is satisfied honestly rather than
  // reusing a known past event.
  const now = new Date();
  const start = new Date(now.getTime() + 60 * 60 * 1000); // 1h out for slow/retried quote consensus
  const end = new Date(start.getTime() + 60 * 60 * 1000); // 1h window
  const fmt = (d) => d.toISOString().replace(/\.\d+Z$/, "Z");

  return {
    peril: process.env.RL_PERIL ?? "RAIN",
    location: process.env.RL_LOCATION ?? "Houston, Texas, US",
    lat: process.env.RL_LAT ?? "29.76",
    lon: process.env.RL_LON ?? "-95.37",
    thresholdValue: BigInt(process.env.RL_THRESHOLD_VALUE ?? "80") * GEN,
    window: process.env.RL_WINDOW ?? "SINGLE_DAY_MAX",
    start: process.env.RL_START ?? fmt(start),
    end: process.env.RL_END ?? fmt(end),
    requestedPayout: BigInt(process.env.RL_REQUESTED_PAYOUT_GEN ?? "2") * GEN,
    fundGen: BigInt(process.env.RL_FUND_GEN ?? "1000") * GEN,
  };
}

async function main() {
  console.log("Account:", account.address);
  console.log("Contract:", address);

  let quoteId = mode === "quote" || mode === "all" || mode === "fund" ? undefined : explicitId;
  let policyId = mode === "claim" ? explicitId : undefined;

  if (mode === "fund" || mode === "all" || mode === "quote" || (mode === "buy" && !quoteId)) {
    // A lone leveraged purchase can never be the first thing that happens to an empty pool
    // (required_premium is always strictly less than requested_payout, so the 20%-of-pool
    // concentration cap is unsatisfiable for a first purchase). fund_pool is the deterministic,
    // non-consensus deposit path that bootstraps liquidity -- see its docstring in the contract.
    const ev = eventArgs();
    console.log("\n--- fund_pool (payable, real GEN value, no consensus round) ---");
    const fundHash = await client.writeContract({
      address,
      functionName: "fund_pool",
      args: [],
      value: ev.fundGen,
    });
    await waitAndReport("fund_pool", fundHash, 30);
    const summaryAfterFund = await client.readContract({ address, functionName: "get_summary", args: [] });
    console.log("get_summary after fund_pool:", summaryAfterFund);

    if (mode === "fund") return;
  }

  if (mode === "quote" || mode === "all" || (mode === "buy" && !quoteId)) {
    const ev = eventArgs();
    console.log("\n--- request_quote (consensus round: 1 climatology fetch + 1 risk-banding prompt) ---");
    console.log(`Peril ${ev.peril} at ${ev.location} (${ev.lat}, ${ev.lon})`);
    console.log(`Structured condition: >= ${ev.thresholdValue / GEN} (${ev.window})`);
    console.log(`Coverage window: ${ev.start} -> ${ev.end}`);
    console.log(`Requested payout: ${ev.requestedPayout / GEN} GEN`);

    const hash = await client.writeContract({
      address,
      functionName: "request_quote",
      args: [ev.peril, ev.location, ev.lat, ev.lon, ev.thresholdValue, ev.window, ev.start, ev.end, ev.requestedPayout],
      value: 0n,
    });
    await waitAndReport("request_quote", hash);

    // Read quote_count directly rather than "the last entry in list_quotes_by_requester" -- that
    // list can lag a beat behind a just-finalized write on a fresh read, which was observed
    // directly while proving this out (a stale read returned an older quote as "latest").
    // quote_count is authoritative and gives the exact id deterministically.
    const summaryAfterQuote = await client.readContract({ address, functionName: "get_summary", args: [] });
    const newQuoteId = `RLQ-${summaryAfterQuote.quote_count}`;
    const q = await client.readContract({ address, functionName: "get_quote", args: [newQuoteId] });
    if (q) {
      quoteId = newQuoteId;
      console.log("\nQuote id:", q.id);
      console.log("Risk band:", q.risk_band);
      console.log("Max payout multiple:", q.max_payout_multiple);
      console.log("Required premium:", q.required_premium, "wei");
      console.log("Rationale:", q.rationale);
      console.log("Climatology summary:", q.climatology_summary);
      console.log("Expires at:", q.expires_at);
    }

    if (mode === "quote") return;

    if (quoteId) {
      const q = await client.readContract({ address, functionName: "get_quote", args: [quoteId] });
      if (q.risk_band === "UNPRICEABLE") {
        console.log("\nQuote rated UNPRICEABLE -- buy_policy_from_quote must refuse this. Verifying refusal...");
        try {
          const buyHash = await client.writeContract({
            address,
            functionName: "buy_policy_from_quote",
            args: [quoteId],
            value: 1n, // any nonzero value; the UNPRICEABLE check fires before the exact-value check
          });
          const receipt = await waitAndReport("buy_policy_from_quote (expect ERROR)", buyHash, 30);
          console.log("Result (should be ERROR):", receipt.consensus_data?.leader_receipt?.[0]?.execution_result);
        } catch (err) {
          console.log("buy_policy_from_quote correctly rejected the UNPRICEABLE quote:", err.message ?? err);
        }
        return;
      }
    }
  }

  if (mode === "buy" || mode === "all") {
    const q = await client.readContract({ address, functionName: "get_quote", args: [quoteId] });
    const premium = BigInt(q.required_premium);
    console.log("\n--- buy_policy_from_quote (payable, exact required_premium) ---");
    console.log(`Quote: ${quoteId}, required premium: ${premium} wei (${Number(premium) / 1e18} GEN)`);

    const hash = await client.writeContract({
      address,
      functionName: "buy_policy_from_quote",
      args: [quoteId],
      value: premium,
    });
    await waitAndReport("buy_policy_from_quote", hash);

    const summary = await client.readContract({ address, functionName: "get_summary", args: [] });
    console.log("get_summary after buy_policy_from_quote:", summary);

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

  if ((mode === "claim" || mode === "all") && policyId) {
    console.log("\n--- check_claim (consensus round: 3 fetches + reconciliation, may take several minutes) ---");
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
    console.error("No policyId provided for claim mode.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
