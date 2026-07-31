import { TransactionStatus } from "genlayer-js/types";
import type { CalldataEncodable, GenLayerClient, TransactionHash } from "genlayer-js/types";
import { CONTRACT_ADDRESS, REQUIRED_METHODS } from "./config";
import { createReadClient } from "./read-client";
import type { Policy, Quote, Summary } from "../types";

type Client = GenLayerClient<typeof import("./config").chain>;

export async function verifyContractSchema() {
  if (!CONTRACT_ADDRESS) return { ok: false, missing: REQUIRED_METHODS, configured: false };
  const address = CONTRACT_ADDRESS;
  const client = createReadClient();
  const schema = await readMaybe<{ methods: Record<string, unknown> }>(() => client.getContractSchema(address));
  if (!schema) return { ok: false, missing: REQUIRED_METHODS, configured: true };
  const missing = REQUIRED_METHODS.filter((method) => !schema.methods[method]);
  return { ok: missing.length === 0, missing, configured: true };
}

export async function getSummary(): Promise<Summary> {
  if (!CONTRACT_ADDRESS) return emptySummary();
  const address = CONTRACT_ADDRESS;
  const client = createReadClient();
  return (await readMaybe<Summary>(() => client.readContract({ address, functionName: "get_summary", args: [] }))) ?? emptySummary();
}

export async function listPolicies(): Promise<Policy[]> {
  if (!CONTRACT_ADDRESS) return [];
  const address = CONTRACT_ADDRESS;
  const client = createReadClient();
  return (await readMaybe<Policy[]>(() => client.readContract({
    address,
    functionName: "list_policies",
    args: [0n, 100n],
  }))) ?? [];
}

export async function listPoliciesByHolder(account: `0x${string}`): Promise<Policy[]> {
  if (!CONTRACT_ADDRESS) return [];
  const address = CONTRACT_ADDRESS;
  const client = createReadClient();
  return (await readMaybe<Policy[]>(() => client.readContract({
    address,
    functionName: "list_policies_by_holder",
    args: [account, 0n, 100n],
  }))) ?? [];
}

export async function getPolicy(id: string): Promise<Policy | undefined> {
  if (!CONTRACT_ADDRESS) return undefined;
  const address = CONTRACT_ADDRESS;
  const client = createReadClient();
  return readMaybe<Policy>(() => client.readContract({ address, functionName: "get_policy", args: [id] }));
}

export async function getQuote(id: string): Promise<Quote | undefined> {
  if (!CONTRACT_ADDRESS) return undefined;
  const address = CONTRACT_ADDRESS;
  const client = createReadClient();
  return readMaybe<Quote>(() => client.readContract({ address, functionName: "get_quote", args: [id] }));
}

export async function listQuotesByRequester(account: `0x${string}`): Promise<Quote[]> {
  if (!CONTRACT_ADDRESS) return [];
  const address = CONTRACT_ADDRESS;
  const client = createReadClient();
  return (await readMaybe<Quote[]>(() => client.readContract({
    address,
    functionName: "list_quotes_by_requester",
    args: [account, 0n, 50n],
  }))) ?? [];
}

export async function writeContract(
  client: Client,
  functionName: string,
  args: CalldataEncodable[],
  value: bigint,
) {
  if (!CONTRACT_ADDRESS) throw new Error("No deployed contract address is configured.");
  const hash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args,
    value,
    consensusMaxRotations: 3,
  });
  return hash as TransactionHash;
}

function emptySummary(): Summary {
  return {
    admin: "",
    policy_count: 0,
    quote_count: 0,
    pool_balance: "0",
    outstanding_liability: "0",
    contract_balance: "0",
  };
}

async function readMaybe<T>(read: () => Promise<unknown>): Promise<T | undefined> {
  try {
    return (await read()) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("execution failed") ||
      message.includes("Missing or invalid parameters") ||
      message.includes("Rate limit exceeded") ||
      message.includes("QueuePool limit") ||
      message.includes("Unexpected token")
    ) {
      return undefined;
    }
    throw error;
  }
}

export async function waitAccepted(client: Client, hash: TransactionHash) {
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.FINALIZED,
    interval: 5000,
    retries: 90,
  });
  const finalized = await client.getTransaction({ hash });
  const result = finalized?.consensus_data?.leader_receipt?.[0]?.execution_result;
  if (result && result !== "SUCCESS") {
    throw new Error(`GenLayer contract execution failed (${result}). Transaction: ${hash}`);
  }
  return receipt;
}
