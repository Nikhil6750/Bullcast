from __future__ import annotations

import json
import logging
import os
from typing import Any

from backend.intelligence.analyzer import TradeAnalyzer
from backend.intelligence.training import HumanTradeTrainingEngine
from backend.journal import normalize_journal_trade

logger = logging.getLogger(__name__)

try:
    from google import genai

    GEMINI_SDK_AVAILABLE = True
except ImportError:
    genai = None
    GEMINI_SDK_AVAILABLE = False


GEMINI_MODEL = "gemini-2.5-flash"
PROVIDER = "gemini"
MISSING_KEY_WARNING = "Gemini summary unavailable because GEMINI_API_KEY is not configured"
MISSING_SDK_WARNING = "Gemini summary unavailable because google-genai is not installed"
REQUEST_FAILED_WARNING = "Gemini summary unavailable because the Gemini request failed"
EMPTY_RESPONSE_WARNING = "Gemini summary unavailable because Gemini returned no summary text"
UNSAFE_RESPONSE_WARNING = "Gemini summary unavailable because the response was not journal-focused"
EDUCATIONAL_DISCLAIMER = (
    "Educational journal review only. This summary does not predict market direction, "
    "recommend trades, or provide financial advice."
)

UNSAFE_TERMS = (
    "buy now",
    "sell now",
    "hold this",
    "guaranteed",
    "sure profit",
    "price target",
    "take this trade",
)


class GeminiJournalSummaryError(Exception):
    def __init__(self, warning: str):
        super().__init__(warning)
        self.warning = warning


def build_journal_summary(
    trades: list[dict[str, Any]] | None = None,
    *,
    profile_summary: dict[str, Any] | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    recent_trades = _normalize_recent_trades(trades, limit=limit)
    deterministic_summary = build_deterministic_journal_summary(
        recent_trades,
        profile_summary=profile_summary,
    )
    warnings: list[str] = []

    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        warnings.append(MISSING_KEY_WARNING)
        return _response(
            deterministic_summary=deterministic_summary,
            llm_summary=None,
            llm_enabled=False,
            warnings=warnings,
        )

    if not GEMINI_SDK_AVAILABLE or genai is None:
        warnings.append(MISSING_SDK_WARNING)
        return _response(
            deterministic_summary=deterministic_summary,
            llm_summary=None,
            llm_enabled=False,
            warnings=warnings,
        )

    try:
        llm_summary = _gemini_journal_summary(
            deterministic_summary=deterministic_summary,
            api_key=api_key,
        )
    except GeminiJournalSummaryError as exc:
        warnings.append(exc.warning)
        return _response(
            deterministic_summary=deterministic_summary,
            llm_summary=None,
            llm_enabled=False,
            warnings=warnings,
        )
    except Exception:
        logger.warning("Gemini journal summary request failed")
        warnings.append(REQUEST_FAILED_WARNING)
        return _response(
            deterministic_summary=deterministic_summary,
            llm_summary=None,
            llm_enabled=False,
            warnings=warnings,
        )

    return _response(
        deterministic_summary=deterministic_summary,
        llm_summary=llm_summary,
        llm_enabled=True,
        warnings=warnings,
    )


def build_deterministic_journal_summary(
    trades: list[dict[str, Any]] | None = None,
    *,
    profile_summary: dict[str, Any] | None = None,
) -> dict[str, Any]:
    safe_profile_summary = profile_summary if isinstance(profile_summary, dict) else {}
    safe_trades = list(trades or [])

    if safe_trades:
        analysis = TradeAnalyzer(safe_trades).get_all_analysis()
        profile = HumanTradeTrainingEngine(safe_trades).build_profile()
        return _summary_from_analysis_profile(analysis, profile)

    if safe_profile_summary:
        return _summary_from_profile(safe_profile_summary)

    return {
        "source": "deterministic_journal_analytics",
        "input_type": "empty",
        "trade_count": 0,
        "headline": "No journal trades or trader profile summary were provided yet.",
        "metrics": {
            "total_trades": 0,
            "win_rate": 0,
            "loss_rate": 0,
            "net_pnl": 0,
            "average_rr": 0,
        },
        "repeated_mistakes": [],
        "strong_setups": [],
        "strong_symbols": [],
        "risk_behavior": {
            "label": "No journal profile",
            "risk_score": 50,
            "confidence_score": 0,
            "behavioral_warning": "Add journal trades before reviewing behavior patterns.",
            "strengths": [],
            "weaknesses": ["No journal sample is available."],
        },
        "improvement_areas": ["Log recent paper or real journal trades before using summaries."],
        "insights": [],
        "educational_disclaimer": EDUCATIONAL_DISCLAIMER,
    }


def _summary_from_analysis_profile(analysis: dict[str, Any], profile: dict[str, Any]) -> dict[str, Any]:
    basic_stats = analysis.get("basic_stats") if isinstance(analysis.get("basic_stats"), dict) else {}
    metrics = profile.get("metrics") if isinstance(profile.get("metrics"), dict) else {}
    behavior = profile.get("behavior_profile") if isinstance(profile.get("behavior_profile"), dict) else {}
    repeated_mistakes = _safe_list(profile.get("repeated_mistakes"))[:5]
    strong_setups = _safe_list(profile.get("best_setups") or profile.get("setup_history"))[:5]
    strong_symbols = _safe_list(profile.get("best_symbols") or profile.get("symbol_history"))[:5]
    insights = _compact_insights(_safe_list(analysis.get("insights"))[:5])
    trade_count = int(profile.get("sample_size") or analysis.get("trade_count") or basic_stats.get("total_trades") or 0)

    summary_metrics = {
        "total_trades": trade_count,
        "total_wins": metrics.get("total_wins", basic_stats.get("total_wins", 0)),
        "total_losses": metrics.get("total_losses", basic_stats.get("total_losses", 0)),
        "win_rate": metrics.get("win_rate", basic_stats.get("win_rate", 0)),
        "loss_rate": metrics.get("loss_rate", 0),
        "net_pnl": metrics.get("net_pnl", basic_stats.get("total_pnl", 0)),
        "profit_factor": metrics.get("profit_factor", basic_stats.get("profit_factor", 0)),
        "average_rr": metrics.get("average_rr", basic_stats.get("risk_reward_ratio", 0)),
        "average_confidence": metrics.get("average_confidence"),
        "rule_follow_rate": metrics.get("rule_follow_rate"),
    }

    return {
        "source": "deterministic_journal_analytics",
        "input_type": "trades",
        "trade_count": trade_count,
        "profile_status": profile.get("status"),
        "headline": _headline(summary_metrics, repeated_mistakes),
        "metrics": summary_metrics,
        "repeated_mistakes": repeated_mistakes,
        "strong_setups": strong_setups,
        "strong_symbols": strong_symbols,
        "risk_behavior": _risk_behavior(behavior),
        "improvement_areas": _improvement_areas(
            behavior=behavior,
            repeated_mistakes=repeated_mistakes,
            insights=insights,
            metrics=summary_metrics,
        ),
        "insights": insights,
        "data_origin": profile.get("data_origin", {}),
        "educational_disclaimer": EDUCATIONAL_DISCLAIMER,
    }


def _summary_from_profile(profile: dict[str, Any]) -> dict[str, Any]:
    metrics = profile.get("metrics") if isinstance(profile.get("metrics"), dict) else {}
    behavior = profile.get("behavior_profile") if isinstance(profile.get("behavior_profile"), dict) else {}
    repeated_mistakes = _safe_list(profile.get("repeated_mistakes"))[:5]
    strong_setups = _safe_list(profile.get("best_setups") or profile.get("setup_history"))[:5]
    strong_symbols = _safe_list(profile.get("best_symbols") or profile.get("symbol_history"))[:5]
    trade_count = int(profile.get("sample_size") or profile.get("total_journal_trades") or metrics.get("total_trades") or 0)
    summary_metrics = {
        "total_trades": trade_count,
        "total_wins": metrics.get("total_wins", 0),
        "total_losses": metrics.get("total_losses", 0),
        "win_rate": metrics.get("win_rate", 0),
        "loss_rate": metrics.get("loss_rate", 0),
        "net_pnl": metrics.get("net_pnl", 0),
        "profit_factor": metrics.get("profit_factor", 0),
        "average_rr": metrics.get("average_rr", 0),
        "average_confidence": metrics.get("average_confidence"),
        "rule_follow_rate": metrics.get("rule_follow_rate"),
    }

    return {
        "source": "deterministic_journal_analytics",
        "input_type": "profile_summary",
        "trade_count": trade_count,
        "profile_status": profile.get("status"),
        "headline": _headline(summary_metrics, repeated_mistakes),
        "metrics": summary_metrics,
        "repeated_mistakes": repeated_mistakes,
        "strong_setups": strong_setups,
        "strong_symbols": strong_symbols,
        "risk_behavior": _risk_behavior(behavior),
        "improvement_areas": _improvement_areas(
            behavior=behavior,
            repeated_mistakes=repeated_mistakes,
            insights=[],
            metrics=summary_metrics,
        ),
        "insights": [],
        "data_origin": profile.get("data_origin", {}),
        "educational_disclaimer": EDUCATIONAL_DISCLAIMER,
    }


def _gemini_journal_summary(*, deterministic_summary: dict[str, Any], api_key: str) -> str:
    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=_build_gemini_prompt(deterministic_summary),
    )
    text = _extract_response_text(response)
    if not text:
        raise GeminiJournalSummaryError(EMPTY_RESPONSE_WARNING)
    if _contains_unsafe_advice(text):
        raise GeminiJournalSummaryError(UNSAFE_RESPONSE_WARNING)
    return text[:1800]


def _build_gemini_prompt(deterministic_summary: dict[str, Any]) -> str:
    compact = {
        "headline": deterministic_summary.get("headline"),
        "metrics": deterministic_summary.get("metrics"),
        "repeated_mistakes": deterministic_summary.get("repeated_mistakes"),
        "strong_setups": deterministic_summary.get("strong_setups"),
        "strong_symbols": deterministic_summary.get("strong_symbols"),
        "risk_behavior": deterministic_summary.get("risk_behavior"),
        "improvement_areas": deterministic_summary.get("improvement_areas"),
        "data_origin": deterministic_summary.get("data_origin"),
    }
    return (
        "You summarize a trader's journal for educational self-review.\n"
        "Use only the deterministic journal analytics JSON below as source of truth.\n"
        "Focus on journal patterns, repeated mistakes, strong setups, risk behavior, and improvement areas.\n"
        "Do not provide financial advice, buy/sell/hold signals, market predictions, price targets, or broker instructions.\n"
        "Keep the response concise, practical, and journal-focused.\n\n"
        f"Deterministic journal analytics:\n{json.dumps(compact, ensure_ascii=True, default=str)}"
    )


def _normalize_recent_trades(trades: list[dict[str, Any]] | None, *, limit: int) -> list[dict[str, Any]]:
    safe_limit = max(1, min(int(limit or 100), 500))
    return [
        normalize_journal_trade(trade, index)
        for index, trade in enumerate(list(trades or [])[:safe_limit])
    ]


def _response(
    *,
    deterministic_summary: dict[str, Any],
    llm_summary: str | None,
    llm_enabled: bool,
    warnings: list[str],
) -> dict[str, Any]:
    return {
        "deterministic_summary": deterministic_summary,
        "llm_summary": llm_summary,
        "llm_enabled": llm_enabled,
        "provider": PROVIDER,
        "model": GEMINI_MODEL if llm_enabled else None,
        "warnings": warnings,
        "educational_disclaimer": EDUCATIONAL_DISCLAIMER,
    }


def _headline(metrics: dict[str, Any], repeated_mistakes: list[dict[str, Any]]) -> str:
    total = int(metrics.get("total_trades") or 0)
    win_rate = metrics.get("win_rate", 0)
    net_pnl = metrics.get("net_pnl", 0)
    if total <= 0:
        return "No journal trades are available yet."

    parts = [
        f"Deterministic summary covers {total} journal trades",
        f"{win_rate}% win rate",
        f"net PnL {net_pnl}",
    ]
    if repeated_mistakes:
        parts.append(f"top repeated mistake: {repeated_mistakes[0].get('tag')}")
    return ", ".join(parts) + "."


def _risk_behavior(behavior: dict[str, Any]) -> dict[str, Any]:
    return {
        "label": behavior.get("label", "No dominant behavior profile"),
        "risk_score": behavior.get("risk_score", 50),
        "confidence_score": behavior.get("confidence_score", 0),
        "behavioral_warning": behavior.get(
            "behavioral_warning",
            "No dominant behavior warning detected from the current sample.",
        ),
        "strengths": _safe_list(behavior.get("strengths")),
        "weaknesses": _safe_list(behavior.get("weaknesses")),
    }


def _improvement_areas(
    *,
    behavior: dict[str, Any],
    repeated_mistakes: list[dict[str, Any]],
    insights: list[dict[str, Any]],
    metrics: dict[str, Any],
) -> list[str]:
    areas: list[str] = []
    areas.extend(str(item) for item in _safe_list(behavior.get("weaknesses")) if item)

    if repeated_mistakes:
        primary = repeated_mistakes[0]
        areas.append(f"Review repeated {primary.get('tag')} behavior before the next journal cycle.")

    for insight in insights:
        recommendation = str(insight.get("recommendation") or "").strip()
        if recommendation:
            areas.append(recommendation)

    if int(metrics.get("total_trades") or 0) < 5:
        areas.append("Log more trades before treating behavior patterns as stable.")
    if not areas:
        areas.append("Continue logging setup quality, rule-following, and post-trade notes for review.")
    return _dedupe(areas)[:6]


def _compact_insights(insights: list[Any]) -> list[dict[str, Any]]:
    compact: list[dict[str, Any]] = []
    for item in insights:
        if not isinstance(item, dict):
            continue
        compact.append({
            "type": item.get("type"),
            "title": item.get("title"),
            "finding": item.get("finding"),
            "recommendation": item.get("recommendation"),
            "severity": item.get("severity"),
        })
    return compact


def _extract_response_text(response: Any) -> str:
    text = getattr(response, "text", None)
    if isinstance(text, str) and text.strip():
        return text.strip()
    return ""


def _contains_unsafe_advice(text: str) -> bool:
    lower = str(text or "").lower()
    return any(term in lower for term in UNSAFE_TERMS)


def _safe_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        clean = " ".join(str(item or "").split())
        key = clean.lower()
        if clean and key not in seen:
            seen.add(key)
            result.append(clean)
    return result
