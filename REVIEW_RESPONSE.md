# Rainline Review Response

This document records the changes made in response to the more-information request from Pavel
Kolosov on August 10, 2026.

## Requested changes

> Please replace or fix the requester-filtered quote lookup in the production quote-to-buy flow
> using the repository-tested summary and quote reads, then add an integration test that proves a
> finalized quote is found and purchased. Also normalize provider units and make payout
> eligibility follow the stored numeric trigger exactly before consensus resolves source
> disagreement.

## 1. Production quote discovery fixed

The production frontend no longer relies on `list_quotes_by_requester` after `request_quote`
finalizes. That filtered view had returned an empty list for a successfully finalized StudioNet
request because of address-encoding behavior.

The corrected flow in [`src/lib/genlayer/contract.ts`](./src/lib/genlayer/contract.ts) and
[`src/components/write-actions.tsx`](./src/components/write-actions.tsx):

1. Reads `get_summary().quote_count` before submitting the quote request.
2. Waits for the request transaction to reach `FINALIZED` and verifies contract execution
   succeeded.
3. Reads each newly allocated `RLQ-{sequence}` directly through `get_quote`.
4. Matches the requester and every submitted term: peril, location, coordinates, threshold,
   aggregation window, coverage dates, and requested payout.
5. Presents only the matching finalized quote for purchase.

Scanning all IDs created after the pre-write snapshot prevents a concurrent user's quote from
being mistaken for the request made in this browser.

## 2. Finalized quote-to-purchase integration proof

[`tests/integration/test_rainline_integration.py`](./tests/integration/test_rainline_integration.py)
contains `test_finalized_quote_is_found_by_production_reads_and_purchased`.

The test deploys and funds a fresh StudioNet contract, requests a real consensus-priced quote,
discovers it through the same `get_summary` plus `get_quote` strategy used in production, pays
the exact required premium, and verifies:

- the purchase transaction executed successfully;
- `quote.consumed` changed to `true`;
- one active policy was created;
- the quote ID, peril, premium, payout amount, and policy status are correct;
- pool balance and outstanding liability changed by the exact expected amounts.

The test does not treat `UNPRICEABLE` as success, so it cannot pass without purchasing a policy.

Command:

```bash
gltest tests/integration/test_rainline_integration.py::test_finalized_quote_is_found_by_production_reads_and_purchased -v -s --network studionet
```

Result: **1 passed in 170.81 seconds**. The live quote was `LOW` risk and required an exact
premium of `133333333333333334` wei for 2 GEN of cover.

## 3. Provider measurements normalized

The claim consensus path in [`contracts/Rainline.py`](./contracts/Rainline.py) now defines one
canonical unit and aggregation rule for every supported peril:

| Peril | Canonical measurement | Normalization |
|---|---|---|
| Rain | millimetres | Open-Meteo `precipitation_sum` and NASA `PRECTOTCORR` remain mm/day |
| Heat | degrees Celsius | Open-Meteo `temperature_2m_max` and NASA `T2M_MAX` remain degrees C |
| Wind | kilometres per hour | Open-Meteo is explicitly requested in km/h; NASA `WS10M_MAX` is converted from m/s by multiplying by 3.6 |

NASA `-999`, `-999.0`, and provider-declared fill values are treated as missing observations,
never as zero. `SINGLE_DAY_MAX` selects the maximum usable daily value. `CUMULATIVE` sums usable
daily values and is accepted only for rainfall; cumulative heat or wind is rejected on-chain.

Air quality was removed rather than falsely normalized. NASA `AOD_55` is aerosol optical depth,
not AQI, and therefore cannot honestly serve as an independent AQI measurement.

## 4. Stored numeric trigger now controls payment

Consensus no longer authorizes payment by returning `MODERATE` or `SEVERE`. Validators instead
normalize and reconcile the independent sources into:

- `resolution_status`: `RESOLVED` or `INSUFFICIENT_EVIDENCE`;
- `resolved_value_milli`: the canonical measurement multiplied by 1000;
- source summaries and a rationale explaining any disagreement resolution.

After consensus, deterministic contract code converts the policy's stored `threshold_value` to
the same milli-unit scale and evaluates:

```text
trigger_met = resolved_value_milli >= stored_threshold_milli
```

Only `trigger_met` controls payout. Severity is derived afterward for display and cannot override
the arithmetic. `INSUFFICIENT_EVIDENCE` remains a retryable abstention.

The direct suite includes adversarial tests proving that:

- a response containing the word `SEVERE` cannot pay when the resolved value is below the stored
  threshold;
- a response containing `NONE` cannot block payment when the resolved value equals the stored
  threshold;
- non-rain cumulative policies are rejected;
- canonical measurement, unit, resolution status, and trigger result are stored on the policy.

## Verification

| Check | Result |
|---|---|
| GenVM lint and contract validation | Passed; 11 methods, 6 views, 5 writes |
| Direct contract suite | **67 passed** |
| Reviewer-specific StudioNet integration | **Passed** |
| ESLint | Passed |
| Next.js production build and TypeScript | Passed |
| Fresh deployed schema | Passed |
| Public production smoke test | New policy visible; no browser console errors |

## Current deployment evidence

- Live app: [https://rainline.vercel.app](https://rainline.vercel.app)
- Source: [https://github.com/ometere123/rainline](https://github.com/ometere123/rainline)
- Contract: [`0x12eDBfD43d0cc1Be9DC090Bbe35bA66578b9A2ED`](https://explorer-studio.genlayer.com/address/0x12eDBfD43d0cc1Be9DC090Bbe35bA66578b9A2ED)
- Corrected deployment: [`0x5a5c...be72`](https://explorer-studio.genlayer.com/tx/0x5a5c689d6e521efd1fb4e32573a14b2e4bf22a475bf4dcc71a22156cd9a4be72)
- Seed 1000 GEN pool: [`0xe0be...f642`](https://explorer-studio.genlayer.com/tx/0xe0bebc04c18834c042a9435b354f2cac4a2a61d43e3a9231fcc70eae3911f642)
- Finalized `LOW` quote (`RLQ-1`): [`0x5ceb...cbc6`](https://explorer-studio.genlayer.com/tx/0x5ceb712f08bf085e5118c8d5832ae855c2b230ad4b9bff6b59ef1825d78ccbc6)
- Exact-premium purchase (`RLN-1`): [`0x8733...2f68`](https://explorer-studio.genlayer.com/tx/0x87337a4be2fe6b52d96be381e3e188f776c90847545a7655a967a85273502f68)

Direct reads after purchase showed one consumed quote, one active policy, a pool balance of
`1000.133333333333333334 GEN`, and outstanding liability of `2 GEN`. The policy copied the exact
80 mm trigger and 2 GEN payout from its finalized quote.
