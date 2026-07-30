import Link from "next/link";
import { CloudRain } from "lucide-react";
import { WalletPanel } from "./wallet-panel";
import { ThemeToggle } from "./theme-toggle";

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
              Open a Ticket
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
        Rainline is a GenLayer Intelligent Contract. The deployed contract is the sole source of truth for every
        ticket, stake, reading, and payout, this site only reads and writes to it.
      </footer>
    </div>
  );
}
