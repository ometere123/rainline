export function shortenAddress(address?: string) {
  if (!address) return "No address";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatGen(value?: string | bigint | number) {
  const raw = BigInt(value || 0);
  const whole = raw / 1_000_000_000_000_000_000n;
  const fraction = (raw % 1_000_000_000_000_000_000n).toString().padStart(18, "0").slice(0, 3);
  return `${whole}.${fraction} GEN`;
}

export function parseGen(value: string) {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Enter a valid GEN amount.");
  }
  const [whole = "0", fraction = ""] = trimmed.split(".");
  const cleanFraction = fraction.padEnd(18, "0").slice(0, 18);
  return BigInt(whole || "0") * 1_000_000_000_000_000_000n + BigInt(cleanFraction || "0");
}

export function displayTime(iso?: string) {
  if (!iso) return "Not yet";
  const normalized = iso.endsWith("Z") ? iso : iso.includes("+") ? iso : `${iso}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function statusTone(status: string) {
  if (status === "PAID_OUT" || status === "MODERATE" || status === "SEVERE") {
    return "text-[hsl(var(--good))] border-[hsl(var(--good)/0.5)] bg-[hsl(var(--good)/0.12)]";
  }
  if (status === "DECLINED" || status === "NONE" || status === "MINOR") {
    return "text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.5)]";
  }
  if (status === "CHECKING" || status === "INSUFFICIENT_EVIDENCE" || status === "UNDETERMINED") {
    return "text-[hsl(var(--warn))] border-[hsl(var(--warn)/0.5)] bg-[hsl(var(--warn)/0.12)]";
  }
  if (status === "EXPIRED_NO_CLAIM" || status === "REFUNDED") {
    return "text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))] bg-transparent";
  }
  return "text-[hsl(var(--accent-foreground))] border-[hsl(var(--accent)/0.5)] bg-[hsl(var(--accent)/0.15)]";
}

export function perilLabel(peril: string) {
  return { RAIN: "Rain / flood", HEAT: "Extreme heat", WIND: "Wind", AIR: "Air quality" }[peril] ?? peril;
}

// Rainline's own log vocabulary. The contract's real enum value is always
// shown alongside these (see rl-tag usage), this only supplies the voice
// the station log speaks in, never a fact the chain didn't report.
export function statusLogLabel(status: string) {
  return (
    {
      ACTIVE: "Weather clock running",
      EXPIRED_NO_CLAIM: "Closed, no reading pulled",
      CHECKING: "Reading in progress",
      PAID_OUT: "Paid from the Cistern",
      DECLINED: "Logged clear",
      REFUNDED: "Returned to holder",
    }[status] ?? status.replaceAll("_", " ")
  );
}

export function verdictLogLabel(verdict: string) {
  return (
    {
      NONE: "Clear reading",
      MINOR: "Minor disturbance",
      MODERATE: "Moderate break, pays out",
      SEVERE: "Severe break, pays out",
      INSUFFICIENT_EVIDENCE: "Logged as static",
    }[verdict] ?? verdict.replaceAll("_", " ")
  );
}
