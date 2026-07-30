"""StudioNet integration tests for Rainline.

Run with:
    python -m pytest tests/integration/ -v -s --network studionet

These exercise the real deployed-contract lifecycle: deploy, buy a policy
with real value, and check status through the public RPC. The claim
evaluation path (`check_claim`) genuinely triggers a live consensus round
with real web fetches and a real LLM call on StudioNet, so those tests are
slower and are written to tolerate the documented retryable statuses
(UNDETERMINED / VALIDATORS_TIMEOUT / LEADER_TIMEOUT) by retrying rather than
failing outright.

Note on the installed gltest API (genlayer-test 0.29.2): contract methods
return a `ContractFunction` object, not a result directly. Reads are
performed with `.call()`; writes are performed with `.transact(value=...)`,
which returns the transaction receipt. To send from a specific account,
`.connect(account)` returns a new Contract bound to that signer.
"""

import time

from gltest import get_contract_factory, get_accounts
from gltest.assertions import tx_execution_succeeded, tx_execution_failed

GEN = 10**18

COVERAGE_START = "2026-01-01T00:00:00Z"
COVERAGE_END = "2026-01-01T00:00:05Z"  # short window so the integration run doesn't need to wait long


def _deploy():
    factory = get_contract_factory("Rainline")
    return factory.deploy(args=[])


def test_deploy_succeeds():
    contract = _deploy()
    summary = contract.get_summary(args=[]).call()
    assert summary["policy_count"] == 0
    assert summary["pool_balance"] == "0"
    assert summary["outstanding_liability"] == "0"


def test_buy_policy_on_chain():
    contract = _deploy()
    accounts = get_accounts()
    holder = accounts[0]
    as_holder = contract.connect(holder)

    receipt = as_holder.buy_policy(
        args=[
            "RAIN",
            "Test Valley Farm",
            "-1.29",
            "36.82",
            "More than 80mm of rain in a 24h window during coverage counts as a qualifying loss.",
            COVERAGE_START,
            COVERAGE_END,
            2 * GEN,
        ],
    ).transact(value=10 * GEN)
    assert tx_execution_succeeded(receipt), receipt.get("consensus_data")

    summary = contract.get_summary(args=[]).call()
    assert summary["policy_count"] == 1
    assert summary["pool_balance"] == str(10 * GEN)
    assert summary["outstanding_liability"] == str(2 * GEN)

    policies = contract.list_policies(args=[0, 10]).call()
    assert policies[0]["status"] == "ACTIVE"
    assert policies[0]["peril"] == "RAIN"


def test_buy_policy_rejects_zero_value():
    contract = _deploy()
    accounts = get_accounts()
    holder = accounts[0]
    as_holder = contract.connect(holder)

    receipt = as_holder.buy_policy(
        args=[
            "RAIN",
            "Test Valley Farm",
            "-1.29",
            "36.82",
            "More than 80mm of rain in a 24h window counts as a qualifying loss.",
            COVERAGE_START,
            COVERAGE_END,
            5 * GEN,
        ],
    ).transact(value=0)
    assert tx_execution_failed(receipt)


def test_buy_policy_rejects_payout_exceeding_solvency_gate():
    """Deterministic solvency gate: a payout requesting more than the pool can safely back
    (10x the premium, or 20% of the resulting pool balance) must revert on-chain, not just in
    the direct/mocked test suite."""
    contract = _deploy()
    accounts = get_accounts()
    holder = accounts[0]
    as_holder = contract.connect(holder)

    receipt = as_holder.buy_policy(
        args=[
            "RAIN",
            "Test Valley Farm",
            "-1.29",
            "36.82",
            "More than 80mm of rain in a 24h window counts as a qualifying loss.",
            COVERAGE_START,
            COVERAGE_END,
            50 * GEN,  # 5x the 10 GEN premium's concentration cap of 2 GEN
        ],
    ).transact(value=10 * GEN)
    assert tx_execution_failed(receipt)


def test_check_claim_before_coverage_ends_reverts():
    contract = _deploy()
    accounts = get_accounts()
    holder = accounts[0]
    as_holder = contract.connect(holder)

    as_holder.buy_policy(
        args=[
            "RAIN",
            "Test Valley Farm",
            "-1.29",
            "36.82",
            "More than 80mm of rain in a 24h window counts as a qualifying loss.",
            "2099-01-01T00:00:00Z",
            "2099-01-01T00:00:05Z",
            2 * GEN,
        ],
    ).transact(value=10 * GEN)
    policy_id = contract.list_policies(args=[0, 10]).call()[0]["id"]

    receipt = as_holder.check_claim(args=[policy_id]).transact()
    assert tx_execution_failed(receipt)


def _retryable(fn, attempts=3, delay_seconds=8):
    """Retry a live-consensus call across the retryable transaction statuses
    the GenLayer node can legitimately return (UNDETERMINED,
    VALIDATORS_TIMEOUT, LEADER_TIMEOUT) rather than treating them as
    hard failures."""
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


def test_check_claim_runs_live_consensus_after_coverage_ends():
    contract = _deploy()
    accounts = get_accounts()
    holder = accounts[0]
    as_holder = contract.connect(holder)

    as_holder.buy_policy(
        args=[
            "RAIN",
            "Nairobi test plot",
            "-1.29",
            "36.82",
            "More than 80mm of rain in a 24h window counts as a qualifying loss.",
            COVERAGE_START,
            COVERAGE_END,
            2 * GEN,
        ],
    ).transact(value=10 * GEN)
    policy_id = contract.list_policies(args=[0, 10]).call()[0]["id"]

    time.sleep(10)  # let the short coverage window fully elapse on-chain

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
