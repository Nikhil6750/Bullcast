"""
Tests for the feature pipeline: output shape, no NaN in last row, stable version hash.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from backend.algo.features.pipeline import compute_features, compute_single_feature_vector
from backend.algo.features.schema import ALL_FEATURE_NAMES, get_pipeline_version


def _make_candles(n: int = 400, seed: int = 7) -> list[dict]:
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
            "open": float(opens[i]),
            "high": float(highs[i]),
            "low": float(lows[i]),
            "close": float(closes[i]),
            "volume": float(volumes[i]),
        }
        for i in range(n)
    ]


CANDLES = _make_candles(400)


def test_compute_features_returns_dataframe():
    df = compute_features(CANDLES, "TEST")
    assert isinstance(df, pd.DataFrame)
    assert len(df) > 0


def test_all_feature_columns_present():
    df = compute_features(CANDLES, "TEST")
    for col in ALL_FEATURE_NAMES:
        assert col in df.columns, f"Missing feature column: {col}"


def test_last_row_has_no_nan_in_key_features():
    df = compute_features(CANDLES, "TEST")
    last = df.iloc[-1]
    # At least price action and MA features should be non-NaN after warmup
    for col in ["return_1", "ema9", "rsi_14", "atr_14", "volume_ratio"]:
        if col in last.index:
            assert not pd.isna(last[col]), f"NaN in last row for {col}"


def test_pipeline_version_stable():
    v1 = get_pipeline_version()
    v2 = get_pipeline_version()
    assert v1 == v2
    assert len(v1) == 16


def test_compute_single_feature_vector():
    vec = compute_single_feature_vector(CANDLES, "TEST")
    assert isinstance(vec, dict)
    assert "pipeline_version" in vec


def test_compute_single_feature_vector_raises_on_too_few_candles():
    with pytest.raises(ValueError, match="at least"):
        compute_single_feature_vector(CANDLES[:50], "TEST")
