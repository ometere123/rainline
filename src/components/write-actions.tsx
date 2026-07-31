"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { listQuotesByRequester, waitAccepted, writeContract } from "@/lib/genlayer/contract";
import { formatGen, displayTime } from "@/lib/format";
import { METRIC_BY_PERIL, METRIC_UNIT, formatThreshold, type Quote } from "@/lib/types";
import { useTransactions } from "./transaction-provider";
import { useWallet } from "./wallet-provider";

const PERILS = [
  { value: "RAIN", label: "Rain / flood" },
  { value: "HEAT", label: "Extreme heat" },
  { value: "WIND", label: "Wind" },
  { value: "AIR", label: "Air quality" },
];

const WINDOWS = [
  { value: "SINGLE_DAY_MAX", label: "Single-day max (worst single day)" },
  { value: "CUMULATIVE", label: "Cumulative (summed over the window)" },
];

const RISK_BAND_MULTIPLE: Record<string, number> = { LOW: 15, MODERATE: 8, HIGH: 3 };

const DEMO_QUOTE = {
  peril: "RAIN",
  location: "Green Valley Farm, Nakuru County, KE",
  latitude: "-0.3031",
  longitude: "36.0800",
  thresholdValue: "80",
  window: "SINGLE_DAY_MAX",
  requestedPayout: "8",
};

function demoDates() {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);
  return { start: start.toISOString().slice(0, 16), end: end.toISOString().slice(0, 16) };
}

function toIso(local: string) {
  if (!local) return "";
  const withSeconds = local.length === 16 ? `${local}:00` : local;
  return `${withSeconds}Z`;
}

// A quote request is a deterministic-gated write (not payable), so nothing is at stake if it
// reverts. buy_policy_from_quote IS payable, and a payable write that reverts does NOT return
// the value: it moves to the contract before the method body runs, and the revert rolls back
// state without refunding. Every [EXPECTED] condition the contract enforces before that point
// is therefore checked here first, so a user error costs nothing instead of stranding GEN.
// Verified on-chain: tx 0x6b23e134...9e6f5 reverted on the retroactive-cover guard and left
// 100 GEN sitting in the contract with no policy created.
const MIN_LEAD_MS = 2 * 60 * 1000; // the contract compares against its own tx timestamp, minutes old

function preflightQuoteError(state: {
  location: string;
  latitude: string;
  longitude: string;
  thresholdValue: string;
  start: string;
  end: string;
  requestedPayout: string;
}): string | null {
  const start = new Date(toIso(state.start));
  const end = new Date(toIso(state.end));

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return "Enter a valid coverage start and end.";
  }
  if (end <= start) {
    return "Coverage end must be after coverage start.";
  }
  if (start.getTime() <= Date.now() + MIN_LEAD_MS) {
    return "Coverage must start at least a few minutes from now. Rainline does not write retroactive cover, and the contract compares against its own transaction timestamp, so a start time that is nearly now will be rejected.";
  }
  if (state.location.trim().length < 2) return "Enter a location for the insured field or site.";
  if (!state.latitude.trim() || !state.longitude.trim()) {
    return "Latitude and longitude are required so the contract can fetch weather data for the exact spot.";
  }
  const thresholdValue = Number(state.thresholdValue);
  if (!Number.isFinite(thresholdValue) || thresholdValue <= 0) {
    return "Enter a positive threshold value.";
  }
  const requestedPayout = Number(state.requestedPayout);
  if (!Number.isFinite(requestedPayout) || requestedPayout <= 0) {
    return "Enter a positive requested payout (in GEN).";
  }
  return null;
}

function writeErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Failed to fetch Version") || message.includes("unknown RPC error")) {
    return "Injected wallet RPC is not compatible with this GenLayer write. Use the browser wallet instead, then try again.";
  }
  return error instanceof Error ? error.message : fallback;
}

function refreshAfterConsensus(router: ReturnType<typeof useRouter>) {
  router.refresh();
  window.setTimeout(() => router.refresh(), 2500);
}

// Two-step purchase flow: request a quote (a real, separate consensus round pricing historical
// likelihood into a risk band), then buy from that quote for its exact required premium. There
// is no free-text threshold anymore -- peril implies the metric, and the buyer picks an
// operator-fixed (">=") numeric value and a window kind, both structured dropdowns/number
// inputs rather than a sentence.
export function RequestQuoteThenBuy() {
  const router = useRouter();
  const wallet = useWallet();
  const txs = useTransactions();
  const dates = demoDates();
  const [step, setStep] = useState<"form" | "quoting" | "result" | "buying">("form");
  const [state, setState] = useState({
    peril: "RAIN",
    location: "",
    latitude: "",
    longitude: "",
    thresholdValue: "",
    window: "SINGLE_DAY_MAX",
    start: dates.start,
    end: dates.end,
    requestedPayout: "",
  });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  async function requestQuote(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    const problem = preflightQuoteError(state);
    if (problem) {
      setError(problem);
      return;
    }

    setStep("quoting");
    setStatusMessage("Waiting for wallet signature...");
    try {
      const client = await wallet.getWriteClient();
      const address = client.account?.address as `0x${string}` | undefined;
      const thresholdValueWei = BigInt(Math.round(Number(state.thresholdValue))) * 1_000_000_000_000_000_000n;
      const requestedPayoutWei = BigInt(Math.round(Number(state.requestedPayout))) * 1_000_000_000_000_000_000n;
      const hash = await writeContract(
        client,
        "request_quote",
        [
          state.peril,
          state.location,
          state.latitude,
          state.longitude,
          thresholdValueWei,
          state.window,
          toIso(state.start),
          toIso(state.end),
          requestedPayoutWei,
        ],
        0n,
      );
      txs.track({ hash, label: `Quote request for ${state.location}`, createdAt: new Date().toISOString(), status: "PENDING", functionName: "request_quote" });
      setStatusMessage("Sent. This triggers a real consensus round (historical climatology fetch + risk-banding); it can take a few minutes.");
      const receipt = await waitAccepted(client, hash);
      txs.update(hash, String(receipt.statusName ?? receipt.status ?? "ACCEPTED") as never);

      const quotes = address ? await listQuotesByRequester(address) : [];
      const latest = quotes[quotes.length - 1];
      if (!latest) throw new Error("Quote request finalized but no quote was found.");
      setQuote(latest);
      setStep("result");
    } catch (err) {
      setError(writeErrorMessage(err, "Requesting a quote failed."));
      setStep("form");
    }
  }

  async function buyFromQuote() {
    if (!quote) return;
    setStep("buying");
    setError("");
    try {
      const client = await wallet.getWriteClient();
      const hash = await writeContract(client, "buy_policy_from_quote", [quote.id], BigInt(quote.required_premium));
      txs.track({ hash, label: `Buy cover from ${quote.id}`, createdAt: new Date().toISOString(), status: "PENDING", functionName: "buy_policy_from_quote" });
      const receipt = await waitAccepted(client, hash);
      txs.update(hash, String(receipt.statusName ?? receipt.status ?? "ACCEPTED") as never);
      router.push("/dashboard");
    } catch (err) {
      setError(writeErrorMessage(err, "Buying the policy failed."));
      setStep("result");
    }
  }

  if (step === "result" && quote) {
    return <QuoteResultCard quote={quote} onBuy={buyFromQuote} busy={false} error={error} onBack={() => setStep("form")} />;
  }
  if (step === "buying" && quote) {
    return <QuoteResultCard quote={quote} onBuy={buyFromQuote} busy error={error} onBack={() => setStep("form")} />;
  }

  return (
    <form onSubmit={requestQuote} className="rl-card p-6">
      <button
        type="button"
        className="rl-btn-ghost mb-5 px-3 py-1.5 text-sm"
        onClick={() => setState({ ...state, ...DEMO_QUOTE })}
      >
        Fill example farm quote
      </button>
      <div className="grid gap-4">
        <label>
          <span className="rl-eyebrow">Peril</span>
          <select
            className="rl-input mt-2 w-full"
            value={state.peril}
            onChange={(event) => setState({ ...state, peril: event.target.value })}
          >
            {PERILS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <Field label="Location" value={state.location} onChange={(location) => setState({ ...state, location })} placeholder="Green Valley Farm, Nakuru County, KE" />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Latitude" value={state.latitude} onChange={(latitude) => setState({ ...state, latitude })} placeholder="-0.3031" />
          <Field label="Longitude" value={state.longitude} onChange={(longitude) => setState({ ...state, longitude })} placeholder="36.0800" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label>
            <span className="rl-eyebrow">
              Threshold value ({METRIC_UNIT[METRIC_BY_PERIL[state.peril as keyof typeof METRIC_BY_PERIL]]})
            </span>
            <input
              type="number"
              min="1"
              step="1"
              className="rl-input mt-2 w-full"
              value={state.thresholdValue}
              onChange={(event) => setState({ ...state, thresholdValue: event.target.value })}
              placeholder="80"
              required
            />
          </label>
          <label>
            <span className="rl-eyebrow">Window</span>
            <select
              className="rl-input mt-2 w-full"
              value={state.window}
              onChange={(event) => setState({ ...state, window: event.target.value })}
            >
              {WINDOWS.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          Condition: {formatThreshold(state.peril as never, ">=", state.thresholdValue ? `${state.thresholdValue}000000000000000000` : "0", state.window as never)}
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <label>
            <span className="rl-eyebrow">Coverage start</span>
            <input
              type="datetime-local"
              className="rl-input mt-2 w-full"
              value={state.start}
              onChange={(event) => setState({ ...state, start: event.target.value })}
              required
            />
          </label>
          <label>
            <span className="rl-eyebrow">Coverage end</span>
            <input
              type="datetime-local"
              className="rl-input mt-2 w-full"
              value={state.end}
              onChange={(event) => setState({ ...state, end: event.target.value })}
              required
            />
          </label>
        </div>
        <Field
          label="Payout you want if a claim is upheld (GEN)"
          value={state.requestedPayout}
          onChange={(requestedPayout) => setState({ ...state, requestedPayout })}
          placeholder="8"
        />
      </div>
      {error ? (
        <p className="mt-4 rounded-md border p-3 text-sm" style={{ borderColor: "hsl(var(--bad)/0.5)", background: "hsl(var(--bad)/0.1)", color: "hsl(var(--bad))" }}>
          {error}
        </p>
      ) : null}
      <button className="rl-btn-primary mt-6 px-5 py-3" disabled={step === "quoting"}>
        {step === "quoting" ? "Pricing risk..." : "Request a quote"}
      </button>
      {step === "quoting" && statusMessage ? (
        <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]" aria-live="polite">
          {statusMessage}
        </p>
      ) : null}
    </form>
  );
}

function QuoteResultCard({
  quote,
  onBuy,
  busy,
  error,
  onBack,
}: {
  quote: Quote;
  onBuy: () => void;
  busy: boolean;
  error: string;
  onBack: () => void;
}) {
  const unpriceable = quote.risk_band === "UNPRICEABLE";
  const multiple = RISK_BAND_MULTIPLE[quote.risk_band] ?? Number(quote.max_payout_multiple);
  return (
    <div className="rl-card p-6">
      <div className="flex items-center justify-between gap-3">
        <span className="rl-tag">{quote.id}</span>
        <span className={`rl-pill ${unpriceable ? "text-[hsl(var(--bad))] border-[hsl(var(--bad)/0.5)] bg-[hsl(var(--bad)/0.1)]" : "text-[hsl(var(--good))] border-[hsl(var(--good)/0.5)] bg-[hsl(var(--good)/0.12)]"}`}>
          {quote.risk_band || "PENDING"}
        </span>
      </div>
      <h3 className="mt-3 text-xl font-semibold">{quote.location_label}</h3>
      <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
        {formatThreshold(quote.peril, quote.op, quote.threshold_value, quote.window)}
      </p>
      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
        Coverage {displayTime(quote.coverage_start)} &rarr; {displayTime(quote.coverage_end)} &middot; quote expires {displayTime(quote.expires_at)}
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rl-gauge">
          <span className="rl-tag">Requested payout</span>
          <div className="rl-mono mt-2 text-sm">{formatGen(quote.requested_payout)}</div>
        </div>
        <div className="rl-gauge">
          <span className="rl-tag">Required premium{multiple ? ` (${multiple}x)` : ""}</span>
          <div className="rl-mono mt-2 text-sm">{unpriceable ? "N/A" : formatGen(quote.required_premium)}</div>
        </div>
      </div>

      <div className="mt-5 rl-station p-5">
        <span className="rl-tag">Rationale</span>
        <p className="mt-3 text-sm leading-6">{quote.rationale}</p>
        <div className="mt-4">
          <span className="rl-tag">Historical climatology the model saw</span>
          <p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{quote.climatology_summary}</p>
        </div>
      </div>

      {unpriceable ? (
        <p className="mt-4 text-sm" style={{ color: "hsl(var(--bad))" }}>
          This condition was rated UNPRICEABLE -- the historical data was too thin or conflicting to price honestly.
          A policy cannot be bought from this quote. Try a broader threshold, a different window, or a different
          location.
        </p>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-md border p-3 text-sm" style={{ borderColor: "hsl(var(--bad)/0.5)", background: "hsl(var(--bad)/0.1)", color: "hsl(var(--bad))" }}>
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex gap-3">
        <button type="button" className="rl-btn-ghost px-4 py-2 text-sm" onClick={onBack} disabled={busy}>
          Back
        </button>
        {!unpriceable ? (
          <button type="button" className="rl-btn-primary px-5 py-3" onClick={onBuy} disabled={busy}>
            {busy ? "Sending..." : `Buy this quote for ${formatGen(quote.required_premium)}`}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function CheckClaimButton({ policyId, status }: { policyId: string; status: string }) {
  const router = useRouter();
  const wallet = useWallet();
  const txs = useTransactions();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      setMessage("Waiting for wallet signature...");
      const client = await wallet.getWriteClient();
      const hash = await writeContract(client, "check_claim", [policyId], 0n);
      txs.track({ hash, label: `Check claim ${policyId}`, createdAt: new Date().toISOString(), status: "PENDING", functionName: "check_claim" });
      setMessage("Sent. This triggers a live consensus round with real evidence fetches; it can take a few minutes.");
      const receipt = await waitAccepted(client, hash);
      txs.update(hash, String(receipt.statusName ?? receipt.status ?? "ACCEPTED") as never);
      refreshAfterConsensus(router);
      setMessage(`Reached ${String(receipt.statusName ?? receipt.status)}.`);
    } catch (error) {
      setMessage(writeErrorMessage(error, "Claim check failed."));
    } finally {
      setBusy(false);
    }
  }

  if (status !== "ACTIVE" && status !== "CHECKING") return null;

  return (
    <div className="rl-card p-5">
      <span className="rl-eyebrow">{status === "CHECKING" ? "Retry claim check" : "Trigger claim check"}</span>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
        {status === "CHECKING"
          ? "The last check came back INSUFFICIENT_EVIDENCE. Anyone can retry after the cooldown; you do not need to be the policyholder."
          : "Once coverage ends, anyone can trigger evaluation. It fetches weather-station, satellite, and local report evidence and asks GenLayer consensus for a severity verdict."}
      </p>
      <button className="rl-btn-primary mt-4 px-4 py-2 text-sm" onClick={run} disabled={busy}>
        {busy ? "Running..." : "Check claim now"}
      </button>
      {message ? (
        <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]" aria-live="polite">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function ExpireUnclaimedButton({ policyId, status }: { policyId: string; status: string }) {
  const router = useRouter();
  const wallet = useWallet();
  const txs = useTransactions();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const client = await wallet.getWriteClient();
      const hash = await writeContract(client, "expire_unclaimed", [policyId], 0n);
      txs.track({ hash, label: `Expire ${policyId}`, createdAt: new Date().toISOString(), status: "PENDING", functionName: "expire_unclaimed" });
      const receipt = await waitAccepted(client, hash);
      txs.update(hash, String(receipt.statusName ?? receipt.status ?? "ACCEPTED") as never);
      refreshAfterConsensus(router);
      setMessage(`Reached ${String(receipt.statusName ?? receipt.status)}.`);
    } catch (error) {
      setMessage(writeErrorMessage(error, "Sweep failed."));
    } finally {
      setBusy(false);
    }
  }

  if (status !== "ACTIVE") return null;

  return (
    <div className="rl-card p-5">
      <span className="rl-eyebrow">Sweep unclaimed policy</span>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
        Only available a while after coverage end if nobody has triggered a claim check. Anyone may call this; it
        marks the policy resolved without moving funds.
      </p>
      <button className="rl-btn-ghost mt-4 px-4 py-2 text-sm" onClick={run} disabled={busy}>
        {busy ? "Sending..." : "Mark expired, no claim"}
      </button>
      {message ? (
        <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]" aria-live="polite">
          {message}
        </p>
      ) : null}
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label>
      <span className="rl-eyebrow">{label}</span>
      <input className="rl-input mt-2 w-full" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required />
    </label>
  );
}

