const steps = [
  {
    title: "01. Open a ticket",
    body: "Name a peril (rain, heat, wind, air quality), a location, a plain-language threshold, and a coverage window. Pay a premium in GEN. It doesn't go to Rainline; it joins the Cistern, the shared pool that funds every payout, not just yours.",
  },
  {
    title: "02. The weather clock runs",
    body: "Your ticket sits ACTIVE for the whole window. Nothing needs to happen on-chain during this time. The deterministic gate that opens a reading simply hasn't unlocked yet. No one is watching a clock on your behalf; the contract just refuses reads before the window closes.",
  },
  {
    title: "03. Anyone can pull a reading",
    body: "Once the window closes, calling check_claim is permissionless. You, a neighbor, or an automated keeper can pull it. The contract fetches weather-station data, a satellite/precipitation summary, and local reports itself, for your exact location and dates. Nobody self-reports; the chain goes and looks.",
  },
  {
    title: "04. Validators log a verdict",
    body: "GenLayer validators each independently gather the same three reads and reconcile them into a severity band: NONE, MINOR, MODERATE, or SEVERE. MODERATE and SEVERE draw an automatic payout from the Cistern. No adjuster signs off, and no insurer's word decides it.",
  },
  {
    title: "05. Static isn't a denial",
    body: "If the reads disagree or lack detail for your exact coordinates and dates, the log records INSUFFICIENT_EVIDENCE: static, not silence. The ticket stays open for a retry after a cooldown. A claim is never dropped for being inconvenient to answer.",
  },
];

export default function HowItWorksPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <span className="rl-tag">Station manual</span>
      <h1 className="mt-2 text-3xl font-semibold">How a ticket moves through the log</h1>
      <p className="mt-4 text-sm leading-7 text-[hsl(var(--muted-foreground))]">
        Rainline replaces a single insurer&apos;s weather feed with a GenLayer Intelligent Contract that fetches its
        own evidence and asks independent validators to agree on what it means, at the moment a reading is pulled.
      </p>
      <ol className="mt-8 space-y-6">
        {steps.map((step) => (
          <li key={step.title} className="rl-log-entry py-2">
            <h2 className="text-lg font-semibold">{step.title}</h2>
            <p className="mt-2 text-sm leading-7 text-[hsl(var(--muted-foreground))]">{step.body}</p>
          </li>
        ))}
      </ol>
    </main>
  );
}
