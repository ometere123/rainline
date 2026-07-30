export type Peril = "RAIN" | "HEAT" | "WIND" | "AIR";

export type PolicyStatus =
  | "ACTIVE"
  | "EXPIRED_NO_CLAIM"
  | "CHECKING"
  | "PAID_OUT"
  | "DECLINED"
  | "REFUNDED";

export type Verdict = "" | "NONE" | "MINOR" | "MODERATE" | "SEVERE" | "INSUFFICIENT_EVIDENCE";

export type Policy = {
  id: string;
  holder: string;
  peril: Peril;
  location_label: string;
  latitude: string;
  longitude: string;
  threshold_label: string;
  coverage_start: string;
  coverage_end: string;
  premium: string;
  payout_amount: string;
  created_at: string;
  status: PolicyStatus;
  last_check_at: string;
  check_attempts: number;
  verdict: Verdict;
  severity_rationale: string;
  station_summary: string;
  satellite_summary: string;
  report_summary: string;
  resolved_at: string;
};

export type Summary = {
  admin: string;
  policy_count: number | string;
  pool_balance: string;
  contract_balance: string;
};

export type TxStage =
  | "UNINITIALIZED"
  | "PENDING"
  | "PROPOSING"
  | "COMMITTING"
  | "REVEALING"
  | "ACCEPTED"
  | "UNDETERMINED"
  | "FINALIZED"
  | "CANCELED"
  | "APPEAL_REVEALING"
  | "APPEAL_COMMITTING"
  | "READY_TO_FINALIZE"
  | "VALIDATORS_TIMEOUT"
  | "LEADER_TIMEOUT";

export type StoredTransaction = {
  hash: `0x${string}` & { length?: 66 };
  label: string;
  createdAt: string;
  status: TxStage;
  functionName: string;
};
