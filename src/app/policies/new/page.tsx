import { RequestQuoteThenBuy } from "@/components/write-actions";

export default function NewPolicyPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <span className="rl-tag">Open a ticket</span>
      <h1 className="mt-2 text-3xl font-semibold">Request a quote, then write it into the log</h1>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
        First, GenLayer consensus prices how likely your condition is, historically, at this location and
        window -- a real climatology fetch and a risk band, not a guess. Only after that is priced can you buy
        cover, and only for the exact premium the band requires. What you stake joins the Cistern, the shared
        pool that funds every ticket&apos;s payout, not just yours. Nothing pays out until a future reading
        finds MODERATE or SEVERE against the threshold you set here.
      </p>
      <div className="mt-8">
        <RequestQuoteThenBuy />
      </div>
    </main>
  );
}
