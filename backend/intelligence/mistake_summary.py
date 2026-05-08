from __future__ import annotations

import json
import logging
import os
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any

import requests

from backend.journal import normalize_journal_trade

logger = logging.getLogger(__name__)

GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_ENDPOINT = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
DISCLAIMER = (
    "Educational journal review only. This summary does not predict market direction, "
    "does not provide buy/sell advice, and does not claim or imply profitability."
)
FALLBACK_MISSING_KEY = "GEMINI_API_KEY is not configured."
FALLBACK_REASONS = {
    "missing_api_key": FALLBACK_MISSING_KEY,
    "gemini_timeout": "Gemini API request timed out.",
    "gemini_http_error": "Gemini API returned an error response.",
    "gemini_request_error": "Gemini API request failed.",
    "gemini_invalid_response": "Gemini API returned an unreadable response.",
    "gemini_empty_response": "Gemini API returned no summary text.",
    "gemini_safety_validation": "Gemini response failed safety validation.",
}

_NONE_TAGS = {"", "none", "n/a", "na", "no mistake", "unknown", "null"}
_UNSAFE_ADVICE_RE = re.compile(
    r"\b(should|must|recommend(?:ed)?|guaranteed?)\s+"
    r"(buy|sell|long|short|enter|exit)\b|\bmarket\s+will\b|\bguarantee[ds]?\b",
    re.IGNORECASE,
)


@dataclass
class GeminiSummaryFailure(Exception):
    category: str

    def __str__(self) -> str:
        return self.category


def build_mistake_summary(
    trades: list[dict[str, Any]],
    *,
    limit: int = 100,
    api_key: str | None = None,
) -> dict[str, Any]:
    normalized = _normalize_trades(trades, limit=limit)
    key = api_key if api_key is not None else os.getenv("GEMINI_API_KEY", "")
    gemini_configured = bool(key)

    if not key:
        return _local_fallback_summary(
            normalized,
            limit=limit,
            failure_category="missing_api_key",
            gemini_configured=gemini_configured,
        )

    try:
        summary = _gemini_summary(normalized, api_key=key, limit=limit)
    except GeminiSummaryFailure as exc:
        logger.warning(
            "Gemini mistake summary failed: category=%s model=%s configured=%s",
            exc.category,
            GEMINI_MODEL,
            gemini_configured,
        )
        return _local_fallback_summary(
            normalized,
            limit=limit,
            failure_category=exc.category,
            gemini_configured=gemini_configured,
        )
    except Exception:
        logger.warning(
            "Gemini mistake summary failed: category=gemini_request_error model=%s configured=%s",
            GEMINI_MODEL,
            gemini_configured,
        )
        return _local_fallback_summary(
            normalized,
            limit=limit,
            failure_category="gemini_request_error",
            gemini_configured=gemini_configured,
        )

    if _contains_unsafe_advice(summary):
        logger.warning(
            "Gemini mistake summary failed: category=gemini_safety_validation model=%s configured=%s",
            GEMINI_MODEL,
            gemini_configured,
        )
        return _local_fallback_summary(
            normalized,
            limit=limit,
            failure_category="gemini_safety_validation",
            gemini_configured=gemini_configured,
        )

    return {
        **summary,
        "method": "gemini",
        "model": GEMINI_MODEL,
        "gemini_model": GEMINI_MODEL,
        "gemini_configured": gemini_configured,
        "local_fallback": False,
        "fallback_reason": None,
        "failure_category": None,
        "trade_count": len(normalized),
        "limit": limit,
        "educational_disclaimer": DISCLAIMER,
    }


def _gemini_summary(
    trades: list[dict[str, Any]],
    *,
    api_key: str,
    limit: int,
) -> dict[str, Any]:
    prompt = _build_gemini_prompt(trades, limit=limit)
    try:
        response = requests.post(
            GEMINI_ENDPOINT,
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": api_key,
            },
            json={
                "system_instruction": {
                    "parts": [
                        {
                            "text": (
                                "You are a trading journal coach. You summarize behavior from supplied journal data only. "
                                "Never predict market direction. Never give buy/sell, entry, exit, or position advice. "
                                "Never claim profitability. Keep output educational and deterministic in tone."
                            )
                        }
                    ]
                },
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.2,
                    "maxOutputTokens": 2048,
                    "thinkingConfig": {"thinkingBudget": 0},
                    "responseMimeType": "application/json",
                    "responseJsonSchema": _gemini_response_schema(),
                },
            },
            timeout=20,
        )
        response.raise_for_status()
    except requests.Timeout as exc:
        raise GeminiSummaryFailure("gemini_timeout") from exc
    except requests.HTTPError as exc:
        raise GeminiSummaryFailure("gemini_http_error") from exc
    except requests.RequestException as exc:
        raise GeminiSummaryFailure("gemini_request_error") from exc

    try:
        payload = response.json()
    except ValueError as exc:
        raise GeminiSummaryFailure("gemini_invalid_response") from exc

    text = _extract_text(payload)
    try:
        parsed = _loads_json_object(text)
        return {
            **_coerce_summary(parsed),
            "gemini_response_format": "json_schema",
        }
    except ValueError:
        return {
            **_coerce_summary(_summary_from_gemini_text(text)),
            "gemini_response_format": "text_recovered",
        }


def _gemini_response_schema() -> dict[str, Any]:
    list_of_strings = {
        "type": "array",
        "items": {"type": "string"},
        "minItems": 1,
        "maxItems": 8,
    }
    return {
        "type": "object",
        "properties": {
            "summary": {
                "type": "string",
                "description": "A concise educational summary of repeated journal mistakes.",
            },
            "repeated_mistakes": list_of_strings,
            "behavioral_patterns": list_of_strings,
            "weak_setups": list_of_strings,
            "confidence_issues": list_of_strings,
            "improvement_checklist": list_of_strings,
        },
        "required": [
            "summary",
            "repeated_mistakes",
            "behavioral_patterns",
            "weak_setups",
            "confidence_issues",
            "improvement_checklist",
        ],
    }


def _build_gemini_prompt(trades: list[dict[str, Any]], *, limit: int) -> str:
    compact_trades = [_compact_trade(trade) for trade in trades]
    return (
        "Review these Bullcast journal trades and return one JSON object only.\n"
        "Required keys: summary, repeated_mistakes, behavioral_patterns, weak_setups, "
        "confidence_issues, improvement_checklist.\n"
        "Each list must contain short educational strings, not trade instructions.\n"
        "Mention confidence issues when confidence_score data exists or when it is missing.\n"
        "Include practical checklist items about journaling, setup validation, rule discipline, and risk review.\n"
        "Do not predict market direction. Do not give buy/sell advice. Do not claim profitability.\n"
        f"Analyze at most {limit} trades. Trades JSON:\n"
        f"{json.dumps(compact_trades, ensure_ascii=True)}"
    )


def _local_fallback_summary(
    trades: list[dict[str, Any]],
    *,
    limit: int,
    failure_category: str,
    gemini_configured: bool,
) -> dict[str, Any]:
    stats = _journal_stats(trades)
    trade_count = len(trades)
    reason = FALLBACK_REASONS.get(failure_category, FALLBACK_REASONS["gemini_request_error"])

    if trade_count == 0:
        summary = "Local fallback: no journal trades were provided, so no repeated mistake pattern can be confirmed yet."
        repeated = ["No repeated mistake tags found yet."]
        patterns = ["Add several completed journal trades before treating behavior patterns as meaningful."]
        weak_setups = ["No setup weakness can be identified without logged setup outcomes."]
        confidence = ["No confidence scores are available yet."]
    else:
        summary = (
            f"Local fallback: reviewed {trade_count} journal trade(s). "
            f"Win rate is {stats['win_rate']}%, loss rate is {stats['loss_rate']}%, "
            f"and the most frequent logged mistake is {stats['primary_mistake']}."
        )
        repeated = _repeated_mistake_lines(stats)
        patterns = _behavior_pattern_lines(stats)
        weak_setups = _weak_setup_lines(stats)
        confidence = _confidence_issue_lines(stats)

    return {
        "summary": summary,
        "repeated_mistakes": repeated,
        "behavioral_patterns": patterns,
        "weak_setups": weak_setups,
        "confidence_issues": confidence,
        "improvement_checklist": _improvement_checklist(stats),
        "educational_disclaimer": DISCLAIMER,
        "method": "local_fallback",
        "model": "local-deterministic",
        "gemini_model": GEMINI_MODEL,
        "gemini_configured": gemini_configured,
        "local_fallback": True,
        "fallback_reason": reason,
        "failure_category": failure_category,
        "trade_count": trade_count,
        "limit": limit,
    }


def _journal_stats(trades: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(trades)
    losses = [trade for trade in trades if _result(trade) == "LOSS"]
    wins = [trade for trade in trades if _result(trade) == "WIN"]
    mistake_counts = Counter(
        _clean_tag(trade.get("mistake_tag"))
        for trade in trades
        if not _is_none_tag(trade.get("mistake_tag"))
    )
    setup_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for trade in trades:
        setup = _clean_tag(trade.get("setup_tag"))
        if setup and not _is_none_tag(setup):
            setup_groups[setup].append(trade)

    setup_rows = []
    for setup, rows in setup_groups.items():
        setup_losses = [row for row in rows if _result(row) == "LOSS"]
        pnl_total = round(sum(_number(row.get("pnl")) for row in rows), 2)
        setup_rows.append(
            {
                "setup": setup,
                "trades": len(rows),
                "losses": len(setup_losses),
                "loss_rate": _pct(len(setup_losses), len(rows)),
                "total_pnl": pnl_total,
            }
        )
    setup_rows.sort(key=lambda row: (row["loss_rate"], row["losses"], -row["total_pnl"]), reverse=True)

    confidence_values = [
        int(trade["confidence_score"])
        for trade in trades
        if isinstance(trade.get("confidence_score"), int)
    ]
    high_confidence_losses = [
        trade
        for trade in losses
        if isinstance(trade.get("confidence_score"), int) and trade["confidence_score"] >= 4
    ]
    low_confidence_wins = [
        trade
        for trade in wins
        if isinstance(trade.get("confidence_score"), int) and trade["confidence_score"] <= 2
    ]
    rule_breaks = [trade for trade in trades if trade.get("rule_followed") is False]

    primary = mistake_counts.most_common(1)[0][0] if mistake_counts else "none logged"
    return {
        "total": total,
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": _pct(len(wins), total),
        "loss_rate": _pct(len(losses), total),
        "mistake_counts": mistake_counts,
        "primary_mistake": primary,
        "weak_setups": setup_rows,
        "confidence_values": confidence_values,
        "average_confidence": round(sum(confidence_values) / len(confidence_values), 2)
        if confidence_values
        else None,
        "confidence_coverage": _pct(len(confidence_values), total),
        "high_confidence_loss_count": len(high_confidence_losses),
        "low_confidence_win_count": len(low_confidence_wins),
        "rule_break_count": len(rule_breaks),
    }


def _repeated_mistake_lines(stats: dict[str, Any]) -> list[str]:
    counts: Counter = stats["mistake_counts"]
    if not counts:
        return ["No repeated mistake tags were logged in the analyzed trades."]
    return [
        f"{tag}: logged {count} time(s)."
        for tag, count in counts.most_common(5)
    ]


def _behavior_pattern_lines(stats: dict[str, Any]) -> list[str]:
    lines = [
        f"Loss rate is {stats['loss_rate']}% across {stats['total']} analyzed trade(s).",
    ]
    if stats["primary_mistake"] != "none logged":
        lines.append(f"Most repeated behavioral tag is {stats['primary_mistake']}.")
    if stats["rule_break_count"]:
        lines.append(f"Rule discipline issue: {stats['rule_break_count']} trade(s) were marked rule_followed=false.")
    if stats["total"] < 10:
        lines.append("Sample size is still small; treat patterns as review prompts, not conclusions.")
    return lines


def _weak_setup_lines(stats: dict[str, Any]) -> list[str]:
    rows = [
        row
        for row in stats["weak_setups"]
        if row["losses"] > 0 and (row["loss_rate"] >= 50 or row["total_pnl"] < 0)
    ][:5]
    if not rows:
        return ["No weak setup cluster is strong enough yet; keep tagging setup names consistently."]
    return [
        f"{row['setup']}: {row['losses']} loss(es) in {row['trades']} trade(s), {row['loss_rate']}% loss rate."
        for row in rows
    ]


def _confidence_issue_lines(stats: dict[str, Any]) -> list[str]:
    if not stats["confidence_values"]:
        return ["Confidence scores are missing; add 1-5 confidence tags before and after trade review."]

    lines = [
        f"Average confidence is {stats['average_confidence']} out of 5 with {stats['confidence_coverage']}% coverage.",
    ]
    if stats["high_confidence_loss_count"]:
        lines.append(
            f"{stats['high_confidence_loss_count']} loss(es) had confidence_score >= 4; review overconfidence and confirmation quality."
        )
    if stats["low_confidence_win_count"]:
        lines.append(
            f"{stats['low_confidence_win_count']} win(s) had confidence_score <= 2; review whether your confidence rubric is consistent."
        )
    return lines


def _improvement_checklist(stats: dict[str, Any]) -> list[str]:
    return [
        "Tag every completed trade with setup_tag, mistake_tag, confidence_score, and rule_followed.",
        "Before the next session, review the top repeated mistake and write one rule that would have prevented it.",
        "For weak setups, compare entry notes against your written setup criteria before increasing risk.",
        "After each loss, record whether the issue was setup quality, execution discipline, sizing, or exit management.",
        "Use this summary only as journal review and educational decision-support, not as market prediction or trade advice.",
    ]


def _normalize_trades(trades: list[dict[str, Any]], *, limit: int) -> list[dict[str, Any]]:
    safe_limit = max(1, min(int(limit or 100), 500))
    return [
        normalize_journal_trade(trade, index)
        for index, trade in enumerate((trades or [])[:safe_limit])
    ]


def _compact_trade(trade: dict[str, Any]) -> dict[str, Any]:
    keys = (
        "date",
        "symbol",
        "asset_type",
        "type",
        "result",
        "pnl",
        "pnl_pct",
        "setup_tag",
        "mistake_tag",
        "confidence_score",
        "planned_risk",
        "planned_reward",
        "rule_followed",
        "entry_reason",
        "exit_reason",
        "scenario_context",
        "notes",
    )
    compact = {key: trade.get(key) for key in keys if trade.get(key) not in (None, "")}
    if "notes" in compact:
        compact["notes"] = str(compact["notes"])[:240]
    return compact


def _coerce_summary(parsed: dict[str, Any]) -> dict[str, Any]:
    return {
        "summary": _string(parsed.get("summary"), "Gemini returned a journal mistake summary."),
        "repeated_mistakes": _string_list(parsed.get("repeated_mistakes")),
        "behavioral_patterns": _string_list(parsed.get("behavioral_patterns")),
        "weak_setups": _string_list(parsed.get("weak_setups")),
        "confidence_issues": _string_list(parsed.get("confidence_issues")),
        "improvement_checklist": _string_list(parsed.get("improvement_checklist")),
    }


def _extract_text(payload: dict[str, Any]) -> str:
    candidates = payload.get("candidates") if isinstance(payload, dict) else None
    if not candidates:
        raise GeminiSummaryFailure("gemini_empty_response")
    parts = candidates[0].get("content", {}).get("parts", [])
    text = "".join(str(part.get("text", "")) for part in parts if isinstance(part, dict)).strip()
    if not text:
        raise GeminiSummaryFailure("gemini_empty_response")
    return text


def _loads_json_object(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    parsed = json.loads(cleaned)
    if not isinstance(parsed, dict):
        raise ValueError("Gemini response was not a JSON object.")
    return parsed


def _summary_from_gemini_text(text: str) -> dict[str, Any]:
    clean = " ".join(str(text or "").split())
    if not clean:
        raise GeminiSummaryFailure("gemini_empty_response")
    return {
        "summary": clean[:1200],
        "repeated_mistakes": ["Gemini returned unstructured text; review the summary for repeated mistake details."],
        "behavioral_patterns": ["Gemini returned unstructured text; review the summary for behavioral pattern details."],
        "weak_setups": ["Gemini returned unstructured text; review the summary for weak setup details."],
        "confidence_issues": ["Gemini returned unstructured text; review the summary for confidence issue details."],
        "improvement_checklist": [
            "Use the Gemini summary as journal review only.",
            "Keep tagging setup, mistake, confidence, and rule-following fields for better summaries.",
        ],
    }


def _contains_unsafe_advice(summary: dict[str, Any]) -> bool:
    values = [
        summary.get("summary", ""),
        *summary.get("repeated_mistakes", []),
        *summary.get("behavioral_patterns", []),
        *summary.get("weak_setups", []),
        *summary.get("confidence_issues", []),
        *summary.get("improvement_checklist", []),
    ]
    return any(_UNSAFE_ADVICE_RE.search(str(value or "")) for value in values)


def _string(value: Any, fallback: str) -> str:
    text = str(value or "").strip()
    return text or fallback


def _string_list(value: Any) -> list[str]:
    if isinstance(value, list):
        items = [str(item).strip() for item in value if str(item or "").strip()]
        return items[:8] if items else ["No clear pattern found in the analyzed journal sample."]
    text = str(value or "").strip()
    return [text] if text else ["No clear pattern found in the analyzed journal sample."]


def _result(trade: dict[str, Any]) -> str:
    return str(trade.get("result") or "").strip().upper()


def _clean_tag(value: Any) -> str:
    text = str(value or "").strip()
    return " ".join(text.replace("_", " ").replace("-", " ").split()).lower()


def _is_none_tag(value: Any) -> bool:
    return _clean_tag(value) in _NONE_TAGS


def _number(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _pct(part: int, total: int) -> float:
    return round((part / total) * 100, 1) if total else 0.0
