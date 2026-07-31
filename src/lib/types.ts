export type Peril = "RAIN" | "HEAT" | "WIND" | "AIR";

export type Metric = "RAINFALL_MM" | "MAX_TEMP_C" | "WIND_KMH" | "AQI";

export const METRIC_BY_PERIL: Record<Peril, Metric> = {
  RAIN: "RAINFALL_MM",
  HEAT: "MAX_TEMP_C",
  WIND: "WIND_KMH",
  AIR: "AQI",
};

export const METRIC_UNIT: Record<Metric, string> = {
  RAINFALL_MM: "mm",
  MAX_TEMP_C: "°C",
  WIND_KMH: "km/h",
  AQI: "AQI",
};

export type ThresholdWindow = "SINGLE_DAY_MAX" | "CUMULATIVE";

export type PolicyStatus =
  | "ACTIVE"
  | "EXPIRED_NO_CLAIM"
  | "CHECKING"
  | "PAID_OUT"
  | "DECLINED"
  | "REFUNDED";

export type Verdict = "" | "NONE" | "MINOR" | "MODERATE" | "SEVERE" | "INSUFFICIENT_EVIDENCE";

export type RiskBand = "" | "LOW" | "MODERATE" | "HIGH" | "UNPRICEABLE";

export type Policy = {
  id: string;
  holder: string;
  peril: Peril;
  location_label: string;
  latitude: string;
  longitude: string;
  op: string;
  threshold_value: string;
  window: ThresholdWindow;
  coverage_start: string;
  coverage_end: string;
  quote_id: string;
  risk_band: RiskBand;
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

export type Quote = {
  id: string;
  requester: string;
  peril: Peril;
  location_label: string;
  latitude: string;
  longitude: string;
  op: string;
  threshold_value: string;
  window: ThresholdWindow;
  coverage_start: string;
  coverage_end: string;
  requested_payout: string;
  max_payout_multiple: string;
  required_premium: string;
  risk_band: RiskBand;
  rationale: string;
  climatology_summary: string;
  created_at: string;
  expires_at: string;
  consumed: boolean;
};

export type Summary = {
  admin: string;
  policy_count: number | string;
  quote_count: number | string;
  pool_balance: string;
  outstanding_liability: string;
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

/** Render a structured threshold as the readable form used across the app, e.g.
 * "rainfall >= 80mm, single-day max". */
export function formatThreshold(peril: Peril, op: string, thresholdValueWei: string, window: ThresholdWindow): string {
  const metric = METRIC_BY_PERIL[peril];
  const unit = METRIC_UNIT[metric];
  const value = Number(BigInt(thresholdValueWei || "0") / 1_000_000_000_000_000_000n);
  const label = {
    RAINFALL_MM: "rainfall",
    MAX_TEMP_C: "max temperature",
    WIND_KMH: "wind speed",
    AQI: "air quality index",
  }[metric];
  const windowLabel = window === "SINGLE_DAY_MAX" ? "single-day max" : "cumulative over the window";
  return `${label} ${op} ${value}${unit}, ${windowLabel}`;
}
