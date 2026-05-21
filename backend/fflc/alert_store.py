from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


IST = ZoneInfo("Asia/Kolkata")
ALERTS_FILE = Path(__file__).resolve().parent.parent / "data" / "alerts_log.json"


def _read_existing_alerts() -> list[dict]:
    if not ALERTS_FILE.exists():
        return []

    try:
        data = json.loads(ALERTS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []

    if not isinstance(data, list):
        return []

    return [item for item in data if isinstance(item, dict)]


def save_alerts(patterns: list[dict], pair: str, date: str) -> None:
    alerts = _read_existing_alerts()
    saved_at = datetime.now(IST).isoformat()

    for pattern in patterns:
        alerts.append(
            {
                "saved_at": saved_at,
                "pair": pair,
                "date": date,
                "alert_time": pattern["alert_timestamp"],
                "direction": pattern["direction"],
                "target": pattern["target"],
                "result": pattern["result"],
            }
        )

    ALERTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    ALERTS_FILE.write_text(json.dumps(alerts, indent=2), encoding="utf-8")


def load_alerts() -> list[dict]:
    return list(reversed(_read_existing_alerts()))
