"""Tests for Kelly position sizer."""
import pytest

from backend.algo.paper_trader.position_sizer import recommend_quantity


def test_cold_start_returns_one_percent():
    result = recommend_quantity(
        signal_confidence=0.8,
        current_capital=100_000,
        entry_price=500,
        stop_loss_price=490,
        cold_start=True,
    )
    assert result["fraction"] == pytest.approx(0.01, abs=1e-6)


def test_known_win_rate_rr():
    # Kelly: p=0.6, b=2.0, q=0.4
    # f* = (0.6*2 - 0.4) / 2 = 0.4, * confidence(0.8) = 0.32
    # capped at max_kelly_fraction=0.20
    result = recommend_quantity(
        signal_confidence=0.8,
        current_capital=100_000,
        entry_price=500,
        stop_loss_price=490,
        rolling_win_rate=0.6,
        rolling_avg_rr=2.0,
        cold_start=False,
        max_kelly_fraction=0.20,
    )
    assert result["fraction"] <= 0.20
    assert result["fraction"] >= 0.0025


def test_negative_kelly_uses_minimum():
    # Kelly: p=0.3, b=1.0, q=0.7 => f* = (0.3 - 0.7) / 1 = -0.4 → clamped to 0 → min 0.0025
    result = recommend_quantity(
        signal_confidence=0.6,
        current_capital=100_000,
        entry_price=500,
        stop_loss_price=490,
        rolling_win_rate=0.3,
        rolling_avg_rr=1.0,
        cold_start=False,
    )
    assert result["fraction"] >= 0.0025


def test_quantity_computed():
    result = recommend_quantity(
        signal_confidence=0.7,
        current_capital=100_000,
        entry_price=500,
        stop_loss_price=490,
        cold_start=True,
    )
    # fraction=0.01 → risk=1000 / stop_distance=10 → qty=100
    assert result["quantity"] == pytest.approx(100.0, abs=0.1)


def test_risk_amount_scales_with_capital():
    r1 = recommend_quantity(0.7, 100_000, 500, 490, cold_start=True)
    r2 = recommend_quantity(0.7, 200_000, 500, 490, cold_start=True)
    assert r2["risk_amount_inr"] == pytest.approx(r1["risk_amount_inr"] * 2, rel=0.01)
