"""
csv_loader.py
-------------
Loads M5 candle data from local CSV files for historical backtesting.
CSV files live at: backend/data/forex/FX_<PAIR>.csv
Columns: time, open, high, low, close, "Pattern Alert", Volume
"""
from __future__ import annotations

import csv
import os
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")
SESSION_START = time(0, 0)
SESSION_END = time(23, 59, 59)
TARGET_DAY_START = time(0, 0)
TARGET_DAY_END = time(23, 59, 59)
DETECTION_LOOKBACK_DAYS = 1

# Resolve the data directory relative to this file's location
_HERE = Path(__file__).resolve().parent
_DATA_DIR = _HERE.parent / "data" / "forex"


def _csv_path(pair: str) -> Path:
    """Return the path to the CSV file for a given pair (e.g. 'EURUSD')."""
    clean_pair = pair.upper()
    canonical = _DATA_DIR / f"FX_{clean_pair}.csv"
    if canonical.exists():
        return canonical

    matches = sorted(_DATA_DIR.glob(f"FX_{clean_pair}*.csv"))
    return matches[0] if matches else canonical


def has_csv_data(pair: str) -> bool:
    """Return True if a CSV file exists for the given pair."""
    return _csv_path(pair).exists()


def _get(row: dict, *keys: str):
    for key in keys:
        for row_key, value in row.items():
            if str(row_key or "").strip().lower() == key.lower():
                return value
    return None


def _alert_value(row: dict) -> float:
    try:
        return float(_get(row, "pattern alert", "pattern_alert") or 0)
    except (TypeError, ValueError):
        return 0.0


def load_candles_for_date(pair: str, target_date: date) -> list[dict]:
    """
    Load M5 candles for *pair* from 00:00 IST of the previous day through
    the end of *target_date* so cross-midnight patterns can be detected
    before target-day filtering is applied.

    Returns a list of dicts with keys: time, open, high, low, close
    sorted ascending by time.  Returns an empty list if no CSV or no
    candles match.
    """
    csv_file = _csv_path(pair)
    if not csv_file.exists():
        return []

    session_start = datetime.combine(
        target_date - timedelta(days=DETECTION_LOOKBACK_DAYS),
        TARGET_DAY_START,
        tzinfo=IST,
    )
    session_end = datetime.combine(target_date, TARGET_DAY_END, tzinfo=IST)
    start_ts = int(session_start.timestamp())
    end_ts = int(session_end.timestamp())

    candles: list[dict] = []
    with open(csv_file, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            try:
                ts = int(float(_get(row, "time", "timestamp")))
            except (TypeError, ValueError):
                continue

            if start_ts <= ts <= end_ts:
                try:
                    candles.append(
                        {
                            "time": ts,
                            "open": float(_get(row, "open")),
                            "high": float(_get(row, "high")),
                            "low": float(_get(row, "low")),
                            "close": float(_get(row, "close")),
                            "pattern_alert": _alert_value(row),
                        }
                    )
                except (TypeError, ValueError):
                    continue

    candles.sort(key=lambda c: c["time"])
    return candles


def get_csv_date_range(pair: str) -> tuple[date | None, date | None]:
    """
    Return the (earliest_date, latest_date) available in the CSV for *pair*.
    Returns (None, None) if no CSV exists or the file is empty.
    """
    csv_file = _csv_path(pair)
    if not csv_file.exists():
        return None, None

    first_ts: int | None = None
    last_ts: int | None = None

    with open(csv_file, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            try:
                ts = int(float(_get(row, "time", "timestamp")))
                if first_ts is None:
                    first_ts = ts
                last_ts = ts
            except (TypeError, ValueError):
                continue

    if first_ts is None:
        return None, None

    start_date = datetime.fromtimestamp(first_ts, tz=IST).date()
    end_date = datetime.fromtimestamp(last_ts, tz=IST).date()
    return start_date, end_date
