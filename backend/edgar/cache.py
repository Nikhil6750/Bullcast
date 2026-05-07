from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = ROOT / "data" / "edgar_cache"


def ensure_cache_dir() -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return CACHE_DIR


def cache_path(name: str) -> Path:
    safe_name = _safe_cache_name(name)
    return ensure_cache_dir() / f"{safe_name}.json"


def read_json_cache(name: str, max_age_hours: int | None = None) -> dict[str, Any] | None:
    path = cache_path(name)
    if not path.exists() or not path.is_file():
        return None

    if max_age_hours is not None:
        modified = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
        if datetime.now(timezone.utc) - modified > timedelta(hours=max_age_hours):
            return None

    try:
        with path.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None

    return data if isinstance(data, dict) else None


def write_json_cache(name: str, data: dict[str, Any]) -> None:
    path = cache_path(name)
    tmp_path = path.with_suffix(".tmp")
    try:
        with tmp_path.open("w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
        tmp_path.replace(path)
    except OSError:
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except OSError:
            pass


def _safe_cache_name(name: str) -> str:
    text = str(name or "").strip().lower()
    text = re.sub(r"[^a-z0-9_.-]+", "_", text)
    text = text.strip("._-")
    return text[:160] or "cache"
