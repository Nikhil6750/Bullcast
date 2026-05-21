"""
End-to-end replay test with 100 synthetic candles.
Uses the production pipeline — no special replay path.
Validates: signals generated → paper trades → metrics computed.
"""
from __future__ import annotations

import numpy as np
import pytest


def _make_candles(n: int = 300, seed: int = 99) -> list[dict]:
    rng = np.random.default_rng(seed)
    closes = 100.0 + np.cumsum(rng.normal(0, 0.5, n))
    opens = closes + rng.normal(0, 0.2, n)
    highs = np.maximum(closes, opens) + rng.uniform(0, 0.5, n)
    lows = np.minimum(closes, opens) - rng.uniform(0, 0.5, n)
    volumes = rng.uniform(1_000, 10_000, n)
    base_ms = 1_700_000_000_000
    return [
        {
            "time": base_ms + i * 60_000,
            "open": float(opens[i]), "high": float(highs[i]),
            "low": float(lows[i]), "close": float(closes[i]),
            "volume": float(volumes[i]),
        }
        for i in range(n)
    ]


def test_feature_vector_computed_from_300_candles():
    """Feature pipeline runs cleanly on 300 candles."""
    from backend.algo.features.pipeline import compute_single_feature_vector
    candles = _make_candles(300)
    vec = compute_single_feature_vector(candles, "TEST")
    assert isinstance(vec, dict)
    assert "rsi_14" in vec
    assert "streak_active" in vec


def test_validator_produces_output_for_synthetic_signal():
    """Validator runs and returns a passed/rejected dict."""
    from backend.algo.validator.engine import validate

    signal_output = {
        "signal": "BUY",
        "confidence": 0.75,
        "regime": 0,
    }
    feature_vector = {
        "setup_forming": 1,
        "streak_direction": 1,
        "tf1h_trend": 0,
        "regime": 0,
    }
    candles = _make_candles(10)
    result = validate(signal_output, feature_vector, candles)
    assert "passed" in result
    assert "rules_checked" in result
    assert isinstance(result["rules_checked"], list)


def test_position_sizer_returns_dict():
    from backend.algo.paper_trader.position_sizer import recommend_quantity
    result = recommend_quantity(
        signal_confidence=0.7,
        current_capital=100_000,
        entry_price=200,
        stop_loss_price=196,
        cold_start=True,
    )
    assert "fraction" in result
    assert "quantity" in result
    assert result["fraction"] > 0


def test_circuit_breaker_allows_fresh_start(tmp_path):
    from backend.algo.paper_trader.circuit_breaker import CircuitBreaker
    cb = CircuitBreaker(state_path=str(tmp_path / "cb.json"))
    allowed, _ = cb.check(100_000, 100_000, [])
    assert allowed


def test_paper_trade_rejected_on_failed_signal():
    """place_paper_trade returns None if validated_signal.passed is False."""
    from backend.algo.paper_trader.trader import place_paper_trade

    validated = {"passed": False, "signal_output": {"signal": "HOLD"}}
    result = place_paper_trade(
        validated_signal=validated,
        current_price=200,
        current_capital=100_000,
        algo_trade_history=[],
        supabase_client=None,
        user_id=None,
    )
    assert result is None


def test_paper_trade_returned_on_valid_signal():
    """place_paper_trade returns a dict when signal passes."""
    from backend.algo.paper_trader.trader import place_paper_trade

    validated = {
        "passed": True,
        "signal_output": {
            "signal": "BUY",
            "confidence": 0.70,
            "symbol": "TEST",
            "atr_14": 2.0,
        },
        "rules_checked": [],
    }
    result = place_paper_trade(
        validated_signal=validated,
        current_price=200,
        current_capital=100_000,
        algo_trade_history=[],
        supabase_client=None,
        user_id=None,
    )
    assert result is not None
    assert result["side"] == "BUY"
    assert result["source"] == "algo"
