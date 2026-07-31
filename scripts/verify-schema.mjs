import { existsSync, readFileSync } from "node:fs";
import { createAccount, createClient } from "genlayer-js";
import { studionet, localnet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...value] = trimmed.split("=");
    process.env[key] ??= value.join("=");
  }
}

const chains = { studionet, localnet, testnetAsimov, testnetBradbury };
const chainName = process.env.NEXT_PUBLIC_GENLAYER_CHAIN ?? "studionet";
const endpoint = process.env.NEXT_PUBLIC_GENLAYER_ENDPOINT ?? "https://studio.genlayer.com/api";
const address = process.env.NEXT_PUBLIC_RAINLINE_CONTRACT;
const required = [
  "fund_pool",
  "request_quote",
  "buy_policy_from_quote",
  "check_claim",
  "expire_unclaimed",
  "get_summary",
  "get_policy",
  "get_quote",
  "list_policies",
  "list_policies_by_holder",
  "list_quotes_by_requester",
];

if (!address) {
  console.error("NEXT_PUBLIC_RAINLINE_CONTRACT is not set.");
  process.exit(1);
}

const client = createClient({ chain: chains[chainName], endpoint, account: createAccount() });
const schema = await client.getContractSchema(address);
const missing = required.filter((method) => !schema.methods[method]);

if (missing.length) {
  console.error(`Missing contract methods: ${missing.join(", ")}`);
  process.exit(1);
}

console.log(`Schema verified for ${address}.`);

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
if (pkg.dependencies["genlayer-js"] !== "1.1.8") {
  console.warn(`genlayer-js dependency is ${pkg.dependencies["genlayer-js"]}; expected 1.1.8.`);
}
