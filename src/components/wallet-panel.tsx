"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Download, KeyRound, LogOut, PlugZap } from "lucide-react";
import { useWallet } from "./wallet-provider";
import { shortenAddress } from "@/lib/format";

export function WalletPanel() {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const [importValue, setImportValue] = useState("");
  const [message, setMessage] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function connectInjected() {
    try {
      await wallet.connectInjected();
      setMessage("Injected wallet connected.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not connect wallet.");
    }
  }

  function copyKey() {
    const key = wallet.exportPrivateKey();
    if (!key) return setMessage("No browser wallet key is active yet.");
    navigator.clipboard.writeText(key);
    setMessage("Private key copied. This is non-custodial: store it yourself. Rainline never sees it.");
  }

  function disconnect() {
    wallet.disconnect();
    setMessage("Disconnected. Your browser wallet key stays saved locally.");
  }

  return (
    <div className="relative" ref={panelRef}>
      <button className="rl-btn-primary flex items-center gap-2 px-3 py-2 text-sm" onClick={() => setOpen((value) => !value)}>
        <KeyRound size={14} aria-hidden /> {wallet.mode === "none" ? "Connect wallet" : shortenAddress(wallet.address)}
      </button>
      {open ? (
        <div className="rl-station absolute right-0 z-20 mt-3 w-80 p-4">
          <span className="rl-tag">Active identity</span>
          <div className="rl-mono mt-1 break-all text-sm">{wallet.address ?? "Browsing read-only"}</div>
          <div className="mt-4 grid gap-2">
            <button className="rl-btn-ghost flex items-center justify-center gap-2 px-3 py-2 text-sm" onClick={wallet.useGenerated}>
              <KeyRound size={14} aria-hidden /> Use browser wallet
            </button>
            <button className="rl-btn-ghost flex items-center justify-center gap-2 px-3 py-2 text-sm" onClick={connectInjected}>
              <PlugZap size={14} aria-hidden /> Use injected wallet
            </button>
            <button className="rl-btn-ghost flex items-center justify-center gap-2 px-3 py-2 text-sm" onClick={copyKey}>
              <Download size={14} aria-hidden /> Export browser key
            </button>
            {wallet.mode !== "none" ? (
              <button className="rl-btn-ghost flex items-center justify-center gap-2 px-3 py-2 text-sm" onClick={disconnect}>
                <LogOut size={14} aria-hidden /> Disconnect
              </button>
            ) : null}
          </div>
          <div className="mt-4 rounded-md border p-3 text-xs" style={{ borderColor: "hsl(var(--warn)/0.5)", background: "hsl(var(--warn)/0.1)", color: "hsl(var(--warn))" }}>
            The browser wallet is a locally generated key, non-custodial, and stored only in this browser&apos;s
            localStorage. Export and back it up before relying on it. Losing it means losing access to policies
            bought with it.
          </div>
          <label className="mt-4 block" htmlFor="import-key">
            <span className="rl-tag">Import browser key</span>
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="import-key"
              className="rl-input flex-1"
              value={importValue}
              onChange={(event) => setImportValue(event.target.value)}
              placeholder="0x..."
            />
            <button
              className="rl-btn-ghost px-3"
              onClick={() => {
                wallet.importGenerated(importValue as `0x${string}`);
                setMessage("Imported.");
              }}
              title="Import"
            >
              <Copy size={16} aria-hidden />
            </button>
          </div>
          {message ? (
            <p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]" aria-live="polite">
              {message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
