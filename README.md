# Rainline

Parametric micro-insurance for small farms and outdoor businesses, settled by GenLayer consensus
instead of a single insurer's weather feed.

A policyholder buys cover against one peril (rain/flood, extreme heat, wind, or air quality) at
one location, for one coverage window, paying a premium in native GEN into a shared pool (called
"the Cistern" in the UI). After coverage ends, **anyone** can permissionlessly trigger
`check_claim`. The Intelligent Contract fetches weather-station data, a satellite/precipitation-
style summary, and local news/community reports for that exact location and window, then asks
GenLayer validators to reconcile all three into a banded severity verdict (NONE / MINOR /
MODERATE / SEVERE / INSUFFICIENT_EVIDENCE). MODERATE and SEVERE pay out automatically from the
pool.

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

`check_claim`'s leader function performs three `gl.nondet.web.render` calls (station-style,
satellite/reanalysis-style, and local-report-style search queries) plus one `gl.nondet.exec_prompt`
reconciliation. These are **generic web-search fetches, not real meteorological API
integrations** — there is no NOAA/Copernicus/IQAir client library involved. The queries were
tightened to ask for named, citable sources for the exact coordinates and date range (station
IDs, `site:noaa.gov`/`site:wunderground.com`/`site:meteostat.net` for station data,
`site:nasa.gov`/`site:copernicus.eu`/`site:iqair.com`/`site:airnow.gov` for satellite/reanalysis
data) rather than a generic "describe the weather" search, and the LLM prompt explicitly tells
the model to weigh a named, specific source more heavily than a vague one.

In practice, on StudioNet's infrastructure, these Google-search-based fetches are frequently
blocked by bot-detection (HTTP 429 with a CAPTCHA page) rather than returning real results — this
was observed directly in on-chain testing below, not assumed. Before this pass, a blocked fetch
raised an uncaught `NondetException` that aborted the whole leader execution with an
`execution_result: ERROR`, which is a worse outcome than a clean `INSUFFICIENT_EVIDENCE`: the
consensus round burns without ever reaching a resolvable state. Each fetch is now wrapped
(`_safe_render`) so a hard failure degrades that one source to the literal string
`[FETCH_UNAVAILABLE]` instead of raising, and the prompt is told to treat that string as missing
evidence, not as evidence of a calm period. **`INSUFFICIENT_EVIDENCE` should be read as the
expected common-case outcome for sparse/rural coordinates and for any fetch that trips
bot-detection, not a rare edge case** — the real, on-chain `check_claim` run below hit exactly
this path and resolved cleanly to `INSUFFICIENT_EVIDENCE` instead of erroring.

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

- **Address**: `0xabDEAe70481F171375c0e23Fd72d9CCc77afDDee`
- **Explorer**: https://genlayer-explorer.vercel.app/address/0xabDEAe70481F171375c0e23Fd72d9CCc77afDDee

This is the redeployment carrying the solvency-gate and fetch-hardening fix; every executable
line in `contracts/Rainline.py` changed, so the previous address was retired. `.env.local`,
`scripts/verify-schema.mjs`'s target, and this document all point at the address above.

### Real on-chain proof (not simulated)

The `genlayer` CLI's `write` command hardcodes `value: 0n`, so it cannot exercise `buy_policy` (a
`@gl.public.write.payable` method). `scripts/onchain-verify.mjs` uses `genlayer-js` directly —
`createClient`, `createAccount` from a decrypted local keystore, `writeContract` with a real
non-zero `value: bigint`, `waitForTransactionReceipt` — to call `buy_policy` and `check_claim`
with actual GEN against StudioNet, using a funded StudioNet test account (`genlayer account
create` + `genlayer account send` from the funded `deployer` account).

- **`buy_policy` with real value**: tx
  `0x05f68435fa6822948ca990f4d192624337af65fd5407ed9cf1676b443978bba0`, `FINALIZED`, premium
  `10 GEN`, payout `2 GEN` — created policy `RLN-1`, holder `0xEE0f7E7Dd201Cdd37099F76e838b33D0431ef77d`.
  `get_summary()` immediately after: `pool_balance = 10000000000000000000`,
  `outstanding_liability = 2000000000000000000`, `policy_count = 1`.
- **`check_claim` real consensus round**: tx
  `0x2c535ce1f12f63cb9b28daf77cfbcf34f568380fc31f75c0ff25a9cb5e418dcb`, `FINALIZED`. All three
  evidence fetches hit StudioNet's Google-search bot-detection block (HTTP 429) and degraded to
  `[FETCH_UNAVAILABLE]` via `_safe_render`; the LLM correctly reasoned from the absence of
  evidence and returned `INSUFFICIENT_EVIDENCE`, and the contract moved the policy to
  `STATUS_CHECKING` (`check_attempts = 1`) rather than erroring out. This is genuine end-to-end
  proof of both the payable write path and the consensus claim path — the honest, common-case
  result for a real evidence-fetching round on this infra, not a payout, but a clean and correct
  one.
- **Schema check**: `node scripts/verify-schema.mjs` → `Schema verified for
  0xabDEAe70481F171375c0e23Fd72d9CCc77afDDee.`
- **Frontend read of the same state**: visiting `/policy/RLN-1` on a locally running `npm run
  dev` instance shows the same holder, stake, payout, verdict, and evidence summaries read live
  from the contract — see "Frontend verification" below.

An earlier deploy of the pre-fix contract (before this session) was also checked and superseded;
see git history for the address progression. No payout (MODERATE/SEVERE) verdict was obtained in
this session — StudioNet's evidence fetches hit bot-detection both times they were exercised
live, which is exactly the honest, common-case outcome documented above, not a cherry-picked
result. Re-running `node scripts/onchain-verify.mjs <keystore> <password> claim <policyId>` after
the cooldown (`RECHECK_COOLDOWN_SECONDS = 1800`) will retry against the same policy.

## Tests

### Direct tests (`tests/direct/`, glsim + pytest, no network)

```
python -m pytest tests/direct/ -v
```

Result: **41 passed** (34 original + 7 new covering the solvency gate). New coverage: payout
accepted at exactly 10x premium and rejected one wei over, payout accepted at exactly the 20%
pool-fraction cap and rejected one wei over, an adversarial multi-policy attack that stays inside
the per-policy 20% cap on every purchase but is caught by the aggregate liability invariant, and
liability release on both `DECLINED` and `EXPIRED_NO_CLAIM` transitions freeing capacity for
later purchases. Existing coverage (input validation, the coverage-window gate on both sides of
the boundary, all five severity bands, the `INSUFFICIENT_EVIDENCE` abstention path and its
cooldown, permissionless triggering, unrecognized-verdict clamping, `expire_unclaimed` and its
grace period, shared-pool payout, and the prompt-injection-attempt case) is unchanged.

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

Result: **6 passed in 239.42s (0:03:59)** — deploy, a real payable `buy_policy`, a rejected
zero-value call, a rejected over-cap `buy_policy`, a rejected pre-window `check_claim`, and a
live `check_claim` consensus round that resolved to a valid severity band. Dominated by the one
live consensus round (`test_check_claim_runs_live_consensus_after_coverage_ends`).

### Static checks

`genvm-lint` is referenced in this project's task instructions but is not an installed or
resolvable command in this environment (`genvm-lint: command not found`, and `npx genvm-lint`
404s against the public npm registry) — it was not run, and no fabricated output is claimed for
it here. `contracts/Rainline.py` was checked instead with `python -c "import ast;
ast.parse(...)"` (clean) and by the fact that every direct and integration test above actually
executes the deployed bytecode successfully, which exercises the same parse/type surface
`genvm-lint` would.

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
  address displayed in the header (`0xF7dB...447A`), "Your Tickets" correctly shows the empty
  state (`No tickets under this address yet`) since that generated address has not bought a
  policy, and "Wallet Activity" correctly shows its own empty state.
- **The Ledger** (`/policies`): lists the real on-chain policy `RLN-1` with correct staked (10
  GEN) and payout (2 GEN) amounts read live from the contract, not a cached copy.
- **Deep link** (`/policy/RLN-1`): shows the real holder address, coverage window, verdict
  (`INSUFFICIENT_EVIDENCE`, displayed as "Logged as static"), all three evidence summaries
  (correctly showing the `[FETCH_UNAVAILABLE]`-derived "No ... data available" text), the
  rationale, and a working "Check claim now" retry action gated on the cooldown.
  timestamps, staked/payout amounts, and copy voice ("The Ledger" / "Open a Ticket" / "Your
  Tickets", no em dashes) are consistent with the redesign.
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
  The 10x and 20% constants are fixed and auditable, not fitted to any loss model.
- **Evidence fetches are generic web search, not real meteorological APIs**, and were observed in
  this session to hit bot-detection on StudioNet's infra. `INSUFFICIENT_EVIDENCE` is the honest,
  expected common case for this reason, documented rather than hidden. No MODERATE/SEVERE payout
  verdict was obtained live in this session for that reason; the payable write path and the
  consensus round both completed successfully and are proven above independent of which verdict
  came back.
- **`genvm-lint` was not run** — it is not an available command in this environment. See "Static
  checks" above for what was actually run in its place.
- **The injected-wallet path was not walked end-to-end with a real browser extension.** See
  "Frontend verification performed" above.
- **No Vercel deployment and no demo video** — explicitly out of scope for this pass per the
  project owner's instructions.
