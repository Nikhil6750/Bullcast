"""Tests for each validator rule: passes/rejects correct synthetic signals."""
import pytest

from backend.algo.validator.engine import validate
from backend.algo.validator.rules import (
    MinConfidenceRule, StreakPatternRule, TrendAlignmentRule, VolatileRegimeRule,
)

_CANDLES = [{"time": i, "open": 100, "high": 101, "low": 99, "close": 100, "volume": 1000} for i in range(5)]


def _sig(signal="BUY", confidence=0.65):
    return {"signal": signal, "confidence": confidence}


def _feat(**kwargs):
    defaults = {"setup_forming": 1, "streak_direction": 1, "tf1h_trend": 0, "regime": 0}
    return {**defaults, **kwargs}


# MinConfidenceRule
def test_min_confidence_passes():
    assert MinConfidenceRule.check(_sig(confidence=0.65), _feat())

def test_min_confidence_rejects():
    assert not MinConfidenceRule.check(_sig(confidence=0.50), _feat())

def test_min_confidence_boundary():
    assert MinConfidenceRule.check(_sig(confidence=0.58), _feat())


# StreakPatternRule
def test_streak_pattern_buy_passes():
    assert StreakPatternRule.check(_sig("BUY"), _feat(setup_forming=1, streak_direction=1))

def test_streak_pattern_sell_passes():
    assert StreakPatternRule.check(_sig("SELL"), _feat(setup_forming=1, streak_direction=-1))

def test_streak_pattern_no_setup():
    assert not StreakPatternRule.check(_sig("BUY"), _feat(setup_forming=0, streak_direction=1))

def test_streak_pattern_direction_mismatch():
    assert not StreakPatternRule.check(_sig("BUY"), _feat(setup_forming=1, streak_direction=-1))


# TrendAlignmentRule
def test_trend_alignment_buy_neutral_passes():
    assert TrendAlignmentRule.check(_sig("BUY"), _feat(tf1h_trend=0))

def test_trend_alignment_buy_bearish_rejects():
    assert not TrendAlignmentRule.check(_sig("BUY"), _feat(tf1h_trend=-1))

def test_trend_alignment_sell_bullish_rejects():
    assert not TrendAlignmentRule.check(_sig("SELL"), _feat(tf1h_trend=1))

def test_trend_alignment_sell_bearish_passes():
    assert TrendAlignmentRule.check(_sig("SELL"), _feat(tf1h_trend=-1))


# VolatileRegimeRule
def test_volatile_regime_stable_passes():
    assert VolatileRegimeRule.check(_sig(confidence=0.60), _feat(regime=1))

def test_volatile_regime_volatile_low_conf_rejects():
    assert not VolatileRegimeRule.check(_sig(confidence=0.65), _feat(regime=2))

def test_volatile_regime_volatile_high_conf_passes():
    assert VolatileRegimeRule.check(_sig(confidence=0.75), _feat(regime=2))


# Full validate()
def test_validate_hold_rejected():
    result = validate({"signal": "HOLD", "confidence": 0.8}, _feat(), _CANDLES)
    assert not result["passed"]

def test_validate_buy_all_pass():
    result = validate(
        _sig("BUY", confidence=0.75),
        _feat(setup_forming=1, streak_direction=1, tf1h_trend=0, regime=0),
        _CANDLES,
    )
    assert result["passed"]

def test_validate_buy_low_confidence_fails():
    result = validate(
        _sig("BUY", confidence=0.40),
        _feat(setup_forming=1, streak_direction=1, tf1h_trend=0, regime=0),
        _CANDLES,
    )
    assert not result["passed"]
    assert "min_confidence" in result["rejection_reason"]
