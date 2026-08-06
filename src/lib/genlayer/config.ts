import { localnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";

export const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_RAINLINE_CONTRACT as `0x${string}` | undefined;
export const GENLAYER_ENDPOINT = process.env.NEXT_PUBLIC_GENLAYER_ENDPOINT ?? "https://studio.genlayer.com/api";

export const CHAIN_NAME = (process.env.NEXT_PUBLIC_GENLAYER_CHAIN ?? "studionet") as
  | "studionet"
  | "localnet"
  | "testnetAsimov"
  | "testnetBradbury";

const CHAINS = { studionet, localnet, testnetAsimov, testnetBradbury } as const;

export const chain = CHAINS[CHAIN_NAME];

// genlayer-js's built-in chain metadata for studionet still points at
// genlayer-explorer.vercel.app, but the correct StudioNet explorer is
// explorer-studio.genlayer.com -- override it explicitly rather than trust
// chain.blockExplorers here.
export const EXPLORER_BASE = "https://explorer-studio.genlayer.com";
export const explorerTxUrl = (hash: string) => `${EXPLORER_BASE}/tx/${hash}`;
export const explorerAddressUrl = (address: string) => `${EXPLORER_BASE}/address/${address}`;

export const REQUIRED_METHODS = [
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
