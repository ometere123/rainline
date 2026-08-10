const steps = [
  {
    title: "01. Request a quote",
    body: "Name a peril (rain, heat, wind, air quality), a location, a structured threshold (a number and a window kind, not a sentence), a coverage window, and how much payout you want. GenLayer consensus fetches real historical climatology for that spot and prices how likely your condition is, historically, into a risk band. No GEN moves yet.",
  },
  {
    title: "02. Read the band, then buy",
    body: "The quote comes back with a risk band (LOW, MODERATE, HIGH, or UNPRICEABLE), a rationale citing the real historical figures the model saw, and the exact premium required for the payout you asked for. Buying pays that premium in GEN. It doesn't go to Rainline; it joins the Cistern, the shared pool that funds every payout, not just yours.",
  },
  {
    title: "03. The weather clock runs",
    body: "Your ticket sits ACTIVE for the whole window. Nothing needs to happen on-chain during this time. The deterministic gate that opens a reading simply hasn't unlocked yet. No one is watching a clock on your behalf; the contract just refuses reads before the window closes.",
  },
  {
    title: "04. Anyone can pull a reading",
    body: "Once the window closes, calling check_claim is permissionless. You, a neighbor, or an automated keeper can pull it. The contract fetches weather-station data, a satellite/precipitation summary, and local reports itself, for your exact location and dates, and compares them directly against your structured threshold. Nobody self-reports; the chain goes and looks.",
  },
  {
    title: "05. Validators log a verdict",
    body: "GenLayer validators independently gather the same three reads, normalize them into the policy's canonical unit, and reconcile disagreement into one numeric measurement. The contract then compares that value with the stored threshold itself. No narrative label or insurer can override the arithmetic.",
  },
  {
    title: "06. Static isn't a denial",
    body: "If the reads disagree or lack detail for your exact coordinates and dates, the log records INSUFFICIENT_EVIDENCE: static, not silence. The ticket stays open for a retry after a cooldown. A claim is never dropped for being inconvenient to answer. The same discipline applies to a quote that comes back UNPRICEABLE: it is an honest abstention, not a guess dressed up as a number.",
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
