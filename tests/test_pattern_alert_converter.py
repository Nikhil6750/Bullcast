from __future__ import annotations

import csv
import json
from pathlib import Path

from backend.datasets.pattern_alert_journal import (
    Candle,
    StrategyConfig,
    convert_pattern_alert_files,
    detect_streaks,
    evaluate_streak_setup,
    simulate_psychology,
    simulate_trade,
    _symbol_from_filename,
)


def _c(index: int, open_: float, high: float, low: float, close: float) -> Candle:
    return Candle(
        index=index,
        time=1_700_000_000 + index * 300,
        open=float(open_),
        high=float(high),
        low=float(low),
        close=float(close),
        volume=10.0,
    )


def _valid_bullish_sequence(*, target_hit: bool = True) -> list[Candle]:
    candles = [
        _c(0, 1.0, 2.1, 0.9, 2.0),
        _c(1, 2.0, 3.1, 1.9, 3.0),
        _c(2, 3.0, 4.1, 2.9, 4.0),
        _c(3, 4.0, 5.1, 3.8, 5.0),
        _c(4, 4.9, 5.0, 4.4, 4.6),
        _c(5, 4.5, 4.6, 3.6, 3.7),
        _c(6, 3.75, 4.05, 3.7, 4.0),
    ]
    if target_hit:
        candles.append(_c(7, 4.0, 4.9, 3.9, 4.85))
    else:
        candles.append(_c(7, 4.0, 4.2, 3.5, 3.7))
    return candles


def test_bullish_streak_detection():
    candles = [
        _c(0, 1, 2, 0.9, 2),
        _c(1, 2, 3, 1.9, 3),
        _c(2, 3, 4, 2.9, 4),
        _c(3, 4, 5, 3.9, 5),
        _c(4, 5, 5.1, 4.4, 4.5),
    ]

    streaks = detect_streaks(candles)

    assert len(streaks) == 1
    assert streaks[0].direction == "bullish"
    assert streaks[0].length == 4


def test_bearish_streak_detection():
    candles = [
        _c(0, 5, 5.1, 3.9, 4),
        _c(1, 4, 4.1, 2.9, 3),
        _c(2, 3, 3.1, 1.9, 2),
        _c(3, 2, 2.1, 0.9, 1),
        _c(4, 1, 1.6, 0.9, 1.5),
    ]

    streaks = detect_streaks(candles)

    assert len(streaks) == 1
    assert streaks[0].direction == "bearish"
    assert streaks[0].length == 4


def test_invalid_pullback_retracement_is_rejected():
    candles = [
        _c(0, 1, 2.1, 0.9, 2),
        _c(1, 2, 3.1, 1.9, 3),
        _c(2, 3, 4.1, 2.9, 4),
        _c(3, 4, 5.1, 3.8, 5),
        _c(4, 4.9, 5.0, 3.9, 4.6),
        _c(5, 4.5, 4.6, 3.6, 3.7),
        _c(6, 3.75, 4.05, 3.7, 4.0),
    ]
    streak = detect_streaks(candles)[0]

    setup, reason = evaluate_streak_setup(candles, streak)

    assert setup is None
    assert reason == "critical_retracement"


def test_doji_pullback_is_rejected():
    candles = [
        _c(0, 1, 2.1, 0.9, 2),
        _c(1, 2, 3.1, 1.9, 3),
        _c(2, 3, 4.1, 2.9, 4),
        _c(3, 4, 5.1, 3.8, 5),
        _c(4, 4.5, 4.8, 4.2, 4.5),
        _c(5, 4.5, 4.6, 3.6, 3.7),
        _c(6, 3.75, 4.05, 3.7, 4.0),
    ]
    streak = detect_streaks(candles)[0]

    setup, reason = evaluate_streak_setup(candles, streak)

    assert setup is None
    assert reason == "doji_in_pullback"


def test_midpoint_target_uses_last_streak_low_when_touched():
    candles = _valid_bullish_sequence()
    streak = detect_streaks(candles)[0]

    setup, reason = evaluate_streak_setup(candles, streak)

    assert reason == "valid"
    assert setup is not None
    assert setup.midpoint_touched is True
    assert setup.structural_target_source == "last_streak_low"
    assert setup.structural_target == candles[3].low


def test_breaking_candle_must_cross_target():
    candles = _valid_bullish_sequence()
    candles[5] = _c(5, 4.5, 4.8, 4.1, 4.2)
    streak = detect_streaks(candles)[0]

    setup, reason = evaluate_streak_setup(candles, streak)

    assert setup is None
    assert reason == "breaking_candle_failed"


def test_confirmation_candle_must_match_original_direction():
    candles = _valid_bullish_sequence()
    candles[6] = _c(6, 4.0, 4.1, 3.6, 3.8)
    streak = detect_streaks(candles)[0]

    setup, reason = evaluate_streak_setup(candles, streak)

    assert setup is None
    assert reason == "confirmation_failed"


def test_stop_loss_handling():
    candles = _valid_bullish_sequence(target_hit=False)
    streak = detect_streaks(candles)[0]
    setup, reason = evaluate_streak_setup(candles, streak)

    trade = simulate_trade(candles, setup, StrategyConfig())

    assert reason == "valid"
    assert trade is not None
    assert trade.outcome == "STOP_LOSS"
    assert trade.exit_price == setup.stop_loss
    assert trade.realized_rr == -1


def test_rr_calculation_for_target_hit():
    candles = _valid_bullish_sequence(target_hit=True)
    streak = detect_streaks(candles)[0]
    setup, reason = evaluate_streak_setup(candles, streak)

    trade = simulate_trade(candles, setup, StrategyConfig(rr_target=2.0))

    assert reason == "valid"
    assert trade is not None
    assert trade.outcome == "TARGET"
    assert trade.realized_rr == 2.0


def test_psychology_simulation_is_deterministic():
    candles = _valid_bullish_sequence(target_hit=False)
    streak = detect_streaks(candles)[0]
    setup, _reason = evaluate_streak_setup(candles, streak)
    previous = {"outcome": "LOSS", "exit_index": 5}

    first = simulate_psychology(candles, setup, 5, "STOP_LOSS", -1.0, previous_trade=previous)
    second = simulate_psychology(candles, setup, 5, "STOP_LOSS", -1.0, previous_trade=previous)

    assert first == second
    assert first in {
        "none",
        "FOMO entry",
        "early exit",
        "revenge trade",
        "overconfidence",
        "weak confirmation",
        "chasing momentum",
        "no patience",
        "oversized position",
        "emotional re-entry",
    }


def test_converter_writes_journal_summary_and_statistics(tmp_path: Path):
    candles = _valid_bullish_sequence(target_hit=True)
    source = tmp_path / "FX_TEST.csv"
    source.write_text(
        "\n".join(
            ["time,open,high,low,close,Pattern Alert,Volume"]
            + [
                f"{candle.time},{candle.open},{candle.high},{candle.low},{candle.close},0,{candle.volume}"
                for candle in candles
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    output = tmp_path / "journal.csv"

    summary = convert_pattern_alert_files([source], output)

    rows = list(csv.DictReader(output.open(encoding="utf-8")))
    statistics = json.loads(summary.statistics_path.read_text(encoding="utf-8"))
    generation_summary = json.loads(summary.summary_path.read_text(encoding="utf-8"))

    assert summary.output_rows == 1
    assert rows[0]["symbol"] == "TEST"
    assert rows[0]["setup"] == "Streak Pullback Confirmation"
    assert "SIMULATED DATA" in rows[0]["notes"]
    assert statistics["total_setups_found"] == 1
    assert statistics["valid_setups"] == 1
    assert statistics["win_rate"] == 100.0
    assert generation_summary["totals"]["simulated_trades_generated"] == 1


def test_symbol_from_copied_latest_filename_is_normalized():
    assert _symbol_from_filename(Path("backend/datasets/latest/FX_EURUSD (1).csv")) == "EURUSD"
    assert _symbol_from_filename(Path("backend/datasets/latest/BINANCE_BTCUSDT (1).csv")) == "BTCUSDT"
    assert _symbol_from_filename(Path("backend/datasets/latest/NSE_NIFTY (1).csv")) == "NIFTY"
