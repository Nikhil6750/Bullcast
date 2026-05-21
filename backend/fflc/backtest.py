from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from backend.fflc.candles import fetch_candles, normalize_pair
from backend.fflc.detector import detect_patterns
from backend.fflc.evaluator import evaluate_trade


IST = ZoneInfo("Asia/Kolkata")
SESSION_START = time(0, 0)
SESSION_END = time(23, 59, 59)
TARGET_DAY_START = time(0, 0)
TARGET_DAY_END = time(23, 59, 59)
DETECTION_LOOKBACK_DAYS = 1
SUPPORTED_PAIRS = [
    "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD",
    "AUDUSD", "EURJPY", "GBPJPY", "CHFJPY", "CADJPY",
    "AUDJPY", "EURAUD", "GBPAUD", "EURGBP", "EURCAD",
    "GBPCAD", "GBPCHF", "EURCHF", "AUDCHF", "AUDCAD",
]
SUPPORTED_PAIR_SET = set(SUPPORTED_PAIRS)


def _parse_date(date_str):
    if date_str:
        return date.fromisoformat(str(date_str).strip())
    return datetime.now(tz=IST).date()


def _session_bounds(target_date):
    return (
        datetime.combine(target_date, SESSION_START, tzinfo=IST),
        datetime.combine(target_date, SESSION_END, tzinfo=IST),
    )


def _target_day_bounds(target_date):
    return (
        datetime.combine(target_date, TARGET_DAY_START, tzinfo=IST),
        datetime.combine(target_date, TARGET_DAY_END, tzinfo=IST),
    )


def _candle_datetime(candle):
    return datetime.fromtimestamp(int(candle["time"]), tz=IST)


def _filter_session_candles(candles, target_date):
    target_start, target_end = _target_day_bounds(target_date)
    detection_start = target_start - timedelta(days=DETECTION_LOOKBACK_DAYS)
    return [
        c for c in candles
        if detection_start <= _candle_datetime(c) <= target_end
    ]


def _filter_patterns_by_alert_window(patterns, start_ts, end_ts):
    return [
        p for p in patterns
        if start_ts <= int(p["alert_timestamp"]) <= end_ts
    ]


def _empty_result(pair, target_date, candles_count=0, skipped=False, source="live", candles=None):
    return {
        "pair": pair,
        "date": target_date.isoformat(),
        "total_setups": 0,
        "wins": 0,
        "losses": 0,
        "setup_not_formed": 0,
        "pending": 0,
        "win_rate": 0.0,
        "patterns": [],
        "candles_count": candles_count,
        "candles": candles or [],
        "skipped": skipped,
        "data_source": source,
    }


def _get_session_candles(pair, target_date, limit=2000):
    """Return (session_candles, data_source).

    Uses ForexFactory API data for saved-data/live backtests. CSV data is
    only used by the explicit upload endpoint.
    """
    candles = fetch_candles(pair, limit=limit)
    session_candles = _filter_session_candles(candles, target_date)
    return session_candles, "live"


def run_backtest(pair, date_str=None, use_csv_alerts=False, fetch_limit=2000):
    clean_pair = normalize_pair(pair)
    if clean_pair not in SUPPORTED_PAIR_SET:
        raise ValueError(f"Unsupported pair: {clean_pair}")

    target_date = _parse_date(date_str)

    if target_date.weekday() == 6:
        return _empty_result(clean_pair, target_date, skipped=True)

    session_candles, data_source = _get_session_candles(clean_pair, target_date, limit=fetch_limit)

    if len(session_candles) < 4:
        return _empty_result(
            clean_pair, target_date,
            candles_count=len(session_candles),
            source=data_source,
            candles=session_candles,
        )

    target_start, target_end = _target_day_bounds(target_date)
    _, session_end = _session_bounds(target_date)
    session_end_ts = int(session_end.timestamp())
    target_start_ts = int(target_start.timestamp())
    target_end_ts = int(target_end.timestamp())
    patterns = _filter_patterns_by_alert_window(
        detect_patterns(session_candles, clean_pair),
        target_start_ts,
        target_end_ts,
    )

    for p in patterns:
        stop_reference = p["c1"]["open"]
        ev = evaluate_trade(
            session_candles,
            p["direction"],
            p["target"],
            p["alert_candle_index"],
            session_end_ts,
            zone_lower=p["zone_lower"],
            zone_upper=p["zone_upper"],
            c1_open=stop_reference,
        )
        p["result"] = ev["result"]
        p["reason"] = ev["reason"]
        p["win_count"] = 1 if ev["result"] == "win" else 0

    wins = sum(1 for p in patterns if p["result"] == "win")
    losses = sum(1 for p in patterns if p["result"] == "loss")
    setup_not_formed = sum(1 for p in patterns if p["result"] == "setup_not_formed")
    pending = sum(1 for p in patterns if p["result"] == "pending")
    closed = wins + losses
    win_rate = round((wins / closed) * 100, 2) if closed else 0.0

    return {
        "pair": clean_pair,
        "date": target_date.isoformat(),
        "total_setups": len(patterns),
        "wins": wins,
        "losses": losses,
        "setup_not_formed": setup_not_formed,
        "pending": pending,
        "win_rate": win_rate,
        "patterns": patterns,
        "candles_count": len(session_candles),
        "candles": session_candles,
        "skipped": False,
        "data_source": data_source,
    }


def get_latest_pattern(pair, date_str=None):
    clean_pair = normalize_pair(pair)
    if clean_pair not in SUPPORTED_PAIR_SET:
        raise ValueError(f"Unsupported pair: {clean_pair}")

    target_date = _parse_date(date_str)
    session_candles, _ = _get_session_candles(clean_pair, target_date, limit=100)
    if len(session_candles) < 4:
        return None

    target_start, target_end = _target_day_bounds(target_date)
    target_start_ts = int(target_start.timestamp())
    target_end_ts = int(target_end.timestamp())
    patterns = _filter_patterns_by_alert_window(
        detect_patterns(session_candles, clean_pair),
        target_start_ts,
        target_end_ts,
    )
    if not patterns:
        return None

    latest = max(patterns, key=lambda pattern: int(pattern["alert_timestamp"]))
    latest["result"] = "pending"
    latest["reason"] = latest.get("reason") or "Latest live alert"
    latest["win_count"] = 0
    return latest
