import Link from "next/link";
import { listPolicies } from "@/lib/genlayer/contract";
import { displayTime, formatGen, perilLabel, statusLogLabel, statusTone } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PoliciesPage() {
  const policies = await listPolicies();

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <span className="rl-tag">The ledger</span>
      <h1 className="mt-2 text-3xl font-semibold">Every ticket ever opened at the station</h1>
      <p className="mt-2 max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">
        Open to anyone, no wallet required to read it. Each ticket is a direct read from the deployed contract, not
        a copy. Deep-link any entry and it reflects the chain at the moment you load it.
      </p>

      {policies.length === 0 ? (
        <div className="rl-station mt-8 p-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
          The ledger is empty. No ticket has been opened yet.
        </div>
      ) : (
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {policies.map((policy) => (
            <Link key={policy.id} href={`/policy/${policy.id}`} className="rl-station block p-5 transition hover:shadow-md">
              <div className="flex items-center justify-between gap-3">
                <span className="rl-tag">{policy.id}</span>
                <span className={`rl-pill ${statusTone(policy.status)}`}>{statusLogLabel(policy.status)}</span>
              </div>
              <h2 className="mt-2 text-xl font-semibold">{policy.location_label}</h2>
              <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                {perilLabel(policy.peril)} &middot; clock runs {displayTime(policy.coverage_start)} to {displayTime(policy.coverage_end)}
              </p>
              <div className="mt-4 flex gap-6 text-sm">
                <span>
                  <span className="rl-tag block">Staked</span>
                  {formatGen(policy.premium)}
                </span>
                <span>
                  <span className="rl-tag block">Pays out</span>
                  {formatGen(policy.payout_amount)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
