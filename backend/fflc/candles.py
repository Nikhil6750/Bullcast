from __future__ import annotations

import random
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

import requests


MDS_BARS_URL = "https://mds-api.forexfactory.com/bars"
DEFAULT_TIMEOUT_SECONDS = 15
REQUEST_HEADERS = {
    "Accept": "application/json,text/plain,*/*",
    "Origin": "https://www.forexfactory.com",
    "Referer": "https://www.forexfactory.com/",
    "User-Agent": "Mozilla/5.0 Bullcast/1.0",
}


class CandleFetchError(RuntimeError):
    pass


def normalize_pair(pair: str) -> str:
    raw = str(pair or "").strip().upper().replace("=X", "")
    compact = raw.replace("/", "")
    if len(compact) != 6 or not compact.isalpha():
        raise ValueError("Pair must be a 6-letter forex symbol such as EURUSD.")
    return compact


def pair_for_mds(pair: str) -> str:
    compact = normalize_pair(pair)
    return f"{compact[:3]}/{compact[3:]}"


def _parse_timestamp(value: Any) -> int:
    if value is None:
        raise ValueError("Missing candle timestamp")

    if isinstance(value, (int, float)):
        ts = float(value)
        if ts > 10_000_000_000:
            ts = ts / 1000
        return int(ts)

    text = str(value).strip()
    if not text:
        raise ValueError("Missing candle timestamp")

    try:
        ts = float(text)
        if ts > 10_000_000_000:
            ts = ts / 1000
        return int(ts)
    except ValueError:
        pass

    normalized = text.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp())


def _normalize_candle(row: dict[str, Any]) -> dict[str, float | int]:
    return {
        "time": _parse_timestamp(row.get("timestamp", row.get("time"))),
        "open": float(row["open"]),
        "high": float(row["high"]),
        "low": float(row["low"]),
        "close": float(row["close"]),
    }


def fetch_candles(pair: str, limit: int = 2000) -> list[dict]:
    clean_pair = pair_for_mds(pair)
    safe_pair = quote(clean_pair, safe="")
    per_page = max(1, min(int(limit or 2000), 2000))
    bust = f"{int(time.time())}{random.randint(1000, 9999)}"
    url = (
        f"{MDS_BARS_URL}?to=0&interval=M5&instrument={safe_pair}"
        f"&per_page={per_page}&extra_fields=&_={bust}"
    )

    try:
        response = requests.get(url, headers=REQUEST_HEADERS, timeout=DEFAULT_TIMEOUT_SECONDS)
        response.raise_for_status()
        payload = response.json()
    except requests.RequestException as exc:
        raise CandleFetchError(f"ForexFactory candle request failed for {normalize_pair(pair)}.") from exc
    except ValueError as exc:
        raise CandleFetchError("ForexFactory returned an invalid candle payload.") from exc

    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        raise CandleFetchError("ForexFactory candle payload did not include a data list.")

    candles = [_normalize_candle(row) for row in data if isinstance(row, dict)]
    candles.sort(key=lambda candle: int(candle["time"]))
    return candles
