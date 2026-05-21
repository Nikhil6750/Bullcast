from __future__ import annotations

from backend.fflc.candles import normalize_pair
from backend.fflc.target import EPSILON, calculate_target


def _open(candle: dict) -> float:
    return float(candle["open"])


def _close(candle: dict) -> float:
    return float(candle["close"])


def _color(candle: dict) -> int:
    close = _close(candle)
    open_ = _open(candle)
    if close > open_ + EPSILON:
        return 1
    if close < open_ - EPSILON:
        return -1
    return 0


def _is_alert(candle: dict) -> bool:
    value = candle.get("pattern_alert", candle.get("Pattern Alert", 0))
    try:
        return float(value) == 1
    except (TypeError, ValueError):
        return str(value).strip().lower() in {"1", "true", "yes", "y"}


def _valid_pullback_boundary(c1: dict, pullback: dict, direction: str) -> bool:
    if direction == "DOWN":
        return _close(pullback) <= _open(c1) + EPSILON
    return _close(pullback) >= _open(c1) - EPSILON


def _candidate_from_end(candles: list[dict], pattern_end_index: int, pullback_count: int) -> tuple[int, str, list[dict]] | None:
    start = pattern_end_index - (3 + pullback_count) + 1
    if start < 0:
        return None

    c1, c2, c3 = candles[start], candles[start + 1], candles[start + 2]
    pullbacks = candles[start + 3:pattern_end_index + 1]
    streak_colors = [_color(c1), _color(c2), _color(c3)]

    if streak_colors == [-1, -1, -1]:
        direction = "DOWN"
        pullback_color = 1
    elif streak_colors == [1, 1, 1]:
        direction = "UP"
        pullback_color = -1
    else:
        return None

    if not pullbacks or any(_color(candle) != pullback_color for candle in pullbacks):
        return None
    if any(not _valid_pullback_boundary(c1, candle, direction) for candle in pullbacks):
        return None

    return start, direction, pullbacks


def build_patterns_from_csv_alerts(
    candles: list[dict],
    pair: str,
    alert_start_ts: int | None = None,
    alert_end_ts: int | None = None,
) -> list[dict]:
    clean_pair = normalize_pair(pair)
    patterns: list[dict] = []

    for alert_index, alert_candle in enumerate(candles):
        if not _is_alert(alert_candle):
            continue
        alert_timestamp = int(alert_candle["time"])
        if alert_start_ts is not None and alert_timestamp < int(alert_start_ts):
            continue
        if alert_end_ts is not None and alert_timestamp > int(alert_end_ts):
            continue

        candidate = None
        for pattern_end_index in (alert_index, alert_index - 1):
            for pullback_count in (2, 1):
                candidate = _candidate_from_end(candles, pattern_end_index, pullback_count)
                if candidate is not None:
                    break
            if candidate is not None:
                break
        if candidate is None:
            continue

        start, direction, pullbacks = candidate
        c1, c2, c3 = candles[start], candles[start + 1], candles[start + 2]
        target_data = calculate_target(c1, c2, c3, pullbacks, direction)

        patterns.append({
            "id": f"{clean_pair}-{alert_timestamp}-{direction}-csv-alert-{start}",
            "pair": clean_pair,
            "direction": direction,
            "c1": c1,
            "c2": c2,
            "c3": c3,
            "pullback_candles": pullbacks,
            "alert_candle_index": alert_index,
            "alert_timestamp": alert_timestamp,
            "pullback_type": target_data["pullback_type"],
            "target": target_data["target"],
            "zone_upper": target_data["zone_upper"],
            "zone_lower": target_data["zone_lower"],
            "target_method": target_data["target_method"],
            "news_event_count": 0,
            "win_count": 0,
            "result": "pending",
            "reason": "Not evaluated",
            "source": "csv_alert",
        })

    return patterns
