from __future__ import annotations

import json
import logging
import os
from collections import Counter
from datetime import datetime
from typing import Any

import requests

from backend.intelligence.trade_entry_parser import GEMINI_MODEL, _extract_response_text, _loads_json_object

try:
    from google import genai

    GEMINI_SDK_AVAILABLE = True
except ImportError:
    genai = None
    GEMINI_SDK_AVAILABLE = False

logger = logging.getLogger(__name__)

DISCLAIMER = "This is journal behavior analysis only. Not financial advice."
SYSTEM_INSTRUCTION = (
    "You are a trading journal coach. Your role is to analyze a trader's historical "
    "journal data and identify behavioral patterns, risk discipline, and journaling "
    "quality. You must not give buy/sell recommendations, entry/exit signals, price "
    "targets, or financial advice of any kind. You must not invent or assume trade "
    "data not explicitly present in the journal. All suggestions must be behavioral, "
    "not directional. If data is insufficient for a conclusion, say so explicitly."
)
SELECT_FIELDS = (
    "id, symbol, side, entry, exit, quantity, setup_tag, mistake_tag, "
    "confidence_score, notes, planned_risk, planned_reward, data_origin, created_at"
)
ALLOWED_CATEGORIES = {
    "setup_performance",
    "risk_discipline",
    "mistake_patterns",
    "confidence_calibration",
    "journaling_quality",
}
UNSAFE_PATTERNS = [
    "buy now",
    "sell now",
    "go long",
    "go short",
    "enter at",
    "exit at",
    "price target",
    "target price",
    "you should buy",
    "you should sell",
]


def fetch_user_trades(user_id: str, limit: int = 100) -> list[dict[str, Any]]:
    clean_user_id = str(user_id or "").strip()
    if not clean_user_id:
        return []

    supabase_url = _supabase_url()
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not supabase_url or not service_key:
        raise RuntimeError("Backend Supabase service configuration is unavailable.")

    response = requests.get(
        f"{supabase_url}/rest/v1/journal_trades",
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
        },
        params={
            "select": SELECT_FIELDS,
            "user_id": f"eq.{clean_user_id}",
            "order": "created_at.desc",
            "limit": str(max(1, min(int(limit or 100), 500))),
        },
        timeout=15,
    )
    response.raise_for_status()
    rows = response.json()
    return rows if isinstance(rows, list) else []


def validate_supabase_jwt(access_token: str) -> str | None:
    token = str(access_token or "").strip()
    if not token:
        return None
    supabase_url = _supabase_url()
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not supabase_url or not service_key:
        logger.warning("Supabase auth validation unavailable because backend env is incomplete")
        return None

    response = requests.get(
        f"{supabase_url.rstrip('/')}/auth/v1/user",
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {token}",
        },
        timeout=10,
    )
    if response.status_code != 200:
        return None
    payload = response.json()
    user_id = payload.get("id")
    return str(user_id) if user_id else None


def build_analysis_prompt(trades: list[dict[str, Any]]) -> str:
    safe_trades = [dict(trade) for trade in trades if isinstance(trade, dict)]
    data_range = _data_range(safe_trades)
    summary = _structured_summary(safe_trades)
    schema = {
        "insights": [
            {
                "category": "setup_performance | risk_discipline | mistake_patterns | confidence_calibration | journaling_quality",
                "observation": "...",
                "evidence": "cite specific numbers or patterns from the data",
                "suggestion": "behavioral suggestion only, no trade signals",
            }
        ],
        "summary": "2-3 sentence overall assessment",
        "disclaimer": DISCLAIMER,
        "trades_analyzed": len(safe_trades),
        "data_range": data_range,
    }
    return (
        f"{SYSTEM_INSTRUCTION}\n\n"
        "Data section:\n"
        f"Total trades count: {len(safe_trades)}\n"
        f"Date range: {data_range or 'null'}\n"
        f"Structured summary: {json.dumps(summary, ensure_ascii=True, default=str)}\n\n"
        "Return valid JSON only. Return a JSON object with this exact shape:\n"
        f"{json.dumps(schema, ensure_ascii=True)}"
    )


def filter_unsafe_insights(insights: list[dict[str, Any]]) -> list[dict[str, Any]]:
    filtered: list[dict[str, Any]] = []
    for insight in insights if isinstance(insights, list) else []:
        if not isinstance(insight, dict):
            continue
        text = " ".join(
            str(insight.get(field, ""))
            for field in ("observation", "evidence", "suggestion")
        ).lower()
        if any(pattern in text for pattern in UNSAFE_PATTERNS):
            logger.warning("Removed unsafe journal copilot insight: %s", insight)
            continue
        filtered.append(insight)
    return filtered


def analyze_journal(user_id: str) -> dict[str, Any]:
    try:
        trades = fetch_user_trades(user_id)
    except Exception:
        logger.warning("Journal Copilot could not fetch user trades")
        trades = []

    if not trades:
        return {
            "insights": [],
            "summary": "No journal trades found. Start logging trades to receive analysis.",
            "disclaimer": DISCLAIMER,
            "trades_analyzed": 0,
            "data_range": None,
            "llm_enabled": False,
        }

    try:
        payload = _call_gemini(build_analysis_prompt(trades))
        result = _sanitize_response(payload, trades)
        if len(trades) < 5:
            result["summary"] = f"Limited data: fewer than 5 trades were available. {result['summary']}"
        result["llm_enabled"] = True
        return result
    except Exception:
        logger.warning("Journal Copilot Gemini analysis failed")
        return {
            "insights": [],
            "summary": "Analysis unavailable — Gemini could not be reached. Try again shortly.",
            "disclaimer": DISCLAIMER,
            "trades_analyzed": 0,
            "data_range": None,
            "llm_enabled": False,
        }


def _call_gemini(prompt: str) -> dict[str, Any]:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not configured.")
    if not GEMINI_SDK_AVAILABLE or genai is None:
        raise RuntimeError("google-genai is not installed.")

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(model=GEMINI_MODEL, contents=prompt)
    response_text = _extract_response_text(response)
    if not response_text:
        raise ValueError("Gemini returned an empty response.")
    payload = _loads_json_object(response_text)
    if not isinstance(payload, dict):
        raise ValueError("Gemini response must be a JSON object.")
    return payload


def _sanitize_response(payload: dict[str, Any], trades: list[dict[str, Any]]) -> dict[str, Any]:
    raw_insights = payload.get("insights") if isinstance(payload.get("insights"), list) else []
    insights: list[dict[str, str]] = []
    for insight in raw_insights:
        if not isinstance(insight, dict):
            continue
        category = str(insight.get("category") or "").strip()
        if category not in ALLOWED_CATEGORIES:
            continue
        insights.append({
            "category": category,
            "observation": str(insight.get("observation") or "").strip(),
            "evidence": str(insight.get("evidence") or "").strip(),
            "suggestion": str(insight.get("suggestion") or "").strip(),
        })

    filtered = filter_unsafe_insights(insights)
    return {
        "insights": filtered,
        "summary": str(payload.get("summary") or "Journal behavior analysis completed.").strip(),
        "disclaimer": str(payload.get("disclaimer") or DISCLAIMER).strip(),
        "trades_analyzed": len(trades),
        "data_range": _data_range(trades),
    }


def _structured_summary(trades: list[dict[str, Any]]) -> dict[str, Any]:
    symbols = Counter(str(trade.get("symbol") or "UNKNOWN").upper() for trade in trades)
    sides = Counter(str(trade.get("side") or "UNKNOWN").upper() for trade in trades)
    setups = Counter(str(trade.get("setup_tag") or "none") for trade in trades)
    mistakes = Counter(str(trade.get("mistake_tag") or "none") for trade in trades)
    confidence_scores = [
        trade.get("confidence_score")
        for trade in trades
        if trade.get("confidence_score") not in (None, "")
    ]
    notes = [
        {
            "symbol": trade.get("symbol"),
            "created_at": trade.get("created_at"),
            "notes": _truncate_notes(trade.get("notes")),
        }
        for trade in trades
        if str(trade.get("notes") or "").strip()
    ][:20]
    return {
        "symbols_traded": dict(symbols.most_common(20)),
        "sides": dict(sides),
        "setups_used": dict(setups.most_common(20)),
        "mistakes_logged": dict(mistakes.most_common(20)),
        "confidence_scores": confidence_scores[:50],
        "notes_excerpts": notes,
    }


def _data_range(trades: list[dict[str, Any]]) -> str | None:
    values = sorted(
        value for value in (_parse_datetime(trade.get("created_at")) for trade in trades)
        if value is not None
    )
    if not values:
        return None
    return f"{values[0].date().isoformat()} to {values[-1].date().isoformat()}"


def _parse_datetime(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _truncate_notes(value: Any) -> str:
    text = str(value or "").strip()
    if len(text) <= 200:
        return text
    return f"{text[:200]}..."


def _supabase_url() -> str:
    return os.getenv("SUPABASE_URL", "").strip().rstrip("/")
