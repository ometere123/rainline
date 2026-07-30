# Rainline Decision Record

## Provenance note on this record

This decision record does not re-run an eight-candidate brainstorm from zero. The idea —
parametric weather micro-insurance — was already picked by the project owner from the same
shortlist that produced the sibling `permamission` project in this workspace (see its
`DECISION.md`, candidate 3: "Rainline Cover: parametric insurance for weather-triggered small
business losses"). What follows is honest reasoning about why *this* idea clears every gate
GenLayer projects are judged on, not a re-derivation of alternatives that were already set
aside when the owner chose it.

## The product

A farmer, market-stall owner, or outdoor events operator buys a policy against one peril
(rain, heat, wind, or air quality) at one location for a coverage window, paying a premium in
native GEN into a shared pool. After the window ends, anyone can permissionlessly trigger
`check_claim`, which fetches weather-station data, a satellite/precipitation-style summary, and
local news/community reports for that location and window, and asks GenLayer consensus to
reconcile them into a banded severity verdict. MODERATE or SEVERE pays the policyholder out of
the pool automatically; NONE or MINOR resolves with no payout; conflicting or missing evidence
returns INSUFFICIENT_EVIDENCE, which is retryable rather than final.

## Counterfactual: why not a single oracle or backend

A conventional parametric insurer runs a backend that pulls one weather API, applies a
threshold, and pays or denies. Two distrusting parties sit on either side of that API call:

- **The farmer/policyholder** wants a payout whenever their real losses match a real weather
  event, and is exposed if the insurer's chosen single feed is late, sparse, wrong for their
  exact coordinates, or simply not queried in good faith when a payout is expensive for the
  insurer.
- **The pool/other policyholders** (and, in effect, the insurer standing behind the pool) want
  payouts to happen only for real events, and are exposed if a single feed is gamed, stale, or
  reports a nearby but non-representative station reading as if it were the insured location.

A single backend, even a well-intentioned one, is *both* the party that decides and the party
with a financial stake in that decision, or is trusted blindly by both sides if run by a third
party. GenLayer removes that single point of trust: independent validators each fetch the
evidence themselves inside consensus and must reach the same categorical verdict before a
transfer is authorized.

## Why the payout decision is irreducibly semantic

This is not "read one deterministic price/weather feed and compare to a number." Three
qualitatively different evidence types are combined for every claim:

1. **Weather-station data** — numeric but noisy, station-sparse in rural/small-farm areas, and
   frequently reported with hedging language ("near-record", "isolated pockets of").
2. **Satellite/precipitation-summary text** — a narrative characterization of conditions over an
   area, not a single number for a single coordinate.
3. **Local news/community reports** — free-text corroboration or contradiction ("flooding
   reported in the district" vs. "dry spell continues") that a deterministic parser cannot
   reliably reconcile against the other two.

Deciding whether these three sources, taken together, mean the insured threshold was crossed —
and by how much — requires judgement: is a station reading representative of the insured
coordinates, does a satellite summary corroborate or contradict it, do local reports change the
picture, and is the combined picture even complete enough to decide at all. That is exactly the
class of question `gl.eq_principle.prompt_comparative` exists for: validators must independently
gather the same evidence and agree at the level of meaning (a severity band), not at the level
of an identical byte-for-byte computation.

## Non-determinism budget

Every `check_claim` call is one consensus round containing exactly **four** non-deterministic
operations inside the leader function, evaluated once per validator under
`prompt_comparative`:

1. `gl.nondet.web.render(...)` — fetch weather-station style evidence for the location/window.
2. `gl.nondet.web.render(...)` — fetch satellite/precipitation-summary style evidence.
3. `gl.nondet.web.render(...)` — fetch local news/community-report style evidence.
4. `gl.nondet.exec_prompt(...)` — reconcile all three sources into one banded verdict with a
   supporting rationale, returned as JSON.

This sits at the top of the target 2-4 operation budget deliberately: dropping any one of the
three fetches would remove exactly the cross-source reconciliation that makes the decision
semantic rather than a single-feed lookup, which is the whole point of the gate below.

## Abstention: INSUFFICIENT_EVIDENCE is not a denial

If the three sources conflict, or none of them carry location/date-specific detail, the leader
(and, under the comparative principle, every validator) is instructed to return
`INSUFFICIENT_EVIDENCE` rather than force a guess between "no loss" and "loss." The contract
routes that verdict to `STATUS_CHECKING`, *not* `STATUS_DECLINED` or `STATUS_PAID_OUT` — the
policy is left resolvable. After a fixed cooldown (`RECHECK_COOLDOWN_SECONDS`, 30 minutes),
anyone can call `check_claim` again, permissionlessly, without requiring the original
policyholder to be present or the insurer/admin to act. This is the keeper pattern: a busy or
disengaged party can never permanently block a resolvable claim, and the contract never
silently sits on an ambiguous verdict.

## Latency architecture: fast writes vs. the slow step

- `buy_policy` is a pure deterministic write: validate inputs, take payment via
  `@gl.public.write.payable`, store the policy, and return an id. No consensus round, no LLM,
  no web fetch — fast and cheap, exactly like an ordinary transaction.
- `check_claim` is the one slow step. It is guarded by a deterministic gate (coverage window
  must have ended, or cooldown must have elapsed since the last INSUFFICIENT_EVIDENCE check)
  *before* any nondeterministic operation runs, so a call that cannot yet be evaluated fails
  cheaply with `gl.vm.UserError` rather than burning a consensus round.
- `check_claim` is explicitly permissionless — any address may call it once the gate opens, not
  only the policyholder or the admin. Combined with the retryable `INSUFFICIENT_EVIDENCE`
  outcome, in-flight claims are always resumable by anyone, which is the intended pattern for a
  slow, evidence-fetching consensus step that must not depend on one specific caller's
  availability.
- `expire_unclaimed` is a second, separate deterministic sweep for policies nobody ever
  triggered a claim check on at all, callable by anyone after coverage end plus the same
  cooldown, so a forgotten policy still reaches a terminal state instead of sitting active
  forever.

## Value handling and terminal states

Premiums are paid into a shared pool (`pool_balance`), not to individual per-policy escrow, so
the pool can cover payouts even when a given policyholder's individual premium is smaller than
their payout amount — this is the actuarial pooling that makes insurance work at all, and it is
also why gate B (two distrusting parties) is satisfied *within the value flow itself*: a
policyholder wants their own claim paid; the rest of the pool wants that payout to only happen
on a real, evidenced loss, because it comes out of shared funds.

Every terminal state has an explicit resting place for funds:

- `STATUS_PAID_OUT` — `emit_transfer` moves `payout_amount` (capped at available pool balance)
  to the policyholder.
- `STATUS_DECLINED` — premium remains in the pool; no transfer.
- `STATUS_EXPIRED_NO_CLAIM` — premium remains in the pool; no transfer (nobody ever triggered a
  check, so there is nothing to adjudicate).
- `STATUS_CHECKING` (abstention) is explicitly *not* terminal — it is a retry state, and funds
  simply remain in the pool until a subsequent check resolves it.

## Gates (A-G) walkthrough

- **A — Two distrusting parties**: policyholder (wants real losses paid) vs. the shared pool /
  other policyholders (wants no payout without real evidence). See counterfactual above.
- **B — Native value at stake**: premiums and payouts are real GEN moving through
  `@gl.public.write.payable` and `emit_transfer`, not a side-channel record.
- **C — Irreducibly semantic decision**: reconciling numeric station data, narrative satellite
  summaries, and free-text local reports into one severity band is judgement, not a
  deterministic feed comparison.
- **D — Evidence fetched contract-side**: all three `gl.nondet.web.render` calls happen inside
  the leader function of the same consensus round that produces the verdict.
- **E — Reusable, not a one-shot demo**: any number of policies, perils, and locations can be
  created and checked over the contract's lifetime; nothing about the design assumes a single
  use.
- **F — Decision depth / recoverability**: `INSUFFICIENT_EVIDENCE` is retryable via a
  permissionless cooldown-gated recheck rather than a dead end.
- **G — Latency-appropriate architecture**: fast deterministic writes for policy creation,
  a separate, explicitly slow, permissionlessly-triggerable consensus step for claim
  evaluation, with a deterministic pre-gate so ineligible calls fail cheaply.

## Self-audit

The closest sibling idea in the original shortlist is PermaMission (evidence-gated fund
release under a charter). Rainline differs in three structural ways: it pools value from many
independent premium-payers rather than one steward's treasury, it reconciles three
heterogeneous evidence types per decision instead of one evidence URL, and its abstention state
is time-cooldown-gated and keeper-triggered rather than challenge-triggered. If parametric
insurance were unavailable as a direction, the next best fit from the original shortlist would
have been TrapForge (objective-but-still-evidence-graded payouts), but it lacks the
three-source reconciliation that makes Rainline's decision genuinely semantic rather than a
single pass/fail check.
