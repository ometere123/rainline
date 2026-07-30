import { BuyPolicyForm } from "@/components/write-actions";

export default function NewPolicyPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <span className="rl-tag">Open a ticket</span>
      <h1 className="mt-2 text-3xl font-semibold">Write your ticket into the log</h1>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
        What you stake below joins the Cistern, the shared pool that funds every ticket's payout, not just yours.
        Nothing pays out until a future reading finds MODERATE or SEVERE against the threshold you set here.
      </p>
      <div className="mt-8">
        <BuyPolicyForm />
      </div>
    </main>
  );
}
