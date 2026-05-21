"""
Mandatory test: no feature column may use future data.

For every feature group, we truncate the DataFrame at index k and verify
that the feature value at row k equals the value computed on the full
500-row fixture.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from backend.algo.features.price_action import add_price_action_features
from backend.algo.features.moving_averages import add_moving_average_features
from backend.algo.features.momentum import add_momentum_features
from backend.algo.features.volatility import add_volatility_features
from backend.algo.features.volume import add_volume_features
from backend.algo.features.streak_features import add_streak_features


def _make_fixture(n: int = 500, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    closes = 100.0 + np.cumsum(rng.normal(0, 0.5, n))
    opens = closes + rng.normal(0, 0.2, n)
    highs = np.maximum(closes, opens) + rng.uniform(0, 0.5, n)
    lows = np.minimum(closes, opens) - rng.uniform(0, 0.5, n)
    volumes = rng.uniform(1_000, 10_000, n)
    times = pd.date_range("2023-01-01", periods=n, freq="1min")
    return pd.DataFrame(
        {"open": opens, "high": highs, "low": lows, "close": closes, "volume": volumes, "time": times.astype(int) // 10**6},
        index=times,
    )


FIXTURE = _make_fixture(500)
CHECK_INDEX = 299  # arbitrary middle row


def _check_group(fn, df_full: pd.DataFrame, k: int, cols: list[str]) -> None:
    full = fn(df_full.copy())
    truncated = fn(df_full.iloc[: k + 1].copy())

    for col in cols:
        if col not in full.columns or col not in truncated.columns:
            continue
        full_val = full[col].iloc[k]
        trunc_val = truncated[col].iloc[k]

        both_nan = (pd.isna(full_val) and pd.isna(trunc_val))
        if both_nan:
            continue

        assert not pd.isna(full_val) or pd.isna(trunc_val), \
            f"Lookahead in {col}: full={full_val}, truncated={trunc_val}"

        if not pd.isna(full_val) and not pd.isna(trunc_val):
            assert abs(float(full_val) - float(trunc_val)) < 1e-6, \
                f"Lookahead in column '{col}': full={full_val}, truncated={trunc_val}"


def test_price_action_no_lookahead():
    cols = [
        "return_1", "return_5", "log_return_1", "hl_spread",
        "body_ratio", "upper_wick_ratio", "lower_wick_ratio", "close_position",
    ]
    _check_group(add_price_action_features, FIXTURE, CHECK_INDEX, cols)


def test_moving_averages_no_lookahead():
    cols = [
        "ema9", "ema21", "ema50", "ema200", "sma20", "sma50",
        "price_vs_ema9", "price_vs_ema21", "price_vs_ema50", "price_vs_ema200",
        "ema9_vs_ema21", "ema21_vs_ema50", "ema50_vs_ema200",
    ]
    _check_group(add_moving_average_features, FIXTURE, CHECK_INDEX, cols)


def test_momentum_no_lookahead():
    cols = [
        "rsi_7", "rsi_14", "rsi_21",
        "stoch_k", "stoch_d",
        "roc_5", "roc_10", "roc_20",
        "williams_r", "cci_20", "mfi_14",
    ]
    _check_group(add_momentum_features, FIXTURE, CHECK_INDEX, cols)


def test_volatility_no_lookahead():
    cols = [
        "atr_7", "atr_14", "atr_pct",
        "bb_upper", "bb_middle", "bb_lower", "bb_width", "bb_position",
        "hist_vol_10", "hist_vol_20",
    ]
    _check_group(add_volatility_features, FIXTURE, CHECK_INDEX, cols)


def test_volume_no_lookahead():
    cols = [
        "obv", "obv_slope", "vwap_deviation",
        "volume_zscore", "volume_ratio", "cmf_20",
    ]
    _check_group(add_volume_features, FIXTURE, CHECK_INDEX, cols)


def test_streak_features_no_lookahead():
    cols = [
        "streak_active", "streak_direction", "streak_length",
        "candles_since_streak", "pullback_active", "pullback_count",
        "midpoint_touched", "structural_target_dist", "setup_forming",
    ]
    _check_group(add_streak_features, FIXTURE, CHECK_INDEX, cols)
