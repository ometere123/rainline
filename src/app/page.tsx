import Link from "next/link";

export const dynamic = "force-dynamic";

const readingLine: Array<{ n: string; title: string; body: string; kind: "det" | "nondet" }> = [
  { n: "01", title: "Request a quote", body: "Peril, location, a structured threshold, a coverage window, and how much payout you want, written straight to a quote record. No GEN moves yet.", kind: "det" },
  { n: "02", title: "Climatology round", body: "GenLayer validators independently fetch years of historical weather for the exact coordinates and window, and price how likely your condition is into a risk band.", kind: "nondet" },
  { n: "03", title: "Premium derived, not chosen", body: "LOW, MODERATE, or HIGH sets a fixed multiplier. The contract computes the exact premium your requested payout requires; you never pick a number yourself.", kind: "det" },
  { n: "04", title: "Premium → Cistern", body: "Buying the quote pays that exact premium. It leaves the holder's wallet and joins the shared pool. Arithmetic, not opinion.", kind: "det" },
  { n: "05", title: "Station gauge read", body: "Once coverage ends, validators independently fetch weather-station data for the exact coordinates and window.", kind: "nondet" },
  { n: "06", title: "Sky read", body: "A second, independent fetch, satellite or precipitation summary for the same location and dates.", kind: "nondet" },
  { n: "07", title: "Ground read", body: "A third fetch, local news and community reports that corroborate or contradict the instruments.", kind: "nondet" },
  { n: "08", title: "Consensus verdict", body: "gl.eq_principle.prompt_comparative reconciles all three reads into one banded call against your structured threshold: NONE, MINOR, MODERATE, SEVERE, or static.", kind: "nondet" },
  { n: "09", title: "Payout or static", body: "MODERATE/SEVERE pays out from the Cistern automatically. Static logs an abstention and reopens for retry, never a silent denial.", kind: "det" },
];

const whyHard: Array<[string, string]> = [
  ["One station isn't the field", "The nearest weather station can sit miles from the actual farm, close enough to look official, far enough to be wrong."],
  ["Sky and ground don't always agree", "Satellite precipitation estimates and station gauges routinely diverge on exactly the storms worth paying for."],
  ["The payer grading its own claim", "An insurer scoring its own payout has no structural reason to find in the holder's favor."],
  ["A free-text trigger prices nothing", "\"Any measurable rainfall\" is easy to write and easy to trigger. Without a structured condition and a priced likelihood, a loose trigger just drains everyone else's premiums."],
  ["Self-reports can be staged", "Photos and receipts submitted by the claimant alone are evidence of nothing but the claimant's story."],
  ["Nobody has weeks to wait", "A human adjuster driving out to inspect a field is a two-week decision for a payout that was due before harvest."],
];

const howItWorks: Array<[string, string]> = [
  ["Request a quote", "Any wallet can ask for a price on a peril, a location, a structured threshold, and a payout amount. GenLayer prices it before anyone pays anything."],
  ["Buy at the priced premium", "The quote comes back with a risk band and an exact required premium. Paying it is the only way to open a ticket, at the exact terms already quoted."],
  ["The clock runs, untouched", "Coverage sits ACTIVE. The deterministic gate that unlocks a reading simply hasn't opened yet, nothing to trust in the meantime."],
  ["Anyone pulls the reading", "Once the window closes, check_claim is permissionless. A keeper, a neighbor, or the holder themselves can call it."],
  ["Validators log what they found", "Consensus reconciles the three reads into a severity band against your structured threshold and writes it, rationale included, to the ticket."],
  ["Static reopens, it doesn't close", "Conflicting or thin evidence logs as static. The ticket stays claimable; a cooldown, not a denial, stands between it and a retry."],
];

export default function Home() {
  return (
    <div>
      <section className="mx-auto max-w-3xl px-5 pb-4 pt-14 text-center">
        <span className="rl-tag">Parametric weather cover, priced before you buy</span>
        <h1 className="mx-auto mt-4 max-w-2xl text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
          The weather doesn&rsquo;t lie to a validator.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-[hsl(var(--muted-foreground))]">
          RAINLINE is a GenLayer-native weather station for farms and outdoor businesses. Request a quote on a
          peril, a location, and a structured threshold, and GenLayer prices how likely it is from real historical
          weather before you pay anything. Buy at the priced premium, and validators pull the weather themselves
          when coverage ends. Nobody&rsquo;s word decides the payout but the reading.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/policies/new" className="rl-btn-primary px-5 py-3">
            Request a Quote
          </Link>
          <Link href="/policies" className="rl-btn-ghost px-5 py-3">
            Read the Ledger
          </Link>
          <Link href="/dashboard" className="rl-btn-ghost px-5 py-3">
            My Tickets
          </Link>
        </div>
      </section>

      {/* The Reading Line, the literal pipeline data walks through, deterministic
          steps and nondet consensus steps visually distinguished */}
      <section className="mx-auto max-w-4xl px-5 py-16">
        <div className="text-center">
          <span className="rl-tag">The reading line</span>
          <h2 className="mt-2 text-2xl font-semibold">What actually happens between a quote and a payout</h2>
        </div>
        <div className="mt-10 space-y-4">
          {readingLine.map((step, i) => (
            <div key={step.n} className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}>
              <div className="rl-gauge w-full max-w-sm" data-tick={step.kind === "nondet" ? "CONSENSUS" : "DETERMINISTIC"}>
                <div className="flex items-baseline gap-2">
                  <span className="rl-tag">{step.n}</span>
                  <h3 className="text-sm font-semibold">{step.title}</h3>
                </div>
                <p className="mt-1.5 text-sm leading-6 text-[hsl(var(--muted-foreground))]">{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Why weather claims are hard to trust, the counterfactual, made concrete */}
      <section className="mx-auto max-w-5xl px-5 py-14">
        <span className="rl-tag">Why weather claims are hard to trust</span>
        <h2 className="mt-2 max-w-xl text-2xl font-semibold">A single feed was never going to settle this fairly</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {whyHard.map(([title, body]) => (
            <div className="rl-station p-5" key={title}>
              <h3 className="text-sm font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How Rainline resolves it, in order */}
      <section className="mx-auto max-w-3xl px-5 py-14">
        <span className="rl-tag">How Rainline works</span>
        <ol className="mt-5 space-y-5">
          {howItWorks.map(([title, body], i) => (
            <li className="rl-log-entry py-1" key={title}>
              <div className="flex items-baseline gap-2">
                <span className="rl-tag">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="text-base font-semibold">{title}</h3>
              </div>
              <p className="mt-1.5 max-w-lg text-sm leading-6 text-[hsl(var(--muted-foreground))]">{body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8">
          <Link href="/how-it-works" className="text-sm underline-offset-4 hover:underline">
            Read the full station manual
          </Link>
        </div>
      </section>
    </div>
  );
}
