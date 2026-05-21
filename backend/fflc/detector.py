from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import requests

from backend.fflc.candles import normalize_pair
from backend.fflc.target import EPSILON, calculate_target


logger = logging.getLogger(__name__)
IST = ZoneInfo("Asia/Kolkata")


def _open(candle: dict) -> float:
    return float(candle["open"])


def _close(candle: dict) -> float:
    return float(candle["close"])


def _high(candle: dict) -> float:
    return float(candle["high"])


def _low(candle: dict) -> float:
    return float(candle["low"])


def _color(candle: dict) -> int:
    close = _close(candle)
    open_ = _open(candle)
    if close > open_ + EPSILON:
        return 1
    if close < open_ - EPSILON:
        return -1
    return 0


def _supabase_url() -> str:
    return (
        os.getenv("SUPABASE_URL", "")
        or os.getenv("VITE_SUPABASE_URL", "")
        or os.getenv("REACT_APP_SUPABASE_URL", "")
    ).strip().rstrip("/")


def _impact_value(value) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value or "").strip().lower()
    if not text:
        return 0.0
    try:
        return float(text)
    except ValueError:
        return {"low": 1.0, "medium": 2.0, "med": 2.0, "high": 3.0}.get(text, 0.0)


def _parse_event_datetime(value) -> datetime | None:
    if value is None:
        return None

    if isinstance(value, (int, float)):
        ts = float(value)
        if ts > 10_000_000_000:
            ts = ts / 1000
        return datetime.fromtimestamp(ts, tz=IST)

    text = str(value).strip()
    if not text:
        return None

    try:
        ts = float(text)
        if ts > 10_000_000_000:
            ts = ts / 1000
        return datetime.fromtimestamp(ts, tz=IST)
    except ValueError:
        pass

    normalized = text.replace("Z", "+00:00")
    for parser in (
        lambda candidate: datetime.fromisoformat(candidate),
        lambda candidate: datetime.strptime(candidate, "%Y-%m-%d %H:%M:%S"),
        lambda candidate: datetime.strptime(candidate, "%Y-%m-%d %H:%M"),
        lambda candidate: datetime.strptime(candidate, "%d-%m-%Y %H:%M"),
        lambda candidate: datetime.strptime(candidate, "%d/%m/%Y %H:%M"),
    ):
        try:
            parsed = parser(normalized)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=IST)
            return parsed.astimezone(IST)
        except ValueError:
            continue
    return None


def _event_datetime(event: dict) -> datetime | None:
    for key in (
        "timestamp",
        "time",
        "event_time",
        "event_timestamp",
        "scheduled_at",
        "scheduled_time",
        "date_time",
        "datetime",
        "starts_at",
        "event_datetime",
    ):
        parsed = _parse_event_datetime(event.get(key))
        if parsed:
            return parsed

    event_date = event.get("date") or event.get("event_date")
    event_time = event.get("time") or event.get("hour")
    if event_date and event_time:
        return _parse_event_datetime(f"{event_date} {event_time}")
    return None


def _fetch_news_events() -> list[dict]:
    supabase_url = _supabase_url()
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not supabase_url or not service_key:
        return []

    try:
        response = requests.get(
            f"{supabase_url}/rest/v1/economic_events",
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
            },
            params={
                "select": "*",
                "impact": "gte.2",
                "limit": "500",
            },
            timeout=8,
        )
        response.raise_for_status()
        rows = response.json()
        return rows if isinstance(rows, list) else []
    except Exception:
        logger.info("FFLC news intercept unavailable; using standard target calculation.")
        return []


def _events_in_next_10_minutes(events: list[dict], alert_timestamp: int) -> list[dict]:
    alert_dt = datetime.fromtimestamp(int(alert_timestamp), tz=IST)
    window_end = alert_dt + timedelta(minutes=10)
    matches = []
    for event in events:
        if not isinstance(event, dict) or _impact_value(event.get("impact")) < 2:
            continue
        event_dt = _event_datetime(event)
        if event_dt and alert_dt <= event_dt <= window_end:
            matches.append(event)
    return matches


def _is_green(candle: dict) -> bool:
    # Match PHP: `$isGreen = $candle['close'] > $candle['open']`; doji is bearish.
    return _close(candle) > _open(candle)


def _pullback_crosses_boundary(candle: dict, streak_bullish: bool, streak_open: float) -> bool:
    if streak_bullish:
        return _low(candle) <= streak_open + EPSILON
    return _high(candle) >= streak_open - EPSILON


def _build_pattern_from_state(
    candles: list[dict],
    pair: str,
    streak_indices: list[int],
    pullback_indices: list[int],
    alert_index: int,
    streak_bullish: bool,
    news_events: list[dict],
) -> dict | None:
    if len(streak_indices) < 3 or not pullback_indices:
        return None

    c1_index, c2_index, c3_index = streak_indices[-3:]
    c1, c2, c3 = candles[c1_index], candles[c2_index], candles[c3_index]
    pullbacks = [candles[index] for index in pullback_indices]
    direction = "UP" if streak_bullish else "DOWN"
    alert_timestamp = int(candles[alert_index]["time"])
    nearby_news = _events_in_next_10_minutes(news_events, alert_timestamp)
    target_data = calculate_target(c1, c2, c3, pullbacks, direction, news_events=nearby_news)
    clean_pair = normalize_pair(pair)

    return {
        "id": f"{clean_pair}-{alert_timestamp}-{direction}-{c1_index}",
        "pair": clean_pair,
        "direction": direction,
        "c1": c1,
        "c2": c2,
        "c3": c3,
        "pullback_candles": pullbacks,
        "alert_candle": candles[alert_index],
        "alert_candle_index": alert_index,
        "alert_timestamp": alert_timestamp,
        "pullback_type": target_data["pullback_type"],
        "target": target_data["target"],
        "zone_upper": target_data["zone_upper"],
        "zone_lower": target_data["zone_lower"],
        "target_method": target_data["target_method"],
        "news_event_count": len(nearby_news),
        "win_count": 0,
        "result": "pending",
        "reason": "Not evaluated",
    }


def detect_patterns(candles: list[dict], pair: str) -> list[dict]:
    if len(candles) < 6:
        return []

    clean_pair = normalize_pair(pair)
    patterns: list[dict] = []
    news_events = _fetch_news_events()

    streak_count = 0
    streak_bullish = False
    streak_open = 0.0
    streak_indices: list[int] = []
    waiting_for_confirmation = False
    opposite_count = 0
    pullback_indices: list[int] = []

    def reset_from(index: int, is_green: bool) -> None:
        nonlocal streak_count, streak_bullish, streak_open, streak_indices
        nonlocal waiting_for_confirmation, opposite_count, pullback_indices
        streak_count = 1
        streak_bullish = is_green
        streak_open = _open(candles[index])
        streak_indices = [index]
        waiting_for_confirmation = False
        opposite_count = 0
        pullback_indices = []

    for i, candle in enumerate(candles):
        is_green = _is_green(candle)

        if not waiting_for_confirmation:
            if streak_count == 0:
                reset_from(i, is_green)
            elif is_green == streak_bullish:
                streak_count += 1
                streak_open = _open(candle)
                streak_indices.append(i)
            elif streak_count >= 4:
                waiting_for_confirmation = True
                opposite_count = 1
                pullback_indices = [i]
                if _pullback_crosses_boundary(candle, streak_bullish, streak_open):
                    reset_from(i, is_green)
            else:
                reset_from(i, is_green)
            continue

        if is_green != streak_bullish:
            opposite_count += 1
            pullback_indices.append(i)
            if opposite_count > 2:
                reset_from(i, is_green)
                continue
            continue

        if opposite_count == 2 and _pullback_crosses_boundary(candle, streak_bullish, streak_open):
            reset_from(i, is_green)
            continue

        pattern = _build_pattern_from_state(
            candles,
            clean_pair,
            streak_indices,
            pullback_indices,
            i,
            streak_bullish,
            news_events,
        )
        if pattern:
            patterns.append(pattern)
        reset_from(i, is_green)

    return patterns
