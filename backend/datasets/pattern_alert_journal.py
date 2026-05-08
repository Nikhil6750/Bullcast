from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Literal


OUTPUT_FIELDS = [
    "date",
    "symbol",
    "side",
    "entry",
    "exit",
    "quantity",
    "setup",
    "confidence",
    "mistake",
    "notes",
]

SETUP_NAME = "Streak Pullback Confirmation"
SIMULATED_PREFIX = "SIMULATED DATA - not real trading history."
Color = Literal["bullish", "bearish", "doji"]
Direction = Literal["bullish", "bearish"]
Side = Literal["BUY", "SELL"]


@dataclass(frozen=True)
class StrategyConfig:
    tiny_threshold: float = 1e-10
    min_streak: int = 4
    max_pullback_candles: int = 2
    rr_target: float = 2.0
    max_hold_candles: int = 36
    conservative_intrabar_order: bool = True


@dataclass(frozen=True)
class Candle:
    index: int
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0
    pattern_alert: str = "0"


@dataclass(frozen=True)
class Streak:
    direction: Direction
    start_index: int
    end_index: int
    length: int


@dataclass(frozen=True)
class Setup:
    symbol: str
    direction: Direction
    side: Side
    streak_start_index: int
    streak_end_index: int
    streak_length: int
    pullback_indexes: tuple[int, ...]
    midpoint: float
    midpoint_touched: bool
    structural_target: float
    structural_target_source: str
    breaking_index: int
    confirmation_index: int
    entry: float
    stop_loss: float
    target_price: float
    risk_distance: float
    volatility_pct: float


@dataclass(frozen=True)
class SimulatedTrade:
    setup: Setup
    exit_index: int
    exit_price: float
    outcome: str
    pnl_per_unit: float
    realized_rr: float
    hold_candles: int
    confidence: int
    mistake: str
    notes: str


@dataclass(frozen=True)
class ConversionSummary:
    input_files: int
    output_rows: int
    skipped_rows: int
    output_path: Path
    summary_path: Path
    statistics_path: Path
    total_setups_found: int
    valid_setups: int
    invalid_setups: int


def convert_pattern_alert_files(
    input_paths: Iterable[str | Path],
    output_path: str | Path,
    *,
    quantity: float | None = None,
    min_exit_candles: int | None = None,
    max_exit_candles: int | None = None,
    rr_target: float = 2.0,
    max_hold_candles: int = 36,
    summary_path: str | Path | None = None,
    statistics_path: str | Path | None = None,
) -> ConversionSummary:
    """
    Convert OHLC candles into simulated Bullcast journal rows.

    The historical function name is retained for compatibility with the
    existing offline pipeline. Pattern Alert values are parsed for data
    compatibility, but trade generation now uses the institutional-grade
    Streak Pullback Confirmation engine.
    """

    config = StrategyConfig(
        rr_target=float(rr_target),
        max_hold_candles=int(max_exit_candles or max_hold_candles),
    )
    paths = [Path(path) for path in input_paths]
    rows: list[dict[str, Any]] = []
    file_summaries: list[dict[str, Any]] = []
    aggregate = _empty_stats(config)

    for path in paths:
        result = convert_pattern_alert_file(
            path,
            quantity=quantity,
            min_exit_candles=min_exit_candles,
            max_exit_candles=max_exit_candles,
            config=config,
        )
        rows.extend(result["rows"])
        file_summaries.append(result["summary"])
        _merge_stats(aggregate, result["statistics"])

    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=OUTPUT_FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    aggregate["input_files"] = len(paths)
    aggregate["simulated_trades_generated"] = len(rows)
    aggregate["output_path"] = str(destination)
    _finalize_stats(aggregate)

    summary_destination = Path(summary_path) if summary_path else destination.with_name(f"{destination.stem}-summary.json")
    statistics_destination = (
        Path(statistics_path) if statistics_path else destination.with_name(f"{destination.stem}-statistics.json")
    )
    _write_json(
        summary_destination,
        {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "strategy": SETUP_NAME,
            "simulated_only": True,
            "disclaimer": "Generated rows are simulated from OHLC structure and are not real trading history.",
            "config": asdict(config),
            "input_files": [str(path) for path in paths],
            "output_csv": str(destination),
            "statistics_json": str(statistics_destination),
            "files": file_summaries,
            "totals": {
                "setups_detected": aggregate["total_setups_found"],
                "valid_setups": aggregate["valid_setups"],
                "invalid_setups": aggregate["invalid_setups"],
                "simulated_trades_generated": len(rows),
            },
        },
    )
    _write_json(statistics_destination, aggregate)

    return ConversionSummary(
        input_files=len(paths),
        output_rows=len(rows),
        skipped_rows=aggregate["invalid_setups"],
        output_path=destination,
        summary_path=summary_destination,
        statistics_path=statistics_destination,
        total_setups_found=aggregate["total_setups_found"],
        valid_setups=aggregate["valid_setups"],
        invalid_setups=aggregate["invalid_setups"],
    )


def convert_pattern_alert_file(
    input_path: str | Path,
    *,
    quantity: float | None = None,
    min_exit_candles: int | None = None,
    max_exit_candles: int | None = None,
    config: StrategyConfig | None = None,
) -> dict[str, Any]:
    cfg = config or StrategyConfig(
        max_hold_candles=int(max_exit_candles or 36),
    )
    path = Path(input_path)
    read_result = read_candles(path, cfg)
    symbol = _symbol_from_filename(path)
    asset_class = _asset_class_from_filename(path)
    base_quantity = float(quantity) if quantity is not None else _default_quantity(symbol, asset_class)
    rows: list[dict[str, Any]] = []
    stats = _empty_stats(cfg)
    stats["input_files"] = 1
    stats["total_input_candles"] = read_result["raw_rows"]
    stats["valid_candles"] = len(read_result["candles"])
    stats["malformed_candles"] = read_result["malformed_rows"]

    previous_by_symbol: dict[str, dict[str, Any]] = {}
    detections = detect_streak_pullback_setups(read_result["candles"], cfg)

    for detection in detections:
        stats["total_setups_found"] += 1
        if detection["setup"] is None:
            stats["invalid_setups"] += 1
            stats["invalid_reason_distribution"][detection["reason"]] += 1
            continue

        setup = detection["setup"]
        trade = simulate_trade(
            read_result["candles"],
            setup,
            cfg,
            quantity=base_quantity,
            previous_trade=previous_by_symbol.get(symbol),
        )
        if trade is None:
            stats["invalid_setups"] += 1
            stats["invalid_reason_distribution"]["trade_management_failed"] += 1
            continue

        stats["valid_setups"] += 1
        stats["bullish_setups"] += 1 if setup.direction == "bullish" else 0
        stats["bearish_setups"] += 1 if setup.direction == "bearish" else 0
        stats["outcome_distribution"][trade.outcome] += 1
        stats["mistake_distribution"][trade.mistake] += 1
        stats["confidence_distribution"][str(trade.confidence)] += 1
        stats["_rr_values"].append(trade.realized_rr)
        stats["_hold_values"].append(trade.hold_candles)
        stats["_wins"] += 1 if trade.pnl_per_unit > 0 else 0
        stats["_losses"] += 1 if trade.pnl_per_unit < 0 else 0

        rows.append(_trade_to_output_row(read_result["candles"], trade, symbol, base_quantity))
        previous_by_symbol[symbol] = {
            "outcome": "WIN" if trade.pnl_per_unit > 0 else "LOSS" if trade.pnl_per_unit < 0 else "FLAT",
            "exit_index": trade.exit_index,
        }

    return {
        "rows": rows,
        "summary": {
            "file": str(path),
            "symbol": symbol,
            "asset_class": asset_class,
            "raw_candles": read_result["raw_rows"],
            "valid_candles": len(read_result["candles"]),
            "malformed_candles": read_result["malformed_rows"],
            "setups_found": stats["total_setups_found"],
            "valid_setups": stats["valid_setups"],
            "invalid_setups": stats["invalid_setups"],
            "simulated_trades": len(rows),
        },
        "statistics": stats,
    }


def read_candles(path: Path, config: StrategyConfig | None = None) -> dict[str, Any]:
    cfg = config or StrategyConfig()
    candles: list[Candle] = []
    raw_rows = 0
    malformed_rows = 0

    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        for raw in reader:
            raw_rows += 1
            normalized = {_normalize_header(key): value for key, value in raw.items()}
            candle = _parse_candle(normalized, len(candles), cfg)
            if candle is None:
                malformed_rows += 1
                continue
            candles.append(candle)

    candles.sort(key=lambda candle: (candle.time, candle.index))
    candles = [
        Candle(
            index=index,
            time=candle.time,
            open=candle.open,
            high=candle.high,
            low=candle.low,
            close=candle.close,
            volume=candle.volume,
            pattern_alert=candle.pattern_alert,
        )
        for index, candle in enumerate(candles)
    ]
    return {"candles": candles, "raw_rows": raw_rows, "malformed_rows": malformed_rows}


def detect_streaks(candles: list[Candle], config: StrategyConfig | None = None) -> list[Streak]:
    cfg = config or StrategyConfig()
    streaks: list[Streak] = []
    index = 0

    while index < len(candles):
        color = candle_color(candles[index], cfg.tiny_threshold)
        if color == "doji":
            index += 1
            continue

        start = index
        while index + 1 < len(candles) and candle_color(candles[index + 1], cfg.tiny_threshold) == color:
            index += 1
        end = index
        length = end - start + 1
        if length >= cfg.min_streak:
            streaks.append(Streak(direction=color, start_index=start, end_index=end, length=length))
        index += 1

    return streaks


def detect_streak_pullback_setups(candles: list[Candle], config: StrategyConfig | None = None) -> list[dict[str, Any]]:
    cfg = config or StrategyConfig()
    detections: list[dict[str, Any]] = []
    for streak in detect_streaks(candles, cfg):
        setup, reason = evaluate_streak_setup(candles, streak, cfg)
        detections.append({"streak": streak, "setup": setup, "reason": reason})
    return detections


def evaluate_streak_setup(
    candles: list[Candle],
    streak: Streak,
    config: StrategyConfig | None = None,
) -> tuple[Setup | None, str]:
    cfg = config or StrategyConfig()
    opposite = "bearish" if streak.direction == "bullish" else "bullish"
    last_streak = candles[streak.end_index]
    cursor = streak.end_index + 1
    pullback_indexes: list[int] = []

    if cursor >= len(candles):
        return None, "missing_pullback"

    while len(pullback_indexes) < cfg.max_pullback_candles:
        if cursor >= len(candles):
            return None, "missing_breaking_candle" if pullback_indexes else "missing_pullback"

        color = candle_color(candles[cursor], cfg.tiny_threshold)
        if color == "doji":
            return None, "doji_in_pullback"
        if color != opposite:
            return None, "missing_pullback" if not pullback_indexes else "breaking_candle_failed"
        if _retracement_invalid(streak.direction, last_streak, candles[cursor]):
            return None, "critical_retracement"
        pullback_indexes.append(cursor)
        cursor += 1

        setup, reason = _build_setup_after_pullback(candles, streak, tuple(pullback_indexes), cursor, cfg)
        if setup is not None or reason != "breaking_candle_failed":
            return setup, reason

        if cursor < len(candles) and candle_color(candles[cursor], cfg.tiny_threshold) == opposite:
            continue
        return None, reason

    return _build_setup_after_pullback(candles, streak, tuple(pullback_indexes), cursor, cfg)


def _build_setup_after_pullback(
    candles: list[Candle],
    streak: Streak,
    pullback_indexes: tuple[int, ...],
    breaking_index: int,
    config: StrategyConfig,
) -> tuple[Setup | None, str]:
    if not pullback_indexes:
        return None, "missing_pullback"
    if breaking_index >= len(candles):
        return None, "missing_breaking_candle"

    last_streak = candles[streak.end_index]
    midpoint = (last_streak.open + last_streak.close) / 2.0
    midpoint_touched = any(_touches_level(candles[index], midpoint) for index in pullback_indexes)
    if streak.direction == "bullish":
        structural_target = last_streak.low if midpoint_touched else min(candles[index].low for index in pullback_indexes)
        target_source = "last_streak_low" if midpoint_touched else "pullback_low"
        breaking_ok = candles[breaking_index].close < structural_target
        side: Side = "BUY"
    else:
        structural_target = last_streak.high if midpoint_touched else max(candles[index].high for index in pullback_indexes)
        target_source = "last_streak_high" if midpoint_touched else "pullback_high"
        breaking_ok = candles[breaking_index].close > structural_target
        side = "SELL"

    if not breaking_ok:
        return None, "breaking_candle_failed"

    confirmation_index = breaking_index + 1
    if confirmation_index >= len(candles):
        return None, "missing_confirmation_candle"

    confirmation_color = candle_color(candles[confirmation_index], config.tiny_threshold)
    if confirmation_color != streak.direction:
        return None, "confirmation_failed"

    confirmation = candles[confirmation_index]
    breaking = candles[breaking_index]
    entry = confirmation.close
    stop_loss = breaking.low if side == "BUY" else breaking.high
    risk_distance = entry - stop_loss if side == "BUY" else stop_loss - entry
    if risk_distance <= 0 or not math.isfinite(risk_distance):
        return None, "invalid_risk"

    target_price = entry + (risk_distance * config.rr_target) if side == "BUY" else entry - (risk_distance * config.rr_target)
    segment = candles[streak.start_index : confirmation_index + 1]
    volatility_pct = _volatility_pct(segment)

    return (
        Setup(
            symbol="",
            direction=streak.direction,
            side=side,
            streak_start_index=streak.start_index,
            streak_end_index=streak.end_index,
            streak_length=streak.length,
            pullback_indexes=tuple(pullback_indexes),
            midpoint=midpoint,
            midpoint_touched=midpoint_touched,
            structural_target=structural_target,
            structural_target_source=target_source,
            breaking_index=breaking_index,
            confirmation_index=confirmation_index,
            entry=entry,
            stop_loss=stop_loss,
            target_price=target_price,
            risk_distance=risk_distance,
            volatility_pct=volatility_pct,
        ),
        "valid",
    )


def simulate_trade(
    candles: list[Candle],
    setup: Setup,
    config: StrategyConfig | None = None,
    *,
    quantity: float = 1.0,
    previous_trade: dict[str, Any] | None = None,
) -> SimulatedTrade | None:
    cfg = config or StrategyConfig()
    start = setup.confirmation_index + 1
    if start >= len(candles):
        return None

    max_index = min(len(candles) - 1, setup.confirmation_index + cfg.max_hold_candles)
    exit_index = max_index
    exit_price = candles[max_index].close
    outcome = "TIME_EXIT"

    for index in range(start, max_index + 1):
        candle = candles[index]
        stop_hit, target_hit = _trade_hits(setup, candle)
        if stop_hit and target_hit and cfg.conservative_intrabar_order:
            exit_index = index
            exit_price = setup.stop_loss
            outcome = "STOP_LOSS"
            break
        if target_hit:
            exit_index = index
            exit_price = setup.target_price
            outcome = "TARGET"
            break
        if stop_hit:
            exit_index = index
            exit_price = setup.stop_loss
            outcome = "STOP_LOSS"
            break

    pnl_per_unit = _pnl(setup.side, setup.entry, exit_price, 1.0)
    realized_rr = round(pnl_per_unit / setup.risk_distance, 4) if setup.risk_distance > 0 else 0.0
    hold_candles = exit_index - setup.confirmation_index
    confidence = calculate_confidence(candles, setup, outcome, realized_rr)
    mistake = simulate_psychology(candles, setup, confidence, outcome, realized_rr, previous_trade=previous_trade)
    notes = build_trade_notes(candles, setup, outcome, realized_rr, confidence, mistake)

    return SimulatedTrade(
        setup=setup,
        exit_index=exit_index,
        exit_price=exit_price,
        outcome=outcome,
        pnl_per_unit=pnl_per_unit * float(quantity),
        realized_rr=realized_rr,
        hold_candles=hold_candles,
        confidence=confidence,
        mistake=mistake,
        notes=notes,
    )


def calculate_confidence(candles: list[Candle], setup: Setup, outcome: str, realized_rr: float) -> int:
    pullback_len = len(setup.pullback_indexes)
    confirmation = candles[setup.confirmation_index]
    body_ratio = _body_ratio(confirmation)
    score = 2.4
    score += min(1.0, max(0, setup.streak_length - 4) * 0.25)
    score += 0.45 if pullback_len == 1 else 0.2
    score += 0.25 if setup.midpoint_touched else 0.1
    score += 0.35 if body_ratio >= 0.55 else 0.1 if body_ratio >= 0.3 else -0.25
    score += 0.35 if setup.volatility_pct <= 0.25 else -0.25 if setup.volatility_pct >= 1.25 else 0.1
    score += 0.4 if outcome == "TARGET" else -0.45 if outcome == "STOP_LOSS" else 0.0
    score += 0.2 if realized_rr >= 1.0 else -0.2 if realized_rr < 0 else 0.0
    return max(1, min(5, int(round(score))))


def simulate_psychology(
    candles: list[Candle],
    setup: Setup,
    confidence: int,
    outcome: str,
    realized_rr: float,
    *,
    previous_trade: dict[str, Any] | None = None,
) -> str:
    confirmation = candles[setup.confirmation_index]
    body_ratio = _body_ratio(confirmation)
    previous_loss = previous_trade and previous_trade.get("outcome") == "LOSS"
    previous_exit_index = int(previous_trade.get("exit_index", -10_000)) if previous_trade else -10_000
    recent_after_loss = previous_loss and setup.confirmation_index - previous_exit_index <= 48
    high_volatility = setup.volatility_pct >= 1.0
    long_streak = setup.streak_length >= 7
    weak_confirmation = body_ratio < 0.28

    weights: dict[str, float] = {}
    if setup.streak_length >= 6 or high_volatility:
        weights["FOMO entry"] = 0.08 + (0.08 if long_streak else 0.0) + (0.05 if high_volatility else 0.0)
    if outcome == "TIME_EXIT" or (0 < realized_rr < 1):
        weights["early exit"] = 0.12 + (0.08 if confidence <= 3 else 0.0)
    if previous_loss:
        weights["revenge trade"] = 0.14 + (0.08 if recent_after_loss else 0.0)
    if confidence >= 4:
        weights["overconfidence"] = 0.08 + (0.07 if outcome == "STOP_LOSS" else 0.0) + (0.05 if long_streak else 0.0)
    if weak_confirmation:
        weights["weak confirmation"] = 0.18
    if long_streak and len(setup.pullback_indexes) == 1:
        weights["chasing momentum"] = 0.17
    if len(setup.pullback_indexes) == 1 and not setup.midpoint_touched:
        weights["no patience"] = 0.1
    if high_volatility and confidence >= 4:
        weights["oversized position"] = 0.14
    if recent_after_loss:
        weights["emotional re-entry"] = 0.12

    total = min(0.55, sum(weights.values()))
    if total <= 0:
        return "none"

    seed = f"{setup.side}:{setup.confirmation_index}:{setup.entry:.8f}:{setup.stop_loss:.8f}:{confidence}"
    first_roll = _stable_random(seed)
    if first_roll > total:
        return "none"

    weighted_roll = _stable_random(f"{seed}:select") * sum(weights.values())
    cursor = 0.0
    for mistake, weight in sorted(weights.items()):
        cursor += weight
        if weighted_roll <= cursor:
            return mistake
    return "none"


def build_trade_notes(
    candles: list[Candle],
    setup: Setup,
    outcome: str,
    realized_rr: float,
    confidence: int,
    mistake: str,
) -> str:
    pullback_len = len(setup.pullback_indexes)
    direction_word = "bullish" if setup.direction == "bullish" else "bearish"
    exit_text = {
        "TARGET": f"Trade exited at configured {setup.target_price:.8f} target for {realized_rr:.2f}R.",
        "STOP_LOSS": f"Trade hit stop loss first for {realized_rr:.2f}R.",
        "TIME_EXIT": f"Trade did not hit target or stop within max hold and exited at {realized_rr:.2f}R.",
    }.get(outcome, f"Trade exited at {realized_rr:.2f}R.")
    midpoint_text = "with midpoint touch" if setup.midpoint_touched else "without midpoint touch"
    quality = _setup_quality_label(setup, confidence)
    mistake_text = (
        "No major emotional behavior simulated."
        if mistake == "none"
        else f"{mistake} behavior simulated based on setup quality, volatility, and confidence context."
    )
    confirmation = candles[setup.confirmation_index]

    return (
        f"{SIMULATED_PREFIX} "
        f"{direction_word} {setup.streak_length}-candle streak followed by clean {pullback_len}-candle pullback "
        f"{midpoint_text}. Breaking candle crossed structural target from {setup.structural_target_source}. "
        f"Confirmation candle aligned with original trend and closed at {_format_number(confirmation.close)}. "
        f"{exit_text} Setup quality: {quality}. Confidence={confidence}/5. "
        f"Volatility={setup.volatility_pct:.4f}%. {mistake_text}"
    )


def candle_color(candle: Candle, tiny_threshold: float = 1e-10) -> Color:
    body = candle.close - candle.open
    if abs(body) <= tiny_threshold:
        return "doji"
    return "bullish" if body > 0 else "bearish"


def _parse_candle(raw: dict[str, Any], index: int, config: StrategyConfig) -> Candle | None:
    try:
        time_value = int(float(raw["time"]))
        open_value = float(raw["open"])
        high_value = float(raw["high"])
        low_value = float(raw["low"])
        close_value = float(raw["close"])
        volume_value = float(raw.get("volume") or 0)
    except (KeyError, TypeError, ValueError):
        return None

    values = [open_value, high_value, low_value, close_value, volume_value]
    if not all(math.isfinite(value) for value in values):
        return None
    if high_value <= low_value:
        return None
    if high_value < max(open_value, close_value) or low_value > min(open_value, close_value):
        return None
    if abs(high_value - low_value) <= config.tiny_threshold:
        return None

    return Candle(
        index=index,
        time=time_value,
        open=open_value,
        high=high_value,
        low=low_value,
        close=close_value,
        volume=volume_value,
        pattern_alert=str(raw.get("pattern_alert") or "0").strip(),
    )


def _retracement_invalid(direction: Direction, last_streak: Candle, pullback: Candle) -> bool:
    if direction == "bullish":
        return pullback.low < last_streak.open
    return pullback.high > last_streak.open


def _touches_level(candle: Candle, level: float) -> bool:
    return candle.low <= level <= candle.high


def _trade_hits(setup: Setup, candle: Candle) -> tuple[bool, bool]:
    if setup.side == "BUY":
        return candle.low <= setup.stop_loss, candle.high >= setup.target_price
    return candle.high >= setup.stop_loss, candle.low <= setup.target_price


def _trade_to_output_row(candles: list[Candle], trade: SimulatedTrade, symbol: str, quantity: float) -> dict[str, Any]:
    setup = trade.setup
    return {
        "date": _date_from_time(candles[setup.confirmation_index].time),
        "symbol": symbol,
        "side": setup.side,
        "entry": _format_number(setup.entry),
        "exit": _format_number(trade.exit_price),
        "quantity": _format_number(quantity),
        "setup": SETUP_NAME,
        "confidence": trade.confidence,
        "mistake": trade.mistake,
        "notes": trade.notes,
    }


def _empty_stats(config: StrategyConfig) -> dict[str, Any]:
    return {
        "strategy": SETUP_NAME,
        "simulated_only": True,
        "config": asdict(config),
        "input_files": 0,
        "total_input_candles": 0,
        "valid_candles": 0,
        "malformed_candles": 0,
        "total_setups_found": 0,
        "valid_setups": 0,
        "invalid_setups": 0,
        "bullish_setups": 0,
        "bearish_setups": 0,
        "simulated_trades_generated": 0,
        "win_rate": 0.0,
        "loss_rate": 0.0,
        "average_rr": 0.0,
        "average_hold_duration": 0.0,
        "mistake_distribution": Counter(),
        "confidence_distribution": Counter(),
        "outcome_distribution": Counter(),
        "invalid_reason_distribution": Counter(),
        "_rr_values": [],
        "_hold_values": [],
        "_wins": 0,
        "_losses": 0,
    }


def _merge_stats(target: dict[str, Any], source: dict[str, Any]) -> None:
    for key in [
        "input_files",
        "total_input_candles",
        "valid_candles",
        "malformed_candles",
        "total_setups_found",
        "valid_setups",
        "invalid_setups",
        "bullish_setups",
        "bearish_setups",
        "simulated_trades_generated",
        "_wins",
        "_losses",
    ]:
        target[key] += int(source.get(key, 0) or 0)
    for key in ["_rr_values", "_hold_values"]:
        target[key].extend(source.get(key, []) or [])
    for key in [
        "mistake_distribution",
        "confidence_distribution",
        "outcome_distribution",
        "invalid_reason_distribution",
    ]:
        target[key].update(source.get(key, {}))


def _finalize_stats(stats: dict[str, Any]) -> None:
    valid = int(stats.get("valid_setups") or 0)
    losses = int(stats.get("_losses") or 0)
    wins = int(stats.get("_wins") or 0)
    stats["win_rate"] = round((wins / valid) * 100, 2) if valid else 0.0
    stats["loss_rate"] = round((losses / valid) * 100, 2) if valid else 0.0
    stats["average_rr"] = _average(stats.get("_rr_values", []))
    stats["average_hold_duration"] = _average(stats.get("_hold_values", []))
    for key in [
        "mistake_distribution",
        "confidence_distribution",
        "outcome_distribution",
        "invalid_reason_distribution",
    ]:
        stats[key] = dict(stats.get(key, {}))
    stats.pop("_rr_values", None)
    stats.pop("_hold_values", None)
    stats.pop("_wins", None)
    stats.pop("_losses", None)


def _average(values: list[float | int]) -> float:
    if not values:
        return 0.0
    return round(sum(float(value) for value in values) / len(values), 4)


def _pnl(side: Side, entry: float, exit_value: float, quantity: float) -> float:
    return (entry - exit_value) * quantity if side == "SELL" else (exit_value - entry) * quantity


def _volatility_pct(candles: list[Candle]) -> float:
    ranges = []
    for candle in candles:
        if candle.close:
            ranges.append(abs(candle.high - candle.low) / abs(candle.close) * 100)
    return round(sum(ranges) / len(ranges), 6) if ranges else 0.0


def _body_ratio(candle: Candle) -> float:
    candle_range = candle.high - candle.low
    if candle_range <= 0:
        return 0.0
    return abs(candle.close - candle.open) / candle_range


def _setup_quality_label(setup: Setup, confidence: int) -> str:
    if confidence >= 5:
        return "excellent"
    if confidence >= 4:
        return "strong"
    if confidence == 3:
        return "moderate"
    return "weak"


def _stable_random(seed: str) -> float:
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    return int(digest[:12], 16) / float(0xFFFFFFFFFFFF)


def _normalize_header(value: str | None) -> str:
    return str(value or "").strip().lower().replace(" ", "_")


def _symbol_from_filename(path: Path) -> str:
    stem = re.sub(r"\s*\(\d+\)$", "", path.stem.strip()).upper()
    for prefix in ("FX_", "BINANCE_", "NSE_"):
        if stem.startswith(prefix):
            return stem[len(prefix) :]
    return stem


def _asset_class_from_filename(path: Path) -> str:
    stem = path.stem.strip().upper()
    if stem.startswith("FX_"):
        return "forex"
    if stem.startswith("BINANCE_"):
        return "crypto"
    if stem.startswith("NSE_"):
        return "index"
    return "unknown"


def _default_quantity(symbol: str, asset_class: str) -> float:
    upper = symbol.upper()
    if asset_class == "forex":
        return 10_000.0
    if asset_class == "crypto":
        if "BTC" in upper:
            return 0.05
        if "ETH" in upper:
            return 0.5
        return 1.0
    if upper == "BANKNIFTY":
        return 15.0
    if upper == "NIFTY":
        return 50.0
    return 1.0


def _date_from_time(value: int) -> str:
    return datetime.fromtimestamp(int(value), tz=timezone.utc).date().isoformat()


def _format_number(value: float) -> str:
    return f"{float(value):.8f}".rstrip("0").rstrip(".")


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate simulated Bullcast journal CSV from OHLC candles using Streak Pullback Confirmation."
    )
    parser.add_argument("inputs", nargs="+", help="Input OHLC CSV files.")
    parser.add_argument("--output", required=True, help="Output generated journal CSV path.")
    parser.add_argument("--summary-output", help="Optional generation summary JSON path.")
    parser.add_argument("--statistics-output", help="Optional generation statistics JSON path.")
    parser.add_argument("--quantity", type=float, default=None, help="Override simulated quantity per trade.")
    parser.add_argument("--rr-target", type=float, default=2.0, help="Configured R multiple target, for example 1.5 or 2.")
    parser.add_argument("--max-hold-candles", type=int, default=36, help="Maximum future candles to hold a trade.")
    args = parser.parse_args()

    summary = convert_pattern_alert_files(
        args.inputs,
        args.output,
        quantity=args.quantity,
        rr_target=args.rr_target,
        max_hold_candles=args.max_hold_candles,
        summary_path=args.summary_output,
        statistics_path=args.statistics_output,
    )
    print(
        f"Detected {summary.total_setups_found} setups. "
        f"Generated {summary.output_rows} simulated trades. "
        f"Skipped {summary.invalid_setups} invalid patterns. "
        f"Output: {summary.output_path}. Summary: {summary.summary_path}. Statistics: {summary.statistics_path}"
    )


if __name__ == "__main__":
    main()
