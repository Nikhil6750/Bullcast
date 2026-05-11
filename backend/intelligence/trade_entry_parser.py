from __future__ import annotations

import json
import logging
import os
import re
from datetime import date
from typing import Any

logger = logging.getLogger(__name__)

try:
    from google import genai

    GEMINI_SDK_AVAILABLE = True
except ImportError:
    genai = None
    GEMINI_SDK_AVAILABLE = False


GEMINI_MODEL = "gemini-2.5-flash"
PROVIDER = "gemini"
MISSING_KEY_WARNING = "Gemini trade parser unavailable because GEMINI_API_KEY is not configured."
MISSING_SDK_WARNING = "Gemini trade parser unavailable because google-genai is not installed."
REQUEST_FAILED_WARNING = "Gemini trade parser unavailable because the Gemini request failed."
INVALID_JSON_WARNING = "Gemini trade parser returned invalid JSON."
EMPTY_INPUT_WARNING = "Enter a trade description before parsing."

SETUP_TAGS = {
    "breakout",
    "pullback",
    "reversal",
    "trend_continuation",
    "momentum",
    "mean_reversion",
    "news_reaction",
    "news_event",
    "earnings",
    "support_resistance",
    "range_trade",
    "other",
}
MISTAKE_TAGS = {
    "none",
    "late_entry",
    "early_exit",
    "revenge_trade",
    "oversized_position",
    "traded_against_sentiment",
    "no_plan",
    "ignored_stop",
    "poor_risk_reward",
    "bad_risk_reward",
    "other",
}


class GeminiTradeParseError(Exception):
    def __init__(self, warning: str):
        super().__init__(warning)
        self.warning = warning


def parse_trade_entries(
    text: str,
    *,
    timezone: str | None = None,
    default_date: str | None = None,
) -> dict[str, Any]:
    source_text = str(text or "").strip()
    if not source_text:
        return _response(
            trades=[],
            warnings=[EMPTY_INPUT_WARNING],
            llm_enabled=False,
        )

    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        return _response(
            trades=[],
            warnings=[MISSING_KEY_WARNING],
            llm_enabled=False,
        )

    if not GEMINI_SDK_AVAILABLE or genai is None:
        return _response(
            trades=[],
            warnings=[MISSING_SDK_WARNING],
            llm_enabled=False,
        )

    try:
        payload = _gemini_parse_trades(
            text=source_text,
            timezone=timezone,
            default_date=_safe_iso_date(default_date),
            api_key=api_key,
        )
        trades, validation_warnings = _sanitize_trades(
            payload.get("trades") if isinstance(payload, dict) else [],
            source_text=source_text,
            default_date=_safe_iso_date(default_date),
        )
        warnings = validation_warnings
        if isinstance(payload, dict):
            warnings.extend(_safe_warning_list(payload.get("warnings")))
        if not trades:
            warnings.append("No journal trades were parsed from the description.")
        return _response(
            trades=trades,
            warnings=_dedupe(warnings),
            llm_enabled=True,
        )
    except GeminiTradeParseError as exc:
        return _response(
            trades=[],
            warnings=[exc.warning],
            llm_enabled=False,
        )
    except Exception:
        logger.exception("Gemini trade parser request failed")
        return _response(
            trades=[],
            warnings=[REQUEST_FAILED_WARNING],
            llm_enabled=False,
        )


def _gemini_parse_trades(
    *,
    text: str,
    timezone: str | None,
    default_date: str | None,
    api_key: str,
) -> dict[str, Any]:
    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=_build_prompt(
            text=text,
            timezone=timezone,
            default_date=default_date,
        ),
    )
    response_text = _extract_response_text(response)
    if not response_text:
        raise GeminiTradeParseError(INVALID_JSON_WARNING)
    try:
        payload = _loads_json_object(response_text)
    except ValueError as exc:
        raise GeminiTradeParseError(INVALID_JSON_WARNING) from exc
    if not isinstance(payload, dict):
        raise GeminiTradeParseError(INVALID_JSON_WARNING)
    return payload


def _build_prompt(*, text: str, timezone: str | None, default_date: str | None) -> str:
    schema = {
        "trades": [
            {
                "date": "YYYY-MM-DD or null",
                "symbol": "string or null",
                "side": "LONG, SHORT, or null",
                "entry": "number or null",
                "exit": "number or null",
                "quantity": "number or null",
                "setup": "string",
                "setup_tag": "known tag or empty string",
                "confidence": "string",
                "confidence_score": "1-5 number or null",
                "mistake": "string",
                "mistake_tag": "known tag or none",
                "rule_followed": "true, false, or null",
                "planned_risk": "number or null",
                "planned_reward": "number or null",
                "entry_reason": "string",
                "exit_reason": "string",
                "notes": "string",
                "data_origin": "gemini_text_parse",
                "is_synthetic": False,
                "needs_review": True,
                "missing_fields": [],
            }
        ],
        "warnings": [],
        "llm_enabled": True,
        "provider": PROVIDER,
    }
    return (
        "You are a trade journal parser for Bullcast. Convert the user's text into JSON only.\n"
        "This is not trade advice. Do not recommend buys, sells, holds, targets, or predictions.\n"
        "Extract only what the user said. Do not invent prices, quantities, symbols, dates, profit, or loss.\n"
        "Use the default_date only when the user gives no explicit date. If a field is uncertain, set it to null or an empty string and add it to missing_fields.\n"
        "Infer setup_tag or mistake_tag only when clearly supported by the text.\n"
        f"Allowed setup_tag values: {sorted(SETUP_TAGS)}.\n"
        f"Allowed mistake_tag values: {sorted(MISTAKE_TAGS)}.\n"
        "Return valid JSON only with this exact top-level shape:\n"
        f"{json.dumps(schema, ensure_ascii=True)}\n\n"
        f"Default date: {default_date or 'null'}\n"
        f"Timezone: {timezone or 'null'}\n"
        f"User trade text:\n{text}"
    )


def _sanitize_trades(
    rows: Any,
    *,
    source_text: str,
    default_date: str | None,
) -> tuple[list[dict[str, Any]], list[str]]:
    warnings: list[str] = []
    trades: list[dict[str, Any]] = []
    for index, row in enumerate(rows if isinstance(rows, list) else []):
        if not isinstance(row, dict):
            warnings.append(f"Parsed row {index + 1} was ignored because it was not an object.")
            continue
        trade = _sanitize_trade(row, source_text=source_text, default_date=default_date)
        trades.append(trade)
    return trades, warnings


def _sanitize_trade(row: dict[str, Any], *, source_text: str, default_date: str | None) -> dict[str, Any]:
    symbol = _optional_text(row.get("symbol"))
    side = _normalize_side(row.get("side") or row.get("type"))
    entry = _safe_number(row.get("entry") if "entry" in row else row.get("entry_price"))
    exit_price = _safe_number(row.get("exit") if "exit" in row else row.get("exit_price"))
    quantity = _safe_number(row.get("quantity"))
    planned_risk = _safe_number(row.get("planned_risk"))
    planned_reward = _safe_number(row.get("planned_reward"))
    confidence_score = _safe_confidence(row.get("confidence_score"))
    trade_date = _safe_iso_date(row.get("date")) or default_date
    setup_tag = _normalize_tag(row.get("setup_tag"), SETUP_TAGS, "")
    mistake_tag = _normalize_tag(row.get("mistake_tag"), MISTAKE_TAGS, "none")
    rule_followed = _safe_bool(row.get("rule_followed"))

    unsupported_numbers = _clear_unsupported_numbers(
        {
            "entry": entry,
            "exit": exit_price,
            "quantity": quantity,
            "planned_risk": planned_risk,
            "planned_reward": planned_reward,
        },
        source_text=source_text,
    )
    entry = unsupported_numbers["entry"]
    exit_price = unsupported_numbers["exit"]
    quantity = unsupported_numbers["quantity"]
    planned_risk = unsupported_numbers["planned_risk"]
    planned_reward = unsupported_numbers["planned_reward"]

    missing_fields: list[str] = []
    if not trade_date:
        missing_fields.append("date")
    if not symbol:
        missing_fields.append("symbol")
    if side not in {"LONG", "SHORT"}:
        missing_fields.append("side")
    if entry is None and exit_price is None:
        missing_fields.extend(["entry", "exit"])
    if quantity is None:
        missing_fields.append("quantity")

    provided_missing = row.get("missing_fields")
    if isinstance(provided_missing, list):
        missing_fields.extend(str(item) for item in provided_missing if item)

    missing_fields = _dedupe(missing_fields)
    needs_review = bool(missing_fields) or row.get("needs_review") is True

    return {
        "date": trade_date,
        "symbol": symbol,
        "side": side,
        "entry": entry,
        "exit": exit_price,
        "quantity": quantity,
        "setup": _optional_text(row.get("setup")) or "",
        "setup_tag": setup_tag,
        "confidence": _optional_text(row.get("confidence")) or "",
        "confidence_score": confidence_score,
        "mistake": _optional_text(row.get("mistake")) or "",
        "mistake_tag": mistake_tag,
        "rule_followed": rule_followed,
        "planned_risk": planned_risk,
        "planned_reward": planned_reward,
        "entry_reason": _optional_text(row.get("entry_reason")) or "",
        "exit_reason": _optional_text(row.get("exit_reason")) or "",
        "notes": _optional_text(row.get("notes")) or "",
        "data_origin": "gemini_text_parse",
        "is_synthetic": False,
        "needs_review": needs_review,
        "missing_fields": missing_fields,
    }


def _clear_unsupported_numbers(values: dict[str, float | None], *, source_text: str) -> dict[str, float | None]:
    source_numbers = _number_tokens(source_text)
    if not source_numbers:
        return {key: None for key in values}
    result: dict[str, float | None] = {}
    for key, value in values.items():
        if value is None:
            result[key] = None
            continue
        result[key] = value if _number_supported(value, source_numbers) else None
    return result


def _number_tokens(text: str) -> set[str]:
    tokens: set[str] = set()
    for match in re.finditer(r"(?<![A-Za-z])[-+]?\d[\d,]*(?:\.\d+)?", str(text or "")):
        raw = match.group(0).replace(",", "")
        try:
            value = float(raw)
        except ValueError:
            continue
        tokens.add(_number_key(value))
    return tokens


def _number_supported(value: float, source_numbers: set[str]) -> bool:
    return _number_key(value) in source_numbers


def _number_key(value: float) -> str:
    number = float(value)
    if number.is_integer():
        return str(int(number))
    return f"{number:.8f}".rstrip("0").rstrip(".")


def _loads_json_object(text: str) -> dict[str, Any]:
    stripped = str(text or "").strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", stripped, flags=re.IGNORECASE)
        stripped = re.sub(r"\s*```$", "", stripped)
    try:
        loaded = json.loads(stripped)
    except json.JSONDecodeError:
        start = stripped.find("{")
        end = stripped.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("No JSON object found.")
        loaded = json.loads(stripped[start : end + 1])
    if not isinstance(loaded, dict):
        raise ValueError("JSON response must be an object.")
    return loaded


def _extract_response_text(response: Any) -> str:
    text = getattr(response, "text", None)
    if isinstance(text, str) and text.strip():
        return text.strip()
    return ""


def _safe_number(value: Any) -> float | None:
    if value in ("", None):
        return None
    if isinstance(value, str):
        value = value.replace(",", "").replace("$", "").replace("%", "").strip()
        if value == "":
            return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in {float("inf"), float("-inf")}:
        return None
    return number


def _safe_confidence(value: Any) -> int | None:
    number = _safe_number(value)
    if number is None:
        return None
    integer = int(number)
    return integer if 1 <= integer <= 5 else None


def _safe_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if value in ("", None):
        return None
    text = str(value).strip().lower()
    if text in {"true", "yes", "y", "1", "followed rules", "rules followed"}:
        return True
    if text in {"false", "no", "n", "0", "did not follow rules"}:
        return False
    return None


def _safe_iso_date(value: Any) -> str | None:
    text = str(value or "").strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", text):
        return None
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError:
        return None


def _optional_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def _normalize_side(value: Any) -> str | None:
    text = str(value or "").strip().upper()
    if text in {"LONG", "BUY", "BOUGHT", "CALL"}:
        return "LONG"
    if text in {"SHORT", "SELL", "SOLD SHORT", "PUT"}:
        return "SHORT"
    return None


def _normalize_tag(value: Any, allowed: set[str], fallback: str) -> str:
    text = str(value or "").strip().lower().replace("-", "_").replace(" ", "_")
    return text if text in allowed else fallback


def _safe_warning_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


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


def _response(*, trades: list[dict[str, Any]], warnings: list[str], llm_enabled: bool) -> dict[str, Any]:
    return {
        "trades": trades,
        "warnings": warnings,
        "llm_enabled": llm_enabled,
        "provider": PROVIDER,
    }
