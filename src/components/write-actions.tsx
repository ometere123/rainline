"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { waitAccepted, writeContract } from "@/lib/genlayer/contract";
import { parseGen } from "@/lib/format";
import { useTransactions } from "./transaction-provider";
import { useWallet } from "./wallet-provider";

const PERILS = [
  { value: "RAIN", label: "Rain / flood" },
  { value: "HEAT", label: "Extreme heat" },
  { value: "WIND", label: "Wind" },
  { value: "AIR", label: "Air quality" },
];

const DEMO_POLICY = {
  peril: "RAIN",
  location: "Green Valley Farm, Nakuru County, KE",
  latitude: "-0.3031",
  longitude: "36.0800",
  threshold: "More than 80mm of cumulative rainfall in any 24h window during the coverage period counts as a qualifying flood loss.",
  premium: "1",
  payout: "8",
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

// Buying cover is the one payable write, and a payable write that reverts does NOT return
// the premium: the value moves to the contract before the method body runs, and the revert
// rolls back the state without refunding. Every [EXPECTED] condition the contract enforces
// is therefore checked here first, so a user error costs nothing instead of stranding GEN.
// Verified on-chain: tx 0x6b23e134...9e6f5 reverted on the retroactive-cover guard and left
// 100 GEN sitting in the contract with no policy created.
const MIN_LEAD_MS = 2 * 60 * 1000; // the contract compares against its own tx timestamp, minutes old

function preflightError(state: {
  location: string;
  latitude: string;
  longitude: string;
  threshold: string;
  start: string;
  end: string;
  premium: string;
  payout: string;
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
  if (state.threshold.trim().length < 8) return "Describe the threshold in a full sentence.";
  if (!state.latitude.trim() || !state.longitude.trim()) {
    return "Latitude and longitude are required so the contract can fetch weather data for the exact spot.";
  }

  let premium: bigint;
  let payout: bigint;
  try {
    premium = parseGen(state.premium);
    payout = parseGen(state.payout);
  } catch {
    return "Enter valid GEN amounts for the premium and payout.";
  }
  if (premium <= 0n) return "The premium must be greater than zero.";
  if (payout <= 0n) return "The payout must be greater than zero.";
  if (payout > premium * 10n) {
    return "The payout cannot exceed 10x the premium. Raise the premium or lower the payout.";
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

export function BuyPolicyForm() {
  const router = useRouter();
  const wallet = useWallet();
  const txs = useTransactions();
  const dates = demoDates();
  const [state, setState] = useState({
    peril: "RAIN",
    location: "",
    latitude: "",
    longitude: "",
    threshold: "",
    start: dates.start,
    end: dates.end,
    premium: "1",
    payout: "5",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    // Catch user error before any GEN leaves the wallet -- see preflightError above.
    const problem = preflightError(state);
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    try {
      const client = await wallet.getWriteClient();
      const hash = await writeContract(
        client,
        "buy_policy",
        [
          state.peril,
          state.location,
          state.latitude,
          state.longitude,
          state.threshold,
          toIso(state.start),
          toIso(state.end),
          parseGen(state.payout),
        ],
        parseGen(state.premium),
      );
      txs.track({ hash, label: `Buy cover for ${state.location}`, createdAt: new Date().toISOString(), status: "PENDING", functionName: "buy_policy" });
      const receipt = await waitAccepted(client, hash);
      txs.update(hash, String(receipt.statusName ?? receipt.status ?? "ACCEPTED") as never);
      router.push("/dashboard");
    } catch (err) {
      setError(writeErrorMessage(err, "Buying the policy failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rl-card p-6">
      <button
        type="button"
        className="rl-btn-ghost mb-5 px-3 py-1.5 text-sm"
        onClick={() => setState({ ...state, ...DEMO_POLICY })}
      >
        Fill example farm policy
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
        <Area
          label="Threshold (what counts as a loss)"
          value={state.threshold}
          onChange={(threshold) => setState({ ...state, threshold })}
        />
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
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Premium (GEN, paid now)" value={state.premium} onChange={(premium) => setState({ ...state, premium })} />
          <Field label="Payout if a claim is upheld (GEN)" value={state.payout} onChange={(payout) => setState({ ...state, payout })} />
        </div>
      </div>
      {error ? (
        <p className="mt-4 rounded-md border p-3 text-sm" style={{ borderColor: "hsl(var(--bad)/0.5)", background: "hsl(var(--bad)/0.1)", color: "hsl(var(--bad))" }}>
          {error}
        </p>
      ) : null}
      <button className="rl-btn-primary mt-6 px-5 py-3" disabled={busy}>
        {busy ? "Sending..." : "Pay premium and buy cover"}
      </button>
    </form>
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

function Area({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      <span className="rl-eyebrow">{label}</span>
      <textarea className="rl-input mt-2 min-h-28 w-full" value={value} onChange={(event) => onChange(event.target.value)} required />
    </label>
  );
}
