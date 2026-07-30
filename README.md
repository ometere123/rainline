# Rainline

Parametric micro-insurance for small farms and outdoor businesses, settled by GenLayer consensus
instead of a single insurer's weather feed.

A policyholder buys cover against one peril (rain/flood, extreme heat, wind, or air quality) at
one location, for one coverage window, paying a premium in native GEN into a shared pool (called
"the Cistern" in the UI). After coverage ends, **anyone** can permissionlessly trigger
`check_claim`. The Intelligent Contract then fetches, from inside consensus, two independent real
meteorological APIs (ECMWF ERA5 reanalysis via Open-Meteo, and NASA POWER satellite-derived data)
plus a corroborating report search, and asks GenLayer validators to reconcile all three into a
banded severity verdict (NONE / MINOR / MODERATE / SEVERE / INSUFFICIENT_EVIDENCE). MODERATE and
SEVERE pay out automatically from the pool.

The two numeric sources sit on different models at different grid resolutions and **routinely
disagree** — on the day the 2024 Valencia flood killed over 200 people, ERA5 recorded 105 mm and
NASA POWER recorded 21.9 mm for the same coordinates. Deciding which reading reflects what
actually happened on one insured field is a judgement call, not a formula, and it is the reason
this contract needs consensus rather than an oracle.

**Proven on-chain**: a real policy over Hurricane Harvey (Houston, 26–29 Aug 2017) reached a
`SEVERE` verdict and paid out, moving the pool from 100 GEN to 80 GEN. Transaction hashes and the
verbatim evidence the validators stored are in [Real on-chain proof](#real-on-chain-proof-not-simulated).

## Problem and counterfactual

A conventional parametric insurer runs a backend that reads one weather API and applies a
threshold. Two parties distrust that single point: the **farmer**, who is exposed if the chosen
feed is late, sparse, or simply not queried in good faith when a payout is expensive; and the
**pool of other policyholders**, who are exposed if that same single feed is gamed or
non-representative of the insured coordinates. GenLayer removes the single point of trust:
independent validators each fetch the evidence themselves and must reach the same categorical
verdict before value moves. The full reasoning — including why the decision is irreducibly
semantic, the non-determinism budget, the abstention design, and the gate-by-gate walkthrough —
is in [`DECISION.md`](./DECISION.md).

## The solvency gate (why it exists, and its limits)

Before this pass, `buy_policy` let a buyer set an arbitrary `payout_amount` independent of the
premium they staked, with no cap relative to what the pool could actually cover. That made
"insurance" an unpriced, unbounded side-bet: a 1 GEN premium could ask for an 8, 80, or 8000 GEN
payout, funded entirely by other buyers' premiums, with no arithmetic connecting the two and no
protection against the pool promising more than it holds.

`buy_policy` now enforces three deterministic checks — pure arithmetic, no LLM involved — before
a policy is ever written to storage:

1. **Pricing cap**: `payout_amount <= premium * 10`. A policy can never promise more than 10x
   its own premium. This is a **simplification standing in for real actuarial pricing** — a
   production insurer would price this off historical loss data, peril, location, and coverage
   window, not a single fixed multiplier. 10x was chosen as a defensible ceiling for parametric
   micro-insurance (rare severe-peril payouts in real parametric products commonly run 5-20x
   loss ratios) without letting one cheap policy claim a payout that dwarfs its own contribution.
2. **Concentration cap**: `payout_amount <= pool_balance_after_premium / 5`. A single new policy
   can never be responsible for more than 20% of the pool, so one SEVERE verdict cannot wipe out
   the backing for every other ticket.
3. **Aggregate solvency invariant**: the contract now tracks `outstanding_liability` — the sum
   of `payout_amount` across every policy currently `ACTIVE` or `CHECKING` (i.e. everything that
   could still trigger a payout) — and rejects any new policy that would push
   `outstanding_liability` above `pool_balance`. This is the actual bug being closed: gate 2
   alone bounds only the newest policy, but an adversary can split a large ask across many
   small-premium policies, each individually inside its own 20%-of-pool-at-the-time cap, so that
   the *sum* creeps past the pool balance. `tests/direct/test_rainline.py::test_buy_policy_rejects_when_total_liability_would_exceed_pool_balance`
   demonstrates exactly this attack and shows gate 3 catching it where gate 2 alone would not.
   Liability is released back (`_release_liability`) whenever a policy leaves `ACTIVE`/`CHECKING`
   for a terminal state (`PAID_OUT`, `DECLINED`, `EXPIRED_NO_CLAIM`).

`get_summary()` now also returns `outstanding_liability` so this can be read directly on-chain.

This is still not real underwriting — there is no peril-, location-, or seasonality-specific
pricing, and the constants (`MAX_PAYOUT_MULTIPLIER = 10`, `LIABILITY_SAFETY_DIVISOR = 5`) are
fixed, auditable numbers chosen for defensibility, not fitted to loss data. What it does fix is
the structural insolvency bug: the pool can no longer be talked into promising more than it
holds.

## Evidence fetches: what they can and cannot find

`check_claim`'s leader function performs three `gl.nondet.web.render` calls plus one
`gl.nondet.exec_prompt` reconciliation. Two of the three legs are **direct calls to real, keyless
meteorological APIs** that return machine-readable numeric observations for the exact insured
coordinates and date range:

| Leg | Source | What it is |
|---|---|---|
| A | `archive-api.open-meteo.com` (or `air-quality-api` for the AIR peril) | ECMWF **ERA5 / ERA5-Land** reanalysis, ~9–31km grid |
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

The prompt tells the model exactly how to weigh this: if A and B broadly agree, band the severity
confidently; if they disagree materially, use leg C to break the tie; if they disagree materially
**and** C is empty or off-location, return `INSUFFICIENT_EVIDENCE` rather than picking a side.
It is explicitly told not to average the two numbers.

Leg C uses Wikipedia's API rather than a search engine on purpose. An earlier version of this
contract used Google (and then DuckDuckGo) for all three legs; **StudioNet's validator fetches are
served bot-detection pages by general search engines**, which was observed directly on-chain, not
assumed — the first real `check_claim` run on this contract returned
`"No local reports found (SOURCE C unavailable)"` with DuckDuckGo. Wikipedia's API is keyless,
machine-readable, and answers reliably; it surfaces named, dated articles for significant weather
and legitimately returns little for a minor local event, which correctly pushes borderline cases
toward abstention instead of a fabricated corroboration.

Every fetch is wrapped (`_safe_render`) so a hard failure degrades that one source to the literal
string `[FETCH_UNAVAILABLE]` rather than raising. Before this guard, a blocked fetch raised an
uncaught `NondetException` that aborted the whole leader with `execution_result: ERROR` — worse
than a clean abstention, because the consensus round burns without reaching a resolvable state.
The prompt treats `[FETCH_UNAVAILABLE]` as missing evidence, never as evidence of a calm period,
and mandates `INSUFFICIENT_EVIDENCE` if both numeric legs are unavailable.

## Architecture

- **Contract**: [`contracts/Rainline.py`](./contracts/Rainline.py) — a single `gl.Contract`
  storing policies in a `TreeMap[str, Policy]` plus an id index, admin address, shared
  `pool_balance`, and `outstanding_liability`. `buy_policy` is a deterministic
  `@gl.public.write.payable` write gated by the three solvency checks above. `check_claim` is the
  one slow step: a deterministic pre-gate (coverage window ended, or cooldown elapsed since the
  last abstention) runs before any nondeterministic operation, then a single
  `gl.eq_principle.prompt_comparative` round performs three `gl.nondet.web.render` evidence
  fetches (each wrapped against fetch failure) and one `gl.nondet.exec_prompt` reconciliation —
  four nondeterministic operations total, within the 2-4 budget.
- **Tests**: `tests/direct/` (glsim/pytest, mocked web + LLM, no network needed) and
  `tests/integration/` (gltest against a live StudioNet deployment).
- **Frontend**: Next.js App Router + TypeScript strict + Tailwind v4, `src/app` for routes,
  `src/components` for the two-wallet system and transaction lifecycle UI, `src/lib` for the
  GenLayer client/contract/storage plumbing. Every ticket is listed on `/policies` ("The
  Ledger"), deep-linkable at `/policy/[policyId]`, and readable without connecting a wallet.
  Dark mode is the default, with a toggle to light mode.

## Two-wallet system and transaction lifecycle

A locally generated, non-custodial browser wallet persisted in `localStorage` with export/import,
or an injected `window.ethereum` wallet via `client.connect('studionet')`. Both read and write
through the same `genlayer-js@1.1.8` client. Every write is tracked with its real consensus stage
(PROPOSING/COMMITTING/REVEALING/ACCEPTED/FINALIZED), and UNDETERMINED/VALIDATORS_TIMEOUT/
LEADER_TIMEOUT are surfaced as retryable states rather than hard errors
(`src/components/transaction-provider.tsx`).

## Deployed contract (StudioNet)

- **Address**: `0x385049Cf21660863c06a18f5eaA77e6a8A3dA352`
- **Explorer**: https://genlayer-explorer.vercel.app/address/0x385049Cf21660863c06a18f5eaA77e6a8A3dA352
- **Deploy tx**: `0x436c33edc9f9669da4ae7116b5d3193637fb4a81d0cf8146bdc343a6570c92aa`

This is the redeployment carrying the solvency-gate fix and the real-meteorological-API evidence
layer; every executable line in `contracts/Rainline.py` changed, so previous addresses were
retired. `.env.local`, `scripts/verify-schema.mjs`'s target, and this document all point at the
address above. Schema check: `node scripts/verify-schema.mjs` → `Schema verified for
0x385049Cf21660863c06a18f5eaA77e6a8A3dA352.`

### Real on-chain proof (not simulated)

The `genlayer` CLI's `write` command hardcodes `value: 0n`, so it cannot exercise `buy_policy` (a
`@gl.public.write.payable` method). `scripts/onchain-verify.mjs` uses `genlayer-js` directly —
`createClient`, `createAccount`, `writeContract` with a real non-zero `value: bigint`,
`waitForTransactionReceipt` — to call `buy_policy` and `check_claim` with actual GEN on StudioNet.

**All three write methods have been exercised on-chain.** The claim run below insures a real,
independently verifiable historical event: Hurricane Harvey over Houston, 26–29 Aug 2017.

| Step | Tx | Result |
|---|---|---|
| `buy_policy` (payable, **100 GEN** premium, 20 GEN payout) | `0x3033bc9f2b92f495b38e211777b434a6a881285a26ebf3d1b19d4703ed03d89b` | `FINALIZED` — created `RLN-1`; `pool_balance` 100 GEN, `outstanding_liability` 20 GEN |
| `check_claim` (consensus round, 3 real fetches + 1 reconciliation) | `0xe63f20f2a4d47d63f11076e3868b91ee9c5309f5ea275bc51283dc6aa530f4bb` | `FINALIZED` — verdict **`SEVERE`**, policy **`PAID_OUT`** |
| `expire_unclaimed` (permissionless sweep of `RLN-2`) | ACCEPTED, 5/5 validators AGREE | `EXPIRED_NO_CLAIM`, liability released 5 GEN → 0 |

**The payout actually moved value.** `get_summary()` before the claim: `pool_balance =
100000000000000000000`, `outstanding_liability = 20000000000000000000`. After: `pool_balance =
80000000000000000000`, `outstanding_liability = 0`. Twenty GEN left the Cistern and the contingent
liability was released, on-chain, driven purely by a consensus verdict.

The evidence the validators actually stored on the policy (verbatim, truncated):

> **`station_summary`** — "SOURCE A (Open-Meteo ERA5) daily precipitation_sum at the insured
> coordinates was 85.10 mm on 2017-08-26, 143.00 mm on 2017-08-27, 63.00 mm on 2017-08-28, and
> 203.90 mm on 2017-08-29."
>
> **`satellite_summary`** — "SOURCE B (NASA POWER) PRECTOTCORR was 164.31 mm/day on 2017-08-26,
> 237.3 mm/day on 2017-08-27, 131.02 mm/day on 2017-08-28, and 32.22 mm/day on 2017-08-29."
>
> **`report_summary`** — "SOURCE C includes a dated, location-relevant result for Hurricane Harvey
> stating catastrophic rainfall-triggered flooding in Greater Houston and Southeast Texas in 2017,
> which corroborates extreme rainfall at or near the insured location during the coverage period."

Those figures are independently reproducible — `curl` the two API URLs for the same coordinates and
dates and you get the same numbers. This is the strongest evidence in the project that the contract
is fetching real data rather than hallucinating it: the stored summaries match live API responses
to the decimal.

**A negative result, kept in.** The first deployment of this evidence layer
(`0x148dCD4dfa124b10cb975c26aCE102F603fe5173`, buy tx
`0xd6146782654b76f48dc5b2f088a0a0cd5d4d3e28b892ed225b9660acd39f7926`) used DuckDuckGo for leg C and
returned `"No local reports found (SOURCE C unavailable)"` — the search engine served the validator
a bot-detection page. It still reached `SEVERE`, because legs A and B agreed strongly enough that
the tie-breaker was not needed, which is the fallback behaving correctly. That failure is what
motivated the switch to Wikipedia's API; it is documented here rather than quietly redeployed away.

An earlier pre-fix contract (`0xabDEAe70481F171375c0e23Fd72d9CCc77afDDee`) and a failed deploy
attempt before it are superseded; see git history for the address progression.

## Tests

### Direct tests (`tests/direct/`, glsim + pytest, no network)

```
python -m pytest tests/direct/ -v
```

Result: **43 passed**. Coverage added for the solvency gate: payout accepted at exactly 10x premium
and rejected one wei over, payout accepted at exactly the 20% pool-fraction cap and rejected one
wei over, an adversarial multi-policy attack that stays inside the per-policy 20% cap on every
purchase but is caught by the aggregate liability invariant, and liability release on both
`DECLINED` and `EXPIRED_NO_CLAIM` transitions freeing capacity for later purchases.

Two tests cover the two-numeric-source design specifically, with web mocks shaped like the real
API responses:

- `test_check_claim_abstains_when_numeric_sources_conflict_without_corroboration` — ERA5 reports
  105.0 mm, NASA POWER reports 21.9 mm (the real Valencia numbers), leg C is empty. The contract
  must abstain rather than pick a side or average, and must leave the ticket claimable.
- `test_check_claim_pays_out_when_both_numeric_sources_agree_severe` — both numeric legs far
  exceed the threshold and leg C corroborates, so the payout must fire.

Existing coverage (input validation, the coverage-window gate on both sides of the boundary, all
five severity bands, the `INSUFFICIENT_EVIDENCE` abstention path and its cooldown, permissionless
triggering, unrecognized-verdict clamping, `expire_unclaimed` and its grace period, shared-pool
payout, and the prompt-injection-attempt case) is unchanged.

One of these tests caught a real bug in its own first draft: the payout test was written with a
20 GEN payout against a 10 GEN premium and was correctly rejected on the spot by the concentration
cap, which is the solvency gate doing exactly its job.

### Integration tests (`tests/integration/`, gltest against StudioNet)

```
python -m pytest tests/integration/ -v -s --network studionet
```

These were written but never run before this pass. Running them surfaced real API drift against
the installed `genlayer-test==0.29.2`: contract methods return a `ContractFunction` object that
needs an explicit `.call()` (reads) or `.transact(value=...)` (writes), not a bare call with
`value=`/`account=` kwargs, and a reverted write does not raise a Python exception — it returns a
receipt whose `consensus_data.leader_receipt[0].execution_result` is `"ERROR"`, checked via
`gltest.assertions.tx_execution_succeeded`/`tx_execution_failed`. The test file was fixed to match
the real API and to respect the new solvency-gate premium/payout amounts, plus one new test
(`test_buy_policy_rejects_payout_exceeding_solvency_gate`) exercising the on-chain revert.

Result: **6 passed in 246.04s (0:04:06)** against the current contract — deploy, a real payable
`buy_policy`, a rejected zero-value call, a rejected over-cap `buy_policy`, a rejected pre-window
`check_claim`, and a live `check_claim` consensus round that resolved to a valid severity band.
Dominated by the one live consensus round
(`test_check_claim_runs_live_consensus_after_coverage_ends`).

### Static checks

```
PYTHONIOENCODING=utf-8 genvm-lint check contracts/Rainline.py --json
```

Result: `{"ok":true,"lint":{"ok":true,"passed":3},"validate":{"ok":true,"contract":"Rainline",
"methods":7,"view_methods":4,"write_methods":3,"ctor_params":0}}` — clean, with one informational
warning (`I200`) that a newer py-genlayer runner is available.

Note for anyone reproducing this: `genvm-linter` installs a `genvm-lint.exe` shim into Python's
`Scripts/` directory, which is not necessarily on `PATH`. An earlier pass through this project
concluded the tool was unavailable and fell back to `ast.parse` — that conclusion was wrong; it
was a `PATH` problem, not a missing package. Invoke it by absolute path if `genvm-lint` is not
resolvable in your shell.

```
npm run build   # next build -- compiles and type-checks clean
npm run lint    # eslint -- clean (fixed two unescaped-apostrophe JSX warnings and one
                # set-state-in-effect warning in ThemeToggle, surfaced while verifying this pass)
```

## Local development

```
npm install
npm run dev
```

`.env.local` (gitignored, but expected to exist locally) sets `NEXT_PUBLIC_GENLAYER_CHAIN=studionet`
and `NEXT_PUBLIC_RAINLINE_CONTRACT` to the deployed address above. Visiting the app with no wallet
connected still lets you browse every ticket read-only; connecting (browser-generated or
injected) is only required to open a ticket or trigger a claim check yourself.

## Frontend verification performed

Run against a local `npm run dev` instance pointed at the redeployed contract:

- **Generated (non-custodial, localStorage) wallet path**: connected via "Use browser wallet",
  address displayed in the header, "Your Tickets" correctly shows the empty state (`No tickets
  under this address yet`) since that generated address has not bought a policy, and "Wallet
  Activity" correctly shows its own empty state.
- **The Ledger** (`/policies`): lists the real on-chain policies read live from the contract, not
  a cached copy.
- **Deep link** (`/policy/RLN-1`): shows the real holder address, coverage window, the `SEVERE`
  verdict, all three evidence summaries with the real ERA5 / NASA POWER figures, and the stored
  rationale. Timestamps, staked/payout amounts, and copy voice ("The Ledger" / "Open a Ticket" /
  "Your Tickets") are consistent with the redesign.
- No console errors were observed on any of the pages above.
- **Injected `window.ethereum` wallet path**: not verified in this session — the automated
  browser environment available here has no real wallet extension installed, so this path could
  only be inspected by reading its code (`src/components/wallet-provider.tsx`,
  `client.connect('studionet')`), not walked end-to-end with a live extension. This is the one
  wallet path that still needs a human with a real browser extension (MetaMask or similar
  configured for StudioNet) to confirm.
- A full buy-a-ticket-through-the-UI-with-a-real-wallet-popup walk (as opposed to the scripted
  `onchain-verify.mjs` path, which exercises the same contract calls but not the UI's own
  transaction-submission code) was not performed, for the same reason.

## Honest limitations

- **Solvency gate is a simplification, not actuarial pricing.** See "The solvency gate" above.
  The 10x and 20% constants are fixed and auditable, not fitted to any loss model. A production
  insurer would price on peril, location, seasonality and historical loss data.
- **Retroactive cover is not blocked.** `buy_policy` validates that `coverage_end > coverage_start`
  but does not require `coverage_start` to be in the future, so a policy can be opened over a
  window that has already elapsed. This is what made the Hurricane Harvey proof above possible,
  and it is also a genuine adverse-selection hole: someone can insure a storm they already know
  happened. A production version needs a `coverage_start > now` guard. It is called out here
  rather than left for a reviewer to find.
- **Grid resolution is a real limit on the evidence, even with real APIs.** ERA5 (~9–31km) and
  NASA POWER (~50km) are both gridded products. Neither is a gauge sitting in the insured field,
  so a sharply localised event can still be smoothed away by both. The three-source design
  narrows basis risk; it does not eliminate it.
- **`INSUFFICIENT_EVIDENCE` remains the expected outcome for genuinely ambiguous cases**, by
  design. The abstention path is not a failure mode, and the contract will not be pushed into
  guessing when the two numeric sources disagree without corroboration.
- **StudioNet balances are simulated.** There is no EVM settlement layer, so while the payout above
  demonstrably moved `pool_balance` from 100 GEN to 80 GEN and released the contingent liability
  in contract state, that is not the same assurance as value settling on a production chain.
- **The injected-wallet path was not walked end-to-end with a real browser extension.** See
  "Frontend verification performed" above. This is the one path still needing a human with a real
  extension configured for StudioNet.
- **No Vercel deployment and no demo video** — explicitly out of scope for this pass per the
  project owner's instructions.
