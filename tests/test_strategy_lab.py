from __future__ import annotations

import pytest

from backend.strategy_lab import StrategyLabError, run_strategy_lab


def _candle(index: int, *, open_: float, high: float, low: float, close: float, volume: float = 1.0) -> dict:
    return {
        "time": index * 300,
        "open": float(open_),
        "high": float(high),
        "low": float(low),
        "close": float(close),
        "volume": float(volume),
    }


def test_moving_average_strategy_returns_backend_signals_and_overlays():
    candles = [
        _candle(0, open_=100.0, high=100.2, low=99.8, close=100.0),
        _candle(1, open_=100.1, high=101.2, low=99.9, close=101.0),
        _candle(2, open_=100.2, high=102.2, low=100.0, close=102.0),
        _candle(3, open_=100.3, high=103.2, low=100.1, close=103.0),
        _candle(4, open_=100.4, high=102.2, low=100.2, close=102.0),
        _candle(5, open_=100.5, high=101.2, low=99.8, close=101.0),
        _candle(6, open_=100.6, high=100.2, low=98.8, close=100.0),
        _candle(7, open_=100.7, high=99.2, low=97.8, close=99.0),
        _candle(8, open_=100.8, high=100.2, low=98.8, close=100.0),
        _candle(9, open_=100.9, high=101.2, low=99.8, close=101.0),
        _candle(10, open_=101.0, high=102.2, low=100.0, close=102.0),
        _candle(11, open_=101.1, high=103.2, low=100.1, close=103.0),
    ]

    result = run_strategy_lab(
        candles,
        strategy_type="moving_average",
        parameters={"fast_ma_period": 2, "slow_ma_period": 3, "ma_type": "SMA"},
    )

    assert [signal["side"] for signal in result["signals"]] == ["SELL", "BUY"]
    assert [trade["direction"] for trade in result["trades"]] == ["SELL", "BUY"]
    assert result["strategy"]["parameters"] == {
        "fast_ma_period": 2,
        "slow_ma_period": 3,
        "ma_type": "SMA",
    }
    assert [overlay["label"] for overlay in result["overlays"]] == ["Fast SMA 2", "Slow SMA 3"]
    assert result["metrics"]["totalTrades"] == 2
    assert result["setups"][0]["direction"] == "SELL"
    assert result["setups"][1]["direction"] == "BUY"


def test_rsi_strategy_validates_threshold_order():
    candles = [
        _candle(0, open_=100.0, high=100.5, low=99.5, close=100.0),
        _candle(1, open_=99.8, high=100.2, low=98.8, close=99.0),
        _candle(2, open_=98.8, high=99.2, low=97.8, close=98.0),
    ]

    with pytest.raises(StrategyLabError, match="Oversold must be smaller than Overbought"):
        run_strategy_lab(
            candles,
            strategy_type="rsi",
            parameters={"rsi_length": 3, "overbought": 25, "oversold": 30},
        )


def test_breakout_strategy_returns_trade_windows():
    candles = [
        _candle(0, open_=99.8, high=100.5, low=99.5, close=100.0),
        _candle(1, open_=100.8, high=101.5, low=100.5, close=101.0),
        _candle(2, open_=101.8, high=102.5, low=101.5, close=102.0),
        _candle(3, open_=102.8, high=103.5, low=102.5, close=103.0),
        _candle(4, open_=103.8, high=104.5, low=103.5, close=104.0),
        _candle(5, open_=105.8, high=106.5, low=105.5, close=106.0),
        _candle(6, open_=106.8, high=107.5, low=106.5, close=107.0),
        _candle(7, open_=102.8, high=103.5, low=102.5, close=103.0),
        _candle(8, open_=99.8, high=100.5, low=99.5, close=100.0),
        _candle(9, open_=97.8, high=98.5, low=97.5, close=98.0),
    ]

    result = run_strategy_lab(
        candles,
        strategy_type="breakout",
        parameters={"lookback_period": 3, "breakout_threshold": 0},
    )

    assert [signal["side"] for signal in result["signals"]] == ["BUY", "SELL"]
    assert result["trades"][1]["direction"] == "SELL"
    assert result["trades"][1]["exit_reason"] == "end_of_data"
    assert result["setups"][0]["range_start_time"] <= result["setups"][0]["entry_time"]
    assert result["setups"][0]["range_end_time"] >= result["setups"][0]["exit_time"]


def test_pine_script_strategy_converts_supported_ta_functions():
    candles = [
        _candle(0, open_=99.8, high=100.2, low=99.6, close=100.0),
        _candle(1, open_=100.8, high=101.2, low=100.6, close=101.0),
        _candle(2, open_=101.8, high=102.2, low=101.6, close=102.0),
        _candle(3, open_=102.8, high=103.2, low=102.6, close=103.0),
        _candle(4, open_=101.8, high=102.2, low=101.6, close=102.0),
        _candle(5, open_=100.8, high=101.2, low=100.6, close=101.0),
        _candle(6, open_=99.8, high=100.2, low=99.6, close=100.0),
        _candle(7, open_=98.8, high=99.2, low=98.6, close=99.0),
        _candle(8, open_=99.8, high=100.2, low=99.6, close=100.0),
        _candle(9, open_=100.8, high=101.2, low=100.6, close=101.0),
        _candle(10, open_=101.8, high=102.2, low=101.6, close=102.0),
        _candle(11, open_=102.8, high=103.2, low=102.6, close=103.0),
    ]
    pine_script = """
fast = ta.ema(close, 2)
slow = ta.ema(close, 4)
buy = ta.crossover(fast, slow)
sell = ta.crossunder(fast, slow)
"""

    result = run_strategy_lab(candles, strategy_type="pine_script", pine_script=pine_script)

    assert [signal["side"] for signal in result["signals"]] == ["BUY", "SELL", "BUY"]
    assert [overlay["label"] for overlay in result["overlays"]] == ["fast", "slow"]
    assert result["metrics"]["totalTrades"] == 3
    assert result["strategy"]["type"] == "pine_script"
