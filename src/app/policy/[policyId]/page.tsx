import { notFound } from "next/navigation";
import { CheckClaimButton, ExpireUnclaimedButton } from "@/components/write-actions";
import { getPolicy } from "@/lib/genlayer/contract";
import { displayTime, formatGen, perilLabel, shortenAddress, statusLogLabel, statusTone, verdictLogLabel } from "@/lib/format";
import { formatThreshold } from "@/lib/types";
import { CONTRACT_ADDRESS, explorerAddressUrl } from "@/lib/genlayer/config";

export const dynamic = "force-dynamic";

export default async function PolicyDetail({ params }: { params: Promise<{ policyId: string }> }) {
  const { policyId } = await params;
  const policy = await getPolicy(policyId);
  if (!policy) notFound();

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-5 py-10 lg:grid-cols-[1fr_360px]">
      <section>
        <div className="flex items-center gap-3">
          <span className="rl-tag">{policy.id}</span>
          <span className={`rl-pill ${statusTone(policy.status)}`}>{statusLogLabel(policy.status)}</span>
        </div>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">{policy.location_label}</h1>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
          {perilLabel(policy.peril)} at ({policy.latitude}, {policy.longitude}) &middot; ticket held by {shortenAddress(policy.holder)}
        </p>
        {CONTRACT_ADDRESS ? (
          <a
            className="mt-1 inline-block text-xs underline-offset-4 hover:underline"
            style={{ color: "hsl(var(--primary))" }}
            href={explorerAddressUrl(CONTRACT_ADDRESS)}
            target="_blank"
            rel="noreferrer"
          >
            View the contract&apos;s full transaction history on the StudioNet explorer
          </a>
        ) : null}

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <Panel label="Clock starts" value={displayTime(policy.coverage_start)} />
          <Panel label="Clock ends" value={displayTime(policy.coverage_end)} />
          <Panel label="Opened" value={displayTime(policy.created_at)} />
          <Panel label="Staked to Cistern" value={formatGen(policy.premium)} />
          <Panel label="Pays if trigger is met" value={formatGen(policy.payout_amount)} />
          <Panel label="Readings pulled" value={String(policy.check_attempts)} />
        </div>

        <div className="mt-8">
          <TextBlock label="Structured condition on file" text={formatThreshold(policy.peril, policy.op, policy.threshold_value, policy.window)} />
        </div>

        {policy.quote_id ? (
          <div className="mt-4 rl-gauge">
            <span className="rl-tag">Bought under quote</span>
            <div className="rl-mono mt-2 text-sm">
              {policy.quote_id} &middot; risk band {policy.risk_band || "n/a"}
            </div>
          </div>
        ) : null}

        {policy.verdict ? (
          <div className="mt-8">
            <span className="rl-tag">Logged verdict</span>
            <div className="mt-3 rl-station p-5">
              <div className="flex items-center justify-between gap-3">
                <span className={`rl-pill ${statusTone(policy.verdict)}`}>{verdictLogLabel(policy.verdict)}</span>
                <span className="text-xs text-[hsl(var(--muted-foreground))]">Read pulled {displayTime(policy.last_check_at)}</span>
              </div>
              <p className="mt-3 text-sm leading-6">{policy.severity_rationale}</p>
              {policy.resolution_status === "RESOLVED" ? (
                <div className="mt-4 rl-gauge">
                  <span className="rl-tag">Canonical measurement</span>
                  <div className="rl-mono mt-2 text-sm">
                    {(Number(policy.resolved_value_milli) / 1000).toLocaleString()} {policy.resolved_unit}
                    {policy.trigger_met ? " - stored trigger met" : " - stored trigger not met"}
                  </div>
                </div>
              ) : null}
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <EvidenceBlock label="Gauge read (stations)" text={policy.station_summary} />
                <EvidenceBlock label="Sky read (satellite)" text={policy.satellite_summary} />
                <EvidenceBlock label="Ground read (reports)" text={policy.report_summary} />
              </div>
              {policy.verdict === "INSUFFICIENT_EVIDENCE" ? (
                <p className="mt-4 text-xs" style={{ color: "hsl(var(--warn))" }}>
                  Logged as static, the reads disagreed or came back thin. That&apos;s an abstention, not a denial;
                  anyone can pull another reading once the cooldown clears.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
      <aside className="space-y-6">
        <CheckClaimButton policyId={policy.id} status={policy.status} />
        <ExpireUnclaimedButton policyId={policy.id} status={policy.status} />
      </aside>
    </main>
  );
}

function Panel({ label, value }: { label: string; value: string }) {
  return (
    <div className="rl-gauge">
      <span className="rl-tag">{label}</span>
      <div className="rl-mono mt-2 text-sm">{value}</div>
    </div>
  );
}

function TextBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="rl-station p-5">
      <span className="rl-tag">{label}</span>
      <p className="mt-3 text-sm leading-7">{text}</p>
    </div>
  );
}

function EvidenceBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <span className="rl-tag">{label}</span>
      <p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{text || "No reading pulled yet."}</p>
    </div>
  );
}
