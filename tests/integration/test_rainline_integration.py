"""StudioNet integration tests for Rainline.

Run with:
    python -m pytest tests/integration/ -v -s --network studionet

These exercise the real deployed-contract lifecycle: deploy, fund the pool (a plain payable
deposit, no consensus involved), request a quote (a live consensus round pricing historical
likelihood), buy a policy from that quote for its exact required premium, and check status
through the public RPC. Both `request_quote` and `check_claim` genuinely trigger live consensus
rounds with real web fetches and a real LLM call on StudioNet, so those tests are slower and are
written to tolerate the documented retryable statuses (UNDETERMINED / VALIDATORS_TIMEOUT /
LEADER_TIMEOUT) by retrying rather than failing outright.

Why every test funds the pool first: required_premium is derived from requested_payout by the
risk band's fixed multiplier (LOW=15x, MODERATE=8x, HIGH=3x), so requested_payout is always
strictly greater than required_premium for any real policy. That makes the 20%-of-pool
concentration cap mathematically impossible to satisfy for the very first purchase against an
empty pool, on any real deployment, not just in these tests -- see `fund_pool`'s docstring in
the contract. `fund_pool` is the only way to bootstrap liquidity from nothing.

Note on the installed gltest API (genlayer-test 0.29.2): contract methods return a
`ContractFunction` object, not a result directly. Reads are performed with `.call()`; writes are
performed with `.transact(value=...)`, which returns the transaction receipt. To send from a
specific account, `.connect(account)` returns a new Contract bound to that signer.
"""

import time
from datetime import datetime, timedelta, timezone

from gltest import get_contract_factory, get_accounts
from gltest.assertions import tx_execution_succeeded, tx_execution_failed

GEN = 10**18


def _window(start_in: int = 900, length: int = 15):
    """A coverage window starting in the future, sized for the quote-then-buy flow.

    Both request_quote and buy_policy_from_quote refuse retroactive cover, so the window
    cannot be hardcoded to a past date. Unlike the old single-step buy_policy, every purchase
    now goes through request_quote first, which is a real, separate consensus round -- normally
    90-150s on StudioNet, but observed directly while proving this out to occasionally take
    much longer (one run took 467s, presumably including at least one retry round). A 240s
    lead time was still too tight and the retroactive-cover guard correctly (but unhelpfully,
    for the test) refused the purchase once. 900s gives comfortable headroom even for a slow
    or retried quote round plus the buy transaction itself.
    """
    now = datetime.now(timezone.utc)
    start = now + timedelta(seconds=start_in)
    end = start + timedelta(seconds=length)
    fmt = "%Y-%m-%dT%H:%M:%SZ"
    return start.strftime(fmt), end.strftime(fmt)


def _deploy():
    factory = get_contract_factory("Rainline")
    return factory.deploy(args=[])


def _fund(as_holder, amount_gen=1000):
    receipt = as_holder.fund_pool(args=[]).transact(value=amount_gen * GEN)
    assert tx_execution_succeeded(receipt), receipt.get("consensus_data")


def _retryable(fn, attempts=3, delay_seconds=8):
    """Retry a live-consensus call across the retryable transaction statuses the GenLayer
    node can legitimately return (UNDETERMINED, VALIDATORS_TIMEOUT, LEADER_TIMEOUT) rather
    than treating them as hard failures."""
    last_exc = None
    for _ in range(attempts):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 - deliberately broad for retry classification
            message = str(exc)
            if any(status in message for status in ("UNDETERMINED", "VALIDATORS_TIMEOUT", "LEADER_TIMEOUT")):
                last_exc = exc
                time.sleep(delay_seconds)
                continue
            raise
    raise last_exc


def _request_quote(
    as_holder, coverage_start, coverage_end,
    threshold_value=80 * GEN, window="SINGLE_DAY_MAX", requested_payout=2 * GEN,
):
    receipt = _retryable(lambda: as_holder.request_quote(
        args=[
            "RAIN",
            "Test Valley Farm",
            "-1.29",
            "36.82",
            threshold_value,
            window,
            coverage_start,
            coverage_end,
            requested_payout,
        ],
    ).transact(wait_interval=10000, wait_retries=90))
    assert tx_execution_succeeded(receipt), receipt.get("consensus_data")
    return receipt


def _latest_quote(contract, holder):
    """Read the just-created quote by its deterministic id (RLQ-{quote_count}) instead of
    trusting list_quotes_by_requester's holder-address filter, which was observed directly on
    real StudioNet traffic to come back empty for a request that had already finalized
    successfully -- most likely an address-encoding mismatch between the eth_account object
    gltest hands back from get_accounts() and the Address string the contract records as
    gl.message.sender_address, not a propagation delay (retrying that same filtered read for 30s
    still found nothing). quote_count from get_summary is authoritative regardless of that."""
    summary = contract.get_summary(args=[]).call()
    quote_id = f"RLQ-{summary['quote_count']}"
    return contract.get_quote(args=[quote_id]).call()


def test_deploy_succeeds():
    contract = _deploy()
    summary = contract.get_summary(args=[]).call()
    assert summary["policy_count"] == 0
    assert summary["quote_count"] == 0
    assert summary["pool_balance"] == "0"
    assert summary["outstanding_liability"] == "0"


def test_fund_pool_credits_balance_without_a_policy():
    contract = _deploy()
    accounts = get_accounts()
    as_holder = contract.connect(accounts[0])
    _fund(as_holder, 5)
    summary = contract.get_summary(args=[]).call()
    assert summary["pool_balance"] == str(5 * GEN)
    assert summary["policy_count"] == 0


def test_request_quote_and_buy_policy_on_chain():
    contract = _deploy()
    accounts = get_accounts()
    holder = accounts[0]
    as_holder = contract.connect(holder)
    _fund(as_holder)
    coverage_start, coverage_end = _window()

    _request_quote(as_holder, coverage_start, coverage_end, requested_payout=2 * GEN)

    quote = _latest_quote(contract, holder)
    assert quote["peril"] == "RAIN"
    assert quote["op"] == ">="
    assert quote["threshold_value"] == str(80 * GEN)
    assert quote["window"] == "SINGLE_DAY_MAX"
    assert quote["requested_payout"] == str(2 * GEN)
    assert quote["risk_band"] in ("LOW", "MODERATE", "HIGH", "UNPRICEABLE")
    assert quote["consumed"] is False
    print("Quote risk band:", quote["risk_band"])
    print("Quote rationale:", quote["rationale"])
    print("Quote climatology summary:", quote["climatology_summary"])
    print("Required premium:", quote["required_premium"])

    if quote["risk_band"] == "UNPRICEABLE":
        # Cannot buy from an UNPRICEABLE quote by design; verify the refusal on-chain and stop.
        receipt = as_holder.buy_policy_from_quote(args=[quote["id"]]).transact(value=1 * GEN)
        assert tx_execution_failed(receipt)
        return

    premium = int(quote["required_premium"])
    before = int(contract.get_summary(args=[]).call()["pool_balance"])
    receipt = as_holder.buy_policy_from_quote(args=[quote["id"]]).transact(value=premium)
    assert tx_execution_succeeded(receipt), receipt.get("consensus_data")

    summary = contract.get_summary(args=[]).call()
    assert summary["policy_count"] == 1
    assert summary["pool_balance"] == str(before + premium)
    assert summary["outstanding_liability"] == str(2 * GEN)

    policies = contract.list_policies(args=[0, 10]).call()
    assert policies[0]["status"] == "ACTIVE"
    assert policies[0]["peril"] == "RAIN"
    assert policies[0]["quote_id"] == quote["id"]
    assert policies[0]["premium"] == str(premium)
    assert policies[0]["payout_amount"] == str(2 * GEN)


def test_buy_from_quote_rejects_wrong_value():
    """The transaction value must equal the quote's required_premium exactly (see
    buy_policy_from_quote's docstring on why overpayment is rejected rather than refunded)."""
    contract = _deploy()
    accounts = get_accounts()
    holder = accounts[0]
    as_holder = contract.connect(holder)
    _fund(as_holder)
    coverage_start, coverage_end = _window()

    _request_quote(as_holder, coverage_start, coverage_end, requested_payout=2 * GEN)
    quote = _latest_quote(contract, holder)
    if quote["risk_band"] == "UNPRICEABLE":
        return  # nothing to buy; covered by the UNPRICEABLE-refusal test elsewhere

    receipt = as_holder.buy_policy_from_quote(args=[quote["id"]]).transact(value=0)
    assert tx_execution_failed(receipt)


def test_buy_from_quote_rejects_payout_exceeding_solvency_gate():
    """Deterministic solvency gate: a payout requesting more than the pool can safely back
    must revert on-chain, not just in the direct/mocked test suite. A requested_payout large
    enough to exceed even the most generous (LOW-band, 15x) multiplier against the funded pool
    is guaranteed to trip gate 2 (the 20%-of-pool concentration cap)."""
    contract = _deploy()
    accounts = get_accounts()
    holder = accounts[0]
    as_holder = contract.connect(holder)
    _fund(as_holder, 10)  # a small pool: 10 GEN
    coverage_start, coverage_end = _window()

    _request_quote(as_holder, coverage_start, coverage_end, requested_payout=10000 * GEN)
    quote = _latest_quote(contract, holder)
    if quote["risk_band"] == "UNPRICEABLE":
        return

    premium = int(quote["required_premium"])
    receipt = as_holder.buy_policy_from_quote(args=[quote["id"]]).transact(value=premium)
    assert tx_execution_failed(receipt)


def test_buy_from_quote_rejects_unknown_quote():
    contract = _deploy()
    accounts = get_accounts()
    holder = accounts[0]
    as_holder = contract.connect(holder)

    receipt = as_holder.buy_policy_from_quote(args=["RLQ-999"]).transact(value=1 * GEN)
    assert tx_execution_failed(receipt)


def test_check_claim_before_coverage_ends_reverts():
    contract = _deploy()
    accounts = get_accounts()
    holder = accounts[0]
    as_holder = contract.connect(holder)
    _fund(as_holder)

    _request_quote(
        as_holder, "2099-01-01T00:00:00Z", "2099-01-01T00:00:05Z", requested_payout=2 * GEN,
    )
    quote = _latest_quote(contract, holder)
    if quote["risk_band"] != "UNPRICEABLE":
        premium = int(quote["required_premium"])
        as_holder.buy_policy_from_quote(args=[quote["id"]]).transact(value=premium)
        policy_id = contract.list_policies(args=[0, 10]).call()[0]["id"]
        receipt = as_holder.check_claim(args=[policy_id]).transact()
        assert tx_execution_failed(receipt)


def test_check_claim_runs_live_consensus_after_coverage_ends():
    contract = _deploy()
    accounts = get_accounts()
    holder = accounts[0]
    as_holder = contract.connect(holder)
    _fund(as_holder)
    # _window()'s default lead time already accounts for request_quote's live consensus round
    # elapsing before this test can even attempt to buy.
    coverage_start, coverage_end = _window()

    _request_quote(as_holder, coverage_start, coverage_end, requested_payout=2 * GEN)
    quote = _latest_quote(contract, holder)
    print("Quote risk band:", quote["risk_band"])

    if quote["risk_band"] == "UNPRICEABLE":
        # Rare on real climatology, but honest: nothing to buy or claim in that case. The
        # UNPRICEABLE-refusal behavior itself is covered by the direct test suite.
        return

    premium = int(quote["required_premium"])
    as_holder.buy_policy_from_quote(args=[quote["id"]]).transact(value=premium)
    policy_id = contract.list_policies(args=[0, 10]).call()[0]["id"]

    # Sleep until coverage_end has genuinely passed on-chain, computed from the real clock
    # rather than a fixed guess, since the quote round already consumed an unpredictable amount
    # of the lead time _window() built in.
    end_dt = datetime.strptime(coverage_end, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    remaining = (end_dt - datetime.now(timezone.utc)).total_seconds()
    if remaining > 0:
        time.sleep(remaining + 5)

    _retryable(lambda: as_holder.check_claim(args=[policy_id]).transact(
        wait_interval=10000, wait_retries=90,
    ))

    policy = contract.get_policy(args=[policy_id]).call()
    assert policy["status"] in ("PAID_OUT", "DECLINED", "CHECKING")
    assert policy["verdict"] in (
        "NONE",
        "MINOR",
        "MODERATE",
        "SEVERE",
        "INSUFFICIENT_EVIDENCE",
    )
