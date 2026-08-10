# Rainline

Parametric micro-insurance for small farms and outdoor businesses, settled by GenLayer consensus
instead of a single insurer's weather feed.

## Reviewer summary

Rainline is a complete GenLayer parametric insurance app. A buyer requests a **quote** for a
structured weather condition (peril, location, a numeric threshold, and a coverage window);
GenLayer consensus prices how likely that condition is, historically, at that location and time
of year, and returns a risk band. Only then can the buyer **buy** a policy from that quote, for
the exact premium the band requires. After the coverage window closes, anyone can trigger a
**claim check**; the Intelligent Contract fetches real weather evidence from independent public
sources, asks GenLayer validators to reconcile it, and pays eligible claims from a shared GEN
pool called the Cistern.

### Aug 10 review response

For a concise request-by-request evidence trail, see
[`REVIEW_RESPONSE.md`](./REVIEW_RESPONSE.md).

This revision directly addresses the requested production and settlement corrections:

- **Production quote discovery no longer uses `list_quotes_by_requester`.** The app snapshots
  `get_summary().quote_count` before the write, waits for finalization, reads every new
  `RLQ-{sequence}` through `get_quote`, and matches requester plus all submitted terms. This is
  the same summary/direct-read strategy proven in the repository, hardened for concurrent users.
- **The StudioNet integration proof cannot pass without a purchase.**
  `test_finalized_quote_is_found_by_production_reads_and_purchased` discovers the finalized quote
  through those production reads, pays its exact premium, verifies the quote was consumed, and
  verifies the policy copied the quoted terms. `UNPRICEABLE` is a failure for this proof, not a
  silent early return.
- **Provider observations are normalized before reconciliation.** Rain and heat already share
  mm and degrees C respectively; Open-Meteo wind is explicitly requested in km/h and NASA
  `WS10M_MAX` is converted from m/s by exactly 3.6. NASA `-999` and declared fill values are
  missing data, never zero. Cumulative aggregation is restricted to rainfall.
- **Consensus no longer authorizes payout with a severity word.** It resolves disagreement into
  `resolved_value_milli`, a canonical measurement in thousandths of the policy unit. The
  deterministic contract compares that value with the exact stored `threshold_value`; only that
  arithmetic sets `trigger_met` and moves GEN. Severity is derived afterward for display.
- **Air quality was removed rather than falsely normalized.** NASA `AOD_55` is aerosol optical
  depth, not AQI, so treating it as an independent AQI reading would be scientifically invalid.

GenLayer is central to the product at two separate points, not one: pricing *likelihood* before a
policy can be bought, and judging *occurrence* after coverage ends. Both are irreducibly semantic
— weather sources disagree materially across grid models and time, and there is no deterministic
formula that turns raw numbers into "how likely is this" or "did this actually happen here."

- **Live app**: add deployment URL here when published
- **Source**: add GitHub repo URL here when published
- **Contract**: `0x12eDBfD43d0cc1Be9DC090Bbe35bA66578b9A2ED`
- **Main workflow**: request a quote (consensus prices historical likelihood into a risk band) ->
  buy cover from that quote for its exact required premium -> wait for the coverage window to end
  -> trigger `check_claim` -> validators normalize and reconcile public evidence into a numeric
  measurement -> contract evaluates the stored trigger and pays qualifying claims.

A policyholder requests cover against one peril (rain/flood, extreme heat, or wind)
at one location, for a structured condition (e.g. "rainfall >= 80mm, single-day max") over a
future coverage window. GenLayer consensus fetches real historical climatology for that
location/window and prices a risk band (`LOW` / `MODERATE` / `HIGH` / `UNPRICEABLE`), which fixes
both the premium and the payout: the buyer states how much cover they want, and the contract
derives the premium the band requires to back it, into a shared pool (called "the Cistern" in the
UI). After coverage ends, **anyone** can permissionlessly trigger `check_claim`. The Intelligent
Contract then fetches, from inside consensus, two independent real meteorological APIs (ECMWF
ERA5 reanalysis via Open-Meteo, and NASA POWER satellite-derived data) plus a corroborating report
search, and asks GenLayer validators to reconcile normalized observations into one canonical
numeric measurement. Deterministic contract arithmetic compares that measurement with the exact
trigger stored at purchase; the LLM's prose and severity label cannot authorize a payout.

The two numeric sources sit on different models at different grid resolutions and **routinely
disagree** — on the day the 2024 Valencia flood killed over 200 people, ERA5 recorded 105 mm and
NASA POWER recorded 21.9 mm for the same coordinates. Deciding which reading reflects what
actually happened on one insured field is a judgement call, not a formula, and it is the reason
this contract needs consensus rather than an oracle.

**Proven on-chain**: the reviewer-specific StudioNet integration test finalized a real `LOW`
quote, discovered it through the production summary/direct-read strategy, purchased it for the
exact quoted premium, and verified both quote consumption and copied policy terms. The current
corrected deployment is linked below; the earlier full claim trace is retained as historical
evidence and clearly labeled.

## Problem and counterfactual

A conventional parametric insurer runs a backend that reads one weather API and applies a
threshold. Two parties distrust that single point: the **farmer**, who is exposed if the chosen
feed is late, sparse, or simply not queried in good faith when a payout is expensive; and the
**pool of other policyholders**, who are exposed if that same single feed is gamed or
non-representative of the insured coordinates. GenLayer removes the single point of trust:
independent validators each fetch the evidence themselves and must reach the same categorical
verdict before value moves. The full reasoning — including why the decision is irreducibly
semantic, the non-determinism budget for both consensus rounds, the abstention design, and the
gate-by-gate walkthrough — is in [`DECISION.md`](./DECISION.md).

## Structured thresholds (this pass)

Before this pass, `buy_policy` took a free-text `threshold_label` string the buyer wrote
themselves ("More than 80mm of rain in a 24h window..."), and `check_claim` asked the model to
*interpret* that sentence against fetched evidence. Nothing stopped a buyer writing an
easy-to-trigger condition in prose and buying near-max leverage against it — the existing
solvency gates bounded claim *size*, never claim *likelihood*.

A `Policy` (and a `Quote`) now carries a fully structured condition instead:

- **metric**: implied by `peril`, not stored as a separate field — `RAIN` always means
  `RAINFALL_MM`, `HEAT` always means `MAX_TEMP_C`, and `WIND` always means `WIND_KMH`. Air quality
  is intentionally excluded because NASA AOD cannot be honestly normalized into AQI.
- **operator**: always `>=`. Every peril modeled here is "too much of X"; there is no real
  parametric-insurance use case in this product for "too little rain" or "too cool", so a second
  operator would be generality nothing calls.
- **value**: a `u256`, wei-scaled the same way `premium`/`payout_amount` already are, so the
  whole contract stays on one numeric representation.
- **window**: `SINGLE_DAY_MAX` for every peril, or `CUMULATIVE` for rainfall only. Summing daily
  maxima for heat or wind is not a meaningful insured measurement and is rejected on-chain.

`check_claim`'s prompt now compares the fetched ERA5/NASA POWER numbers against this structured
condition directly ("is `RAINFALL_MM >= 80mm` true, evaluated as the single-day max") instead of
asking the model to interpret a sentence. The model's job is narrowed to reading and normalizing
real numbers and resolving ERA5-vs-NASA-POWER disagreement. It returns a canonical measurement;
the contract itself evaluates whether the structured condition was met.

## Quote-band underwriting (this pass)

Structured thresholds fix claim *description*; they do not, by themselves, fix claim
*likelihood*. A buyer could still write `RAINFALL_MM >= 0.1mm` (a condition that is met almost
every rainy day) and, under the old flat 10x-premium cap, buy a large payout against something
nearly certain to trigger. `request_quote` adds real underwriting: before any policy can be
bought, a **second, separate** GenLayer consensus round prices how likely the condition is,
historically, at that location and time of year — "how often has this happened here", not "did it
happen this time."

**The flow, end to end:**

1. A wallet calls `request_quote(peril, location_label, latitude, longitude, threshold_value,
   window, coverage_start, coverage_end, requested_payout)`. This is a real, separate consensus
   round: the leader fetches roughly 3 years of continuous daily climatology from Open-Meteo's
   archive API for the same coordinates, and a `gl.eq_principle.prompt_comparative` round bands
   the result into `LOW` / `MODERATE` / `HIGH` / `UNPRICEABLE`, mirroring `check_claim`'s
   severity-band pattern deliberately — the model is never asked to return a raw probability,
   only a category.
2. The contract, not the buyer, derives `required_premium = ceil(requested_payout /
   BAND_MULTIPLIER[risk_band])`, floored at a minimum so a tiny requested payout can't round to
   dust. The quote is stored on-chain — id, requester, peril, location/coordinates, structured
   threshold, coverage window, `requested_payout`, `risk_band`, `required_premium`, a rationale
   citing the real historical figures the model saw, `created_at`/`expires_at` (a 40-minute TTL,
   in the same band as the existing 30-minute `RECHECK_COOLDOWN_SECONDS`), and a `consumed` flag.
3. `buy_policy_from_quote(quote_id)` — a payable write — requires the quote to exist, be
   unexpired, be unconsumed, and carry a priceable band; the transaction value must equal
   `required_premium` exactly (see "Why exact value, not `>=`" below). The policy it creates
   copies the quote's fixed terms verbatim: `payout_amount = requested_payout`, `premium =
   required_premium`. `buy_policy` (the old free-form, single-step purchase) is gone entirely —
   `buy_policy_from_quote` is the only way a policy comes into existence, so every policy is
   always quoted first.

**Why the buyer states `requested_payout`, and the contract derives the premium, rather than the
other way around**: an earlier version of this pass let the buyer choose both premium and payout
independently, up to a band-derived ceiling. That reopened the exact unpriced-leverage gap this
feature exists to close — a buyer could still pick a premium *under* the ceiling for the same
payout. Deriving premium mechanically from the quote's fixed terms leaves the buyer exactly one
dial (how much cover to request), with the price for that cover fixed entirely by the risk the
consensus round already priced.

**Risk-band payout multiples** (replacing the old flat `MAX_PAYOUT_MULTIPLIER = 10` for every
policy regardless of likelihood):

| Band | Multiple | Reasoning |
|---|---|---|
| `LOW` | 15x premium | A condition judged unlikely, historically, at this location/window can carry a higher payout multiple for the same premium — the reward side of correctly-priced insurance: rare risks are cheap to insure heavily. |
| `MODERATE` | 8x premium | Roughly the old flat 10x, shaded down because a moderate historical hit-rate means the pool should expect to pay this out more often than a LOW-band policy. |
| `HIGH` | 3x premium | Still insurable — real parametric products do cover "yes, it usually gets hot in August, insure me a little anyway" — but the multiple must be small enough that the premium itself is doing most of the work, not the pool's other policyholders. |
| `UNPRICEABLE` | refused outright | Mirrors `INSUFFICIENT_EVIDENCE`'s abstention discipline: thin or conflicting historical data (e.g. fewer than 2 comparable past years present) means the contract has no honest basis to price this at all, at any multiple. |

**All existing solvency gates still apply, on top of the band-derived premium**: the
concentration cap (a single policy's payout can never exceed 20% of the resulting pool balance)
and the aggregate `outstanding_liability` invariant (total contingent liability across every
`ACTIVE`/`CHECKING` policy can never exceed `pool_balance`) both bind exactly as before, now
computed against the quote's fixed `requested_payout`/`required_premium` instead of buyer-chosen
values. `tests/direct/test_rainline.py::test_aggregate_liability_invariant_still_binds_across_quotes`
demonstrates gate 3 still catching an adversarial multi-quote split.

**Why exact value, not `>=`**: this project already has one documented, unresolved defect — a
reverted `@gl.public.write.payable` call does not refund `gl.message.value` (see "Honest
limitations"). Accepting overpayment and crediting only `required_premium` to the pool would
strand the excess by that exact same mechanism, a second stranded-value edge case layered on the
first. Requiring an exact match means overpayment is simply rejected before any state changes —
the buyer's wallet still shows the funds, and the transaction can be resubmitted with the correct
value.

**Who may buy from a quote**: any address, not only the one that requested it. A quote's content
is public market data about a location/peril/window, not a private offer — restricting purchase
to the requester would cut against this contract's existing permissionless philosophy
(`check_claim` and `expire_unclaimed` are both already callable by anyone). The `consumed` flag,
not sender identity, is what prevents a quote from being double-spent.

**A real bug this discovered, not hidden**: because `required_premium` is always strictly less
than `requested_payout` for any real leveraged policy (every band multiple is >= 3), the 20%-of-
pool concentration cap is mathematically impossible to satisfy for the *very first* purchase
against a completely empty pool, on any deployment. The first real StudioNet deploy of this
redesign could not sell its own first policy until `fund_pool()` — a plain deterministic payable
deposit, no consensus, no policy created, does not touch `outstanding_liability` — was added
specifically to break that bootstrap deadlock, mirroring how a real parametric insurer's pool is
seeded by underwriters/liquidity providers depositing capital independent of any single policy.
See `DECISION.md`'s "Underwriting" section for the full reasoning.

**Another real bug this discovered, fixed before the final deployment**: the very first live
quote request on this contract returned a technically-correct-but-absurd rationale
("the condition being priced is RAINFALL_MM >= 8e19 mm") because `threshold_value` is stored
wei-scaled on-chain (multiplied by 10^18, matching `premium`/`payout_amount`) and the prompt was
interpolating that raw scaled integer directly instead of converting it back to the real-world
quantity first. Both `_consensus_quote` and `_consensus_claim` now compute
`threshold_display = int(threshold_value) // 10**18` before it ever reaches a prompt. This is
exactly the kind of defect that only surfaces by actually running the contract on real
infrastructure with real values, which is why this README's on-chain proof section uses the
*post-fix* deployment.

## Evidence fetches: what they can and cannot find

`check_claim`'s leader function performs three `gl.nondet.web.render` calls plus one
`gl.nondet.exec_prompt` reconciliation. Two of the three legs are **direct calls to real, keyless
meteorological APIs** that return machine-readable numeric observations for the exact insured
coordinates and date range:

| Leg | Source | What it is |
|---|---|---|
| A | `archive-api.open-meteo.com` | ECMWF **ERA5 / ERA5-Land** reanalysis, ~9–31km grid |
| B | `power.larc.nasa.gov` | NASA **MERRA-2 / SYN1DEG** satellite-derived, ~50km grid |
| C | `en.wikipedia.org/w/api.php` | Wikipedia search API — qualitative ground-truth corroboration |

A and B are deliberately **independent providers on different underlying models and grid
resolutions, so they can and do disagree.** That disagreement is the whole reason this contract
needs consensus judgement rather than a single oracle feed. It is *basis risk*: the documented
central weakness of parametric insurance, where a coarse grid cell smooths away a real localised
event, or spreads a nearby event across a field that was never affected. Two concrete measured
examples, both independently reproducible with `curl`:

- Valencia, Spain, 2024-10-29 (catastrophic flood): **ERA5 105.0 mm** vs **NASA POWER 21.9 mm** —
  a ~5x disagreement on a day that killed over 200 people. A contract wired to NASA POWER alone
  would have declined that claim.
- Houston, Texas, 2017-08-27 (Hurricane Harvey): **ERA5 143.0 mm** vs **NASA POWER 237.3 mm** —
  both far above any sane threshold, so the direction is unambiguous even though the magnitudes
  differ by ~65%.

The prompt tells validators exactly how to normalize this: rainfall remains mm, heat remains
degrees C, Open-Meteo wind is requested in km/h, NASA wind is converted from m/s to km/h, and
`-999`/fill values are discarded. If A and B broadly agree, resolve the canonical measurement;
if they disagree materially, use leg C to break the tie; if they disagree materially
**and** C is empty or off-location, return `INSUFFICIENT_EVIDENCE` rather than picking a side.
It is explicitly told not to average the two numbers.

Leg C uses Wikipedia's API rather than a search engine on purpose. An earlier version of this
contract used Google (and then DuckDuckGo) for all three legs; **StudioNet's validator fetches are
served bot-detection pages by general search engines**, which was observed directly on-chain, not
assumed. Wikipedia's API is keyless, machine-readable, and answers reliably; it surfaces named,
dated articles for significant weather and legitimately returns little for a minor local event,
which correctly pushes borderline cases toward abstention instead of a fabricated corroboration.

**`request_quote`'s climatology leg is a single continuous multi-year range, not one call per
year.** Verified against the real Open-Meteo archive API with `curl` before writing the contract:
the API only accepts one continuous `start_date`/`end_date` range per call — there is no "same
calendar day across N disjoint years" query. Fetching each of the last 5-10 years separately
would need 5-10 separate `gl.nondet.web.render` calls on its own, blowing the entire 2-4
operation non-determinism budget before the reconciliation prompt is even counted. The one-fetch
alternative that fits the budget is a single continuous range covering roughly the 3 years
immediately prior to the proposed coverage window (`curl`-measured at ~20KB / ~1100 days of daily
JSON for a real 3-year span), with the reconciliation prompt told to locate the calendar days
matching the target window within each year present. This trades "5-10 years of history" down to
"~3 years" in exchange for staying at one fetch — see "Honest limitations" below.

Every fetch is wrapped (`_safe_render`) so a hard failure degrades that one source to the literal
string `[FETCH_UNAVAILABLE]` rather than raising. Before this guard, a blocked fetch raised an
uncaught `NondetException` that aborted the whole leader with `execution_result: ERROR` — worse
than a clean abstention, because the consensus round burns without reaching a resolvable state.
The prompt treats `[FETCH_UNAVAILABLE]` as missing evidence, never as evidence of a calm period,
and mandates `INSUFFICIENT_EVIDENCE` if both numeric legs are unavailable.

## The solvency gates (why they exist, and their limits)

Every purchase, regardless of risk band, passes three deterministic checks — pure arithmetic, no
LLM involved — before a policy is ever written to storage:

1. **Pricing-discipline cap**: enforced *by construction* at quote time now, not re-checked at
   purchase time — `required_premium` was computed as `ceil(requested_payout /
   BAND_MULTIPLIER[risk_band])`, so `payout_amount` can never exceed `multiple * premium` once
   the exact-transaction-value check has passed.
2. **Concentration cap**: `payout_amount <= pool_balance_after_premium / 5`. A single new policy
   can never be responsible for more than 20% of the pool, so one qualifying trigger cannot wipe out
   the backing for every other ticket.
3. **Aggregate solvency invariant**: `outstanding_liability` — the sum of `payout_amount` across
   every policy currently `ACTIVE` or `CHECKING` — can never exceed `pool_balance`. Gate 2 alone
   bounds only the newest policy; an adversary can split a large ask across many quotes, each
   individually inside its own 20%-of-pool-at-the-time cap, so that the *sum* creeps past the
   pool balance.
   `tests/direct/test_rainline.py::test_aggregate_liability_invariant_still_binds_across_quotes`
   demonstrates this attack against the new quote-derived premiums specifically. Liability is
   released back (`_release_liability`) whenever a policy leaves `ACTIVE`/`CHECKING` for a
   terminal state (`PAID_OUT`, `DECLINED`, `EXPIRED_NO_CLAIM`).

`get_summary()` returns `outstanding_liability` and `quote_count` so both can be read directly
on-chain.

This is still not real actuarial pricing — `BAND_MULTIPLIER`'s three values and
`LIABILITY_SAFETY_DIVISOR = 5` are fixed, auditable numbers chosen for defensibility, not fitted
to loss data, and the climatology window backing each risk band is ~3 years of one location's
history, not a fitted statistical model. What quote-band underwriting fixes is the structural gap
between claim size (already bounded) and claim likelihood (previously unpriced entirely).

## Architecture

- **Contract**: [`contracts/Rainline.py`](./contracts/Rainline.py) — a single `gl.Contract`
  storing policies in a `TreeMap[str, Policy]` and quotes in a `TreeMap[str, Quote]`, each with
  an id index, admin address, shared `pool_balance`, and `outstanding_liability`.
  `fund_pool` and `buy_policy_from_quote` are deterministic `@gl.public.write.payable` writes.
  `request_quote` and `check_claim` are the two slow steps, each its own
  `gl.eq_principle.prompt_comparative` consensus round: `request_quote` performs one
  `gl.nondet.web.render` climatology fetch plus one `gl.nondet.exec_prompt` risk-banding
  reconciliation (2 operations); `check_claim` is gated by a deterministic pre-check (coverage
  window ended, or cooldown elapsed since the last abstention) before any nondeterministic
  operation, then performs three `gl.nondet.web.render` evidence fetches (each wrapped against
  fetch failure) and one `gl.nondet.exec_prompt` reconciliation (4 operations). Both rounds stay
  within the project's 2-4 nondet-operation budget; see `DECISION.md` for the full accounting.
- **Tests**: `tests/direct/` (glsim/pytest, mocked web + LLM, no network needed) and
  `tests/integration/` (gltest against a live StudioNet deployment).
- **Frontend**: Next.js App Router + TypeScript strict + Tailwind v4, `src/app` for routes,
  `src/components` for the two-wallet system, transaction lifecycle UI, and the two-step
  quote-then-buy flow, `src/lib` for the GenLayer client/contract/storage plumbing and the
  `formatThreshold` helper that renders a structured condition as readable text ("rainfall >=
  80mm, single-day max"). Every ticket is listed on `/policies` ("The Ledger"), deep-linkable at
  `/policy/[policyId]`, and readable without connecting a wallet. Dark mode is the default, with
  a toggle to light mode.

## Two-wallet system and transaction lifecycle

A locally generated, non-custodial browser wallet persisted in `localStorage` with export/import,
or an injected `window.ethereum` wallet via `client.connect('studionet')`. Both read and write
through the same `genlayer-js@1.1.8` client. Every write is tracked with its real consensus stage
(PROPOSING/COMMITTING/REVEALING/ACCEPTED/FINALIZED), and UNDETERMINED/VALIDATORS_TIMEOUT/
LEADER_TIMEOUT are surfaced as retryable states rather than hard errors
(`src/components/transaction-provider.tsx`). The quote-request step reuses this same lifecycle UI
— it is a real, separate consensus round, not a fast read.

## Deployed contract (StudioNet)

- **Address**: `0x12eDBfD43d0cc1Be9DC090Bbe35bA66578b9A2ED`
- **Explorer**: https://explorer-studio.genlayer.com/address/0x12eDBfD43d0cc1Be9DC090Bbe35bA66578b9A2ED
- **Deploy tx**: `0x5a5c689d6e521efd1fb4e32573a14b2e4bf22a475bf4dcc71a22156cd9a4be72`

This is the current deployment, carrying the Aug 10 review fixes: canonical provider units,
numeric trigger settlement, safe production quote discovery support, structured thresholds,
quote-band underwriting, and all solvency and no-retroactive-cover gates. `.env.local` and this
document point at it.

### Current corrected deployment proof

The fresh deployment is not bare. These writes were finalized against the address above:

| Step | Tx | Verified state |
|---|---|---|
| Deploy corrected contract | `0x5a5c689d6e521efd1fb4e32573a14b2e4bf22a475bf4dcc71a22156cd9a4be72` | Execution `SUCCESS`, one-round majority agreement |
| Seed shared pool with 1000 GEN | `0xe0bebc04c18834c042a9435b354f2cac4a2a61d43e3a9231fcc70eae3911f642` | `pool_balance = 1000 GEN`, no policy created |
| Price Houston RAIN >= 80 mm | `0x5ceb712f08bf085e5118c8d5832ae855c2b230ad4b9bff6b59ef1825d78ccbc6` | `RLQ-1`, `LOW`, exact premium `0.133333333333333334 GEN` |
| Buy the finalized quote | `0x87337a4be2fe6b52d96be381e3e188f776c90847545a7655a967a85273502f68` | `RLQ-1.consumed = true`; `RLN-1` copied every quoted term |

Direct reads after purchase show `quote_count = 1`, `policy_count = 1`, pool balance
`1000.133333333333333334 GEN`, and outstanding liability `2 GEN`. The policy is `ACTIVE`; its
future coverage ends at `2026-08-10T14:02:14Z`, so no claim result is fabricated before the
insured window closes.

Two earlier deploys of this pass are superseded and kept only in git history: one hit a real
`TypeError: Rainline.__init__() takes 1 positional argument but 2 were given` from passing an
explicit empty `--args '[]'` to the `genlayer` CLI for a zero-argument constructor (omit `--args`
entirely for a no-arg contract); the next deployed and ran, but was replaced once the
wei-scaling prompt bug above was found, so no on-chain proof is recorded against either.

### No retroactive cover

Both `request_quote` and `buy_policy_from_quote` require `coverage_start` to be strictly after
the transaction timestamp. Without this, a buyer could price or buy cover over a window that had
already elapsed — insuring a storm they already knew had happened — and claim on it immediately,
which is guaranteed adverse selection against every other holder in the pool. The check is
re-applied at purchase time even though `request_quote` already enforced it, because time passes
between requesting a quote and buying from it.

Because the check is a lexicographic string comparison, both bounds are format-validated first
(`_require_iso_utc`): a non-numeric string like `"zzzz…"` sorts above every real timestamp and
would otherwise read as far-future and walk straight past the gate. That specific bypass is caught
one step earlier by the existing `coverage_end > coverage_start` ordering check, so the two
together leave no lexicographic way around it. Both paths have tests. An unreadable clock fails
closed.

### Historical full-flow proof (pre-Aug 10 settlement correction)

The `genlayer` CLI's `write` command hardcodes `value: 0n`, so it cannot exercise any payable
method (`fund_pool`, `buy_policy_from_quote`). `scripts/onchain-verify.mjs` uses `genlayer-js`
directly — `createClient`, `createAccount`, `writeContract` with a real non-zero `value: bigint`,
`waitForTransactionReceipt` — to run the full fund -> quote -> buy -> claim flow with actual GEN
on StudioNet.

The following real transactions prove the earlier quote/buy/claim plumbing against superseded
deployment `0x723B…Ab2f`. They are not presented as proof of the new numeric-trigger logic; that
logic is covered by 67 direct tests and the reviewer-specific live quote-to-buy integration test.

| Step | Tx | Result |
|---|---|---|
| `fund_pool` (payable, **1000 GEN**, no consensus) | `0xbf7604c4ab8c86aa964c22a27eece3eea9549c133bba0f3668d639b750aafe18` | `FINALIZED` — pool seeded, no policy created |
| `request_quote` (consensus round, real climatology fetch) | `0xdaec344d2134fd043fbc99c4b930b89b75064e2c966024d7f8f969b2db8fec6a` | `FINALIZED` — `RLQ-3` created, risk band **`LOW`** |
| `buy_policy_from_quote` (payable, exact required premium **0.5333 GEN**) | `0xf79e5ab703d0a38c84439bae36568bd2e580dbc9f185d4afdeeb4bf30d882d27` | `FINALIZED` — `RLN-1` created, `payout_amount` 8 GEN |
| `check_claim` (consensus round, 3 real fetches + reconciliation) | `0xf00aa65965377f3ffe6081d1b0c3d1f0c1fce4e9902c0fb8358edd871da7e4ec` | `FINALIZED` — verdict **`NONE`**, policy `DECLINED` |

The quote (`RLQ-3`) priced RAIN >= 80mm (single-day max) at Nairobi, Kenya (-1.286389, 36.817223)
for a coverage window on 2026-07-31. The real rationale the model returned, citing real
Open-Meteo history:

> "The coverage window is only one hour on 2026-07-31, and the contract evaluates the single
> worst day in that window, so the relevant historical comparison is daily rainfall around 31
> July in prior years. Across the 3 comparable past years present, the exact matching day never
> came remotely close to the 80 mm threshold: max observed on 31 July was 0.40 mm, which is 79.6
> mm below the trigger. Even including adjacent days, the largest nearby value was only 2.40 mm.
> This is strong evidence that an 80 mm daily rainfall event at Nairobi at this time of year is
> historically extremely uncommon in the supplied record, so LOW is appropriate."

Climatology summary stored on-chain: "Comparable same-time-of-year days around 31 July in the
archive are: 2023-07-31 = 0.00 mm, 2024-07-31 = 0.10 mm, and 2025-07-31 = 0.40 mm precipitation.
Nearby days are also very low: 2023-07-30 = 1.10 mm and 2023-08-01 = 2.40 mm; 2024-07-30 = 0.10 mm
and 2024-08-01 = 0.20 mm; 2025-07-30 = 0.30 mm and 2025-08-01 = 1.10 mm." LOW band meant the
15x multiplier applied: an 8 GEN requested payout required a premium of exactly `8 / 15` GEN
(533333333333333334 wei), which the contract derived itself — the buyer never chose a premium.

The claim check, once the coverage window (2026-07-31T01:11:08Z -> 02:11:08Z) had genuinely
elapsed, reached a clean **`NONE`** verdict with real, independently-reproducible evidence
stored on the policy:

> **`station_summary`** — "SOURCE A (Open-Meteo ERA5) reports precipitation_sum = 1.10 mm and
> precipitation_hours = 5.0 h for 2026-07-31 at the insured coordinates."
>
> **`satellite_summary`** — "SOURCE B (NASA POWER) reports PRECTOTCORR = -999.0 mm/day for
> 20260731, which is the documented fill/missing-value sentinel for the POWER Daily API... No
> valid numeric precipitation reading was returned."
>
> **`report_summary`** — "SOURCE C returned Wikipedia search hits about general East African
> climate, Maasai religion, Ongata Rongai (nearby town), and a European flooding event. None
> describe a specific heavy-rainfall event in Nairobi on 2026-07-31."
>
> **`severity_rationale`** — "...SOURCE A gives a concrete, valid ERA5 reading of 1.10 mm...
> far below 80 mm. SOURCE B returned only the -999.0 fill value, which per the API's own header
> is a missing-data sentinel, not a measurement of a calm period; it therefore cannot be treated
> as evidence of low rainfall... The single best day observed (1.10 mm) is well under the 80 mm
> threshold, so the structured condition was not met. Verdict: NONE."

The model again correctly recognised NASA POWER's `-999.0` sentinel as missing data rather than
zero rainfall (the same pattern observed on the previous deployment's proof run), and declined
on the strength of the one source that had a real number. `get_summary()` after the claim:
`pool_balance = 5000533333333333333334`, `outstanding_liability = 0` — the premium stayed in the
pool, no payout, exactly correct for a clean decline. A clean `NONE`/`DECLINED` verdict is kept
here rather than only reporting a flattering `SEVERE` payout, consistent with this project's
practice of recording real results honestly.

**A real revert, kept in rather than hidden**: the first quote requested against this deployment
(`RLQ-1`, tx `0x8d5e77630a804c1d3a2074930bf387a507ac15423108907ab96aaba6d0d9cf72`) used a coverage
window only ~5 minutes out, sized for the old synchronous purchase flow. By the time the buy
transaction (`0x1fd12f2629f5356d250ea0ea5efa27c16f908483162bcd7ea895ba8801223656`) actually
executed, `request_quote`'s own live consensus round had already consumed most of that 5-minute
buffer, so `coverage_start` had passed and the retroactive-cover guard correctly refused the
purchase (`execution_result: ERROR`) — while still moving the 0.5333 GEN premium into
`contract_balance` without crediting `pool_balance`, the same documented reverted-payable-write
gap described in "Honest limitations". This is exactly the discovery that motivated widening the
lead time used for quote-then-buy flows (both in this proof run and in the integration test
suite's `_window()` helper) from ~20s to several minutes.

### Tests

#### Direct tests (`tests/direct/`, glsim + pytest, no network)

```
python -m pytest tests/direct/ -v
```

Result: **67 passed**. Coverage includes quote creation and every stored field, the
quote-expiry boundary on both sides (`QUOTE_TTL_SECONDS = 2400`), UNPRICEABLE quotes refused at
purchase, each risk band's correct premium/payout relationship, buying from an expired or
already-consumed quote reverting, the exact-transaction-value requirement (both underpayment and
overpayment), the ceiling-division premium calculation (an evenly-divisible case, a
rounds-up case, and the minimum-premium floor engaging on a tiny requested payout),
`fund_pool` crediting balance without creating a policy, and the aggregate liability invariant
still binding across multiple quotes. `check_claim` against the structured threshold is covered
by the pre-existing basis-risk-disagreement and both-sources-agree tests, updated for the
structured condition shape, plus adversarial tests proving severity prose cannot override a
below-threshold measurement and cannot suppress a measurement exactly equal to the trigger.

#### Integration tests (`tests/integration/`, gltest against StudioNet)

```
python -m pytest tests/integration/ -v -s --network studionet
```

Because the contract refuses retroactive cover, integration windows are generated from the real
clock. The reviewer-specific purchase proof uses a one-hour lead time so even a slow or retried
quote round remains purchasable.

Current reviewer proof:

```
gltest tests/integration/test_rainline_integration.py::test_finalized_quote_is_found_by_production_reads_and_purchased -v -s --network studionet
```

Result: **1 passed in 170.81s**. The test deployed and funded a fresh contract, finalized a real
`LOW` quote, found it through the same `get_summary` + `get_quote` strategy used in production,
paid its exact `133333333333333334` wei premium, verified `quote.consumed == true`, and verified
the resulting policy copied the quote id, premium, payout, peril, and active status. It contains
no `UNPRICEABLE` early-return path, so it cannot report success without purchasing a policy.

The broader historical StudioNet suite previously completed all eight deploy, funding, rejection,
purchase, and live claim scenarios; those runs predate the Aug 10 numeric-settlement correction.
The corrected claim arithmetic is covered by the 67-test direct suite, including explicit tests
that contradictory severity prose cannot override the resolved numeric value.

### Static checks

```
PYTHONIOENCODING=utf-8 genvm-lint check contracts/Rainline.py --json
```

Result: `{"ok":true,"lint":{"ok":true,"passed":3},"validate":{"ok":true,"contract":"Rainline",
"methods":11,"view_methods":6,"write_methods":5,"ctor_params":0}}` — clean, with one informational
warning (`I200`) that a newer py-genlayer runner is available.

Note for anyone reproducing this: `genvm-linter` installs a `genvm-lint.exe` shim into Python's
`Scripts/` directory, which is not necessarily on `PATH`. Invoke it by absolute path if
`genvm-lint` is not resolvable in your shell.

```
npx tsc --noEmit   # clean
npm run lint       # eslint -- clean
```

## Local development

```
npm install
npm run dev
```

`.env.local` (gitignored, but expected to exist locally) sets `NEXT_PUBLIC_GENLAYER_CHAIN=studionet`
and `NEXT_PUBLIC_RAINLINE_CONTRACT` to the deployed address above. Visiting the app with no wallet
connected still lets you browse every ticket read-only; connecting (browser-generated or
injected) is only required to request a quote, buy cover, or trigger a claim check yourself.

## Honest limitations

- **Underwriting is climatology from one location's recent past, not actuarial pricing.**
  `request_quote` prices likelihood off roughly 3 years of one Open-Meteo grid cell's history for
  one location, not a fitted loss model across peril/location/seasonality/historical claims data.
  `BAND_MULTIPLIER`'s three values (15x/8x/3x) and `LIABILITY_SAFETY_DIVISOR = 5` are fixed,
  auditable numbers chosen for defensibility, not fitted to any loss model.
- **The climatology fetch trades year-count for staying within the non-determinism budget.**
  "Last 5-10 years" (the spec's ideal) is not reachable in one `gl.nondet.web.render` call —
  Open-Meteo's archive API has no day-of-year-across-years filter, only continuous ranges — so
  the contract uses ~3 trailing years in one continuous fetch instead. For a sparse location with
  little history, or a metric with high year-to-year variance, 3 years of one grid cell is a
  materially thinner basis than 5-10 years would be. `UNPRICEABLE` is the intended answer when
  that thinness makes the band genuinely unclear, not a guess.
- **A reverted payable write does not refund the value sent with it.** This is a real, verified
  defect carried over from the pre-quote design. `gl.message.value` moves to the contract
  *before* the method body runs, so when a payable write raises, the state change is rolled back
  but the GEN is not returned. `buy_policy_from_quote`'s exact-value requirement (see "Quote-band
  underwriting" above) is a deliberate design choice to avoid *adding* a second version of this
  gap via silently-pocketed overpayment; it does not fix the underlying one. Every `[EXPECTED]`
  condition is revalidated client-side in `preflightQuoteError`
  (`src/components/write-actions.tsx`) so a request that would revert is never sent in the first
  place. A production fix needs payable writes to refund-and-return instead of raising, which
  changes their return contract and every revert-based test, or a reconciliation sweep that
  credits untracked balance back into the pool. Neither was attempted here rather than risk the
  solvency accounting that is currently proven correct.
- **Grid resolution is a real limit on the evidence, even with real APIs.** ERA5 (~9–31km) and
  NASA POWER (~50km) are both gridded products. Neither is a gauge sitting in the insured field,
  so a sharply localised event can still be smoothed away by both. The three-source design
  narrows basis risk; it does not eliminate it.
- **`INSUFFICIENT_EVIDENCE` and `UNPRICEABLE` are both expected outcomes for genuinely ambiguous
  cases**, by design. Neither is a failure mode, and the contract will not be pushed into
  guessing when the evidence disagrees without corroboration, or when historical data is too
  thin to price honestly.
- **StudioNet balances are simulated.** There is no EVM settlement layer, so while a real payout
  demonstrably moves `pool_balance` and releases contingent liability in contract state, that is
  not the same assurance as value settling on a production chain.
- **The injected-wallet path (`window.ethereum` via a real browser extension) was not walked
  end-to-end in this pass** — the automated environment available here has no real wallet
  extension installed, so this path could only be inspected by reading its code
  (`src/components/wallet-provider.tsx`, `client.connect('studionet')`). This is the one wallet
  path that still needs a human with a real extension configured for StudioNet.
- **No Vercel deployment and no demo video** — explicitly out of scope for this pass.
