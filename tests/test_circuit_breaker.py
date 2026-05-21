"""Tests for circuit breaker: triggers and daily reset."""
import json
import pytest
from pathlib import Path

from backend.algo.paper_trader.circuit_breaker import CircuitBreaker


@pytest.fixture
def tmp_cb(tmp_path):
    state_file = tmp_path / "cb_state.json"
    return CircuitBreaker(state_path=str(state_file))


def test_fresh_breaker_allows_trading(tmp_cb):
    allowed, reason = tmp_cb.check(100_000, 100_000, [])
    assert allowed
    assert reason == "ok"


def test_daily_drawdown_halts(tmp_cb):
    trades = [{"pnl": -3500}]  # 3.5% loss on 100k initial
    allowed, reason = tmp_cb.check(96_500, 100_000, trades)
    assert not allowed
    assert "daily drawdown" in reason.lower()


def test_weekly_drawdown_halts(tmp_cb):
    # Current capital is 92k, initial 100k → 8% drawdown
    allowed, reason = tmp_cb.check(92_000, 100_000, [])
    assert not allowed
    assert "weekly drawdown" in reason.lower()


def test_five_consecutive_losses_halts(tmp_cb):
    trades = [{"pnl": -100}] * 5
    allowed, reason = tmp_cb.check(99_500, 100_000, trades)
    assert not allowed
    assert "consecutive" in reason.lower()


def test_four_consecutive_losses_still_allowed(tmp_cb):
    trades = [{"pnl": -50}] * 4
    allowed, _ = tmp_cb.check(99_800, 100_000, trades)
    assert allowed


def test_daily_reset_clears_halt(tmp_cb):
    # First trigger a halt
    trades = [{"pnl": -3500}]
    tmp_cb.check(96_500, 100_000, trades)

    # Verify halted
    allowed, _ = tmp_cb.check(96_500, 100_000, [])
    assert not allowed

    # Reset
    tmp_cb.reset_daily()
    allowed, reason = tmp_cb.check(96_500, 100_000, [])
    assert allowed
    assert reason == "ok"


def test_state_persists_across_instances(tmp_path):
    state_file = str(tmp_path / "cb_state.json")
    cb1 = CircuitBreaker(state_path=state_file)

    # Trigger halt via consecutive losses
    trades = [{"pnl": -100}] * 5
    cb1.check(99_500, 100_000, trades)

    # New instance reads same file
    cb2 = CircuitBreaker(state_path=state_file)
    allowed, _ = cb2.check(99_500, 100_000, [])
    assert not allowed
