"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { listPoliciesByHolder } from "@/lib/genlayer/contract";
import { displayTime, formatGen, perilLabel, shortenAddress, statusLogLabel, statusTone } from "@/lib/format";
import type { Policy } from "@/lib/types";
import { useWallet } from "@/components/wallet-provider";
import { TransactionRail } from "@/components/transaction-provider";

type LoadState = "idle" | "loading" | "ready" | "error";

export function DashboardClient() {
  const wallet = useWallet();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!wallet.address) return;
    setState("loading");
    setError("");
    try {
      const next = await listPoliciesByHolder(wallet.address);
      setPolicies(next);
      setState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reading your policies failed.");
      setState("error");
    }
  }, [wallet.address]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  if (!wallet.address) {
    return (
      <main className="mx-auto max-w-6xl px-5 py-10">
        <div className="rl-station p-8">
          <span className="rl-tag">Your tickets</span>
          <h1 className="mt-2 text-3xl font-semibold">Connect a wallet to see your tickets in the log</h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-[hsl(var(--muted-foreground))]">
            You can still read the whole <Link className="underline" href="/policies">ledger</Link> without connecting
            anything. Connecting only unlocks opening a ticket and pulling readings yourself.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-5 py-10 lg:grid-cols-[1fr_360px]">
      <section>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="rl-tag">Your tickets</span>
            <h1 className="mt-2 text-3xl font-semibold">{shortenAddress(wallet.address)}</h1>
          </div>
          <button className="rl-btn-ghost flex items-center gap-2 px-3 py-1.5 text-sm" onClick={load} disabled={state === "loading"}>
            <RefreshCw size={14} aria-hidden />
            {state === "loading" ? "Reading" : "Refresh"}
          </button>
        </div>

        {error ? (
          <div
            className="mt-6 rounded-md border p-4 text-sm"
            style={{ borderColor: "hsl(var(--bad)/0.5)", background: "hsl(var(--bad)/0.1)", color: "hsl(var(--bad))" }}
          >
            {error}
          </div>
        ) : null}

        <div className="mt-8 grid gap-4">
          {policies.length === 0 && state === "ready" ? (
            <div className="rl-station p-6 text-sm text-[hsl(var(--muted-foreground))]">
              No tickets under this address yet. <Link className="underline" href="/policies/new">Open your first one</Link>.
            </div>
          ) : (
            policies.map((policy) => (
              <Link key={policy.id} href={`/policy/${policy.id}`} className="rl-station block p-5 transition hover:shadow-md">
                <div className="flex items-center justify-between gap-3">
                  <span className="rl-tag">{policy.id}</span>
                  <span className={`rl-pill ${statusTone(policy.status)}`}>{statusLogLabel(policy.status)}</span>
                </div>
                <h2 className="mt-2 text-xl font-semibold">{policy.location_label}</h2>
                <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                  {perilLabel(policy.peril)} &middot; clock ends {displayTime(policy.coverage_end)}
                </p>
                <div className="mt-3 flex gap-6 text-sm">
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
            ))
          )}
        </div>
      </section>
      <aside>
        <TransactionRail />
      </aside>
    </main>
  );
}
