import Link from "next/link";

export const dynamic = "force-dynamic";

const readingLine: Array<{ n: string; title: string; body: string; kind: "det" | "nondet" }> = [
  { n: "01", title: "Ticket terms", body: "Peril, location, threshold, and coverage window, written straight to storage, no judgement involved.", kind: "det" },
  { n: "02", title: "Premium → Cistern", body: "The stake leaves the holder's wallet and joins the shared pool. Arithmetic, not opinion.", kind: "det" },
  { n: "03", title: "Station gauge read", body: "Validators independently fetch weather-station data for the exact coordinates and window.", kind: "nondet" },
  { n: "04", title: "Sky read", body: "A second, independent fetch, satellite or precipitation summary for the same location and dates.", kind: "nondet" },
  { n: "05", title: "Ground read", body: "A third fetch, local news and community reports that corroborate or contradict the instruments.", kind: "nondet" },
  { n: "06", title: "Consensus verdict", body: "gl.eq_principle.prompt_comparative reconciles all three reads into one banded call: NONE, MINOR, MODERATE, SEVERE, or static.", kind: "nondet" },
  { n: "07", title: "Payout or static", body: "MODERATE/SEVERE pays out from the Cistern automatically. Static logs an abstention and reopens for retry, never a silent denial.", kind: "det" },
];

const whyHard: Array<[string, string]> = [
  ["One station isn't the field", "The nearest weather station can sit miles from the actual farm, close enough to look official, far enough to be wrong."],
  ["Sky and ground don't always agree", "Satellite precipitation estimates and station gauges routinely diverge on exactly the storms worth paying for."],
  ["The payer grading its own claim", "An insurer scoring its own payout has no structural reason to find in the holder's favor."],
  ["Thresholds are sentences, not numbers", "\"Sustained wind damaging enough to flatten a crop\" isn't a value a script can parse against a feed."],
  ["Self-reports can be staged", "Photos and receipts submitted by the claimant alone are evidence of nothing but the claimant's story."],
  ["Nobody has weeks to wait", "A human adjuster driving out to inspect a field is a two-week decision for a payout that was due before harvest."],
];

const howItWorks: Array<[string, string]> = [
  ["Open a ticket", "Any wallet can stake a premium against a peril, a location, and a plain-language threshold."],
  ["The clock runs, untouched", "Coverage sits ACTIVE. The deterministic gate that unlocks a reading simply hasn't opened yet, nothing to trust in the meantime."],
  ["Anyone pulls the reading", "Once the window closes, check_claim is permissionless. A keeper, a neighbor, or the holder themselves can call it."],
  ["Validators log what they found", "Consensus reconciles the three reads into a severity band and writes it, rationale included, to the ticket."],
  ["Static reopens, it doesn't close", "Conflicting or thin evidence logs as static. The ticket stays claimable; a cooldown, not a denial, stands between it and a retry."],
];

export default function Home() {
  return (
    <div>
      <section className="mx-auto max-w-3xl px-5 pb-4 pt-14 text-center">
        <span className="rl-tag">Parametric weather cover</span>
        <h1 className="mx-auto mt-4 max-w-2xl text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
          The weather doesn&rsquo;t lie to a validator.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-[hsl(var(--muted-foreground))]">
          RAINLINE is a GenLayer-native weather station for farms and outdoor businesses. Holders stake a premium
          against a peril and a threshold at a location. GenLayer validators pull the weather themselves and log a
          non-deterministic consensus verdict. Nobody&rsquo;s word decides the payout but the reading.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/policies/new" className="rl-btn-primary px-5 py-3">
            Open a Cover Ticket
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
          <h2 className="mt-2 text-2xl font-semibold">What actually happens between a stake and a payout</h2>
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
