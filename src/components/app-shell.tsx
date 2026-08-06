import Link from "next/link";
import { CloudRain, ExternalLink } from "lucide-react";
import { WalletPanel } from "./wallet-panel";
import { ThemeToggle } from "./theme-toggle";
import { CONTRACT_ADDRESS, explorerAddressUrl } from "@/lib/genlayer/config";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen rl-isobars">
      <header className="border-b border-[hsl(var(--border))]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-5 py-5">
          <Link href="/" className="flex items-center gap-3">
            <span
              className="flex h-11 w-11 items-center justify-center border text-lg font-semibold"
              style={{ borderColor: "hsl(var(--primary)/0.4)", color: "hsl(var(--primary))" }}
            >
              <CloudRain size={20} aria-hidden />
            </span>
            <span className="leading-tight">
              <span className="block text-xl font-semibold tracking-[0.14em]">RAINLINE</span>
              <span className="rl-tag block">Weather Claims Station</span>
            </span>
          </Link>
          <nav className="flex flex-wrap items-center gap-2" aria-label="Primary">
            <Link className="rl-btn-ghost px-4 py-2 text-sm" href="/policies">
              The Ledger
            </Link>
            <Link className="rl-btn-primary px-4 py-2 text-sm" href="/policies/new">
              Request a Quote
            </Link>
            <Link className="rl-btn-ghost px-4 py-2 text-sm" href="/dashboard">
              Your Tickets
            </Link>
            <ThemeToggle />
            <WalletPanel />
          </nav>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="mx-auto max-w-5xl px-5 py-10 text-sm text-[hsl(var(--muted-foreground))]">
        <p>
          Rainline is a GenLayer Intelligent Contract. The deployed contract is the sole source of truth for every
          quote, ticket, stake, reading, and payout, this site only reads and writes to it.
        </p>
        {CONTRACT_ADDRESS ? (
          <a
            className="mt-3 inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
            href={explorerAddressUrl(CONTRACT_ADDRESS)}
            target="_blank"
            rel="noreferrer"
          >
            View contract on the StudioNet explorer
            <ExternalLink size={13} aria-hidden />
          </a>
        ) : null}
      </footer>
    </div>
  );
}
