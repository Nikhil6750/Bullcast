from __future__ import annotations

from collections import Counter
from datetime import datetime
import math
import re
from typing import Any

from backend.edgar import (
    build_edgar_context_from_source_as_of,
    fetch_edgar_source_for_ticker,
    parse_date_safe,
)


ASSET_TYPES = {"stock", "forex", "crypto", "index", "unknown"}
EQUITY_LIKE_TICKERS = {"RELIANCE", "TATASTEEL", "INFY", "TCS"}
SETUP_TAG_NONE = {"", "none", "null", "undefined"}
MISTAKE_TAG_NONE = {"", "none", "null", "undefined"}


def build_trade_dataset(trades: list[dict[str, Any]] | None, include_edgar: bool = False) -> dict[str, Any]:
    """
    Convert Bullcast journal trades into a clean JSON dataset.

    This exporter does not write files and does not train models. Outcome
    columns such as pnl, pnl_pct, result, result_binary, exit_price, actual_rr,
    and pnl_bucket are labels/evaluation fields, not pre-entry input features.
    """
    input_trades = trades if isinstance(trades, list) else []
    normalized = [_normalize_trade(trade, index) for index, trade in enumerate(input_trades)]
    actual_rr = _dataset_actual_rr(normalized)
    edgar_cache: dict[str, dict[str, Any]] = {}
    edgar_state = {"supported_rows": 0, "available_rows": 0, "rows_without_point_in_time_data": 0, "warnings": []}
    rows: list[dict[str, Any]] = []
    for trade in normalized:
        row = _build_row(trade, actual_rr)
        if include_edgar:
            # EDGAR fields are filtered by trade date using SEC filed/filingDate
            # availability dates before being added to model-ready rows.
            row.update(_build_edgar_fields(trade, edgar_cache, edgar_state))
        rows.append(row)
    summary = _build_summary(rows)
    summary["edgar"] = _build_edgar_summary(include_edgar, edgar_state)

    return {
        "rows": rows,
        "summary": summary,
        "quality_gate": evaluate_dataset_quality(rows, summary),
    }


def evaluate_dataset_quality(rows: list[dict[str, Any]], summary: dict[str, Any]) -> dict[str, Any]:
    """
    Evaluate whether exported journal rows are ready for model experiments.

    This does not train or score a model. It only checks sample size, labels,
    leakage safety, and feature coverage so the UI can explain dataset readiness.
    """
    safe_rows = rows if isinstance(rows, list) else []
    safe_summary = summary if isinstance(summary, dict) else {}
    checks: list[dict[str, Any]] = []

    total_rows = len(safe_rows)
    checks.append(_total_rows_check(total_rows))
    checks.append(_class_balance_check(safe_rows))
    checks.append(_coverage_check(safe_summary, "Setup Tag Coverage", "setup_tag", fail_below=30, warn_below=70))
    checks.append(_coverage_check(safe_summary, "Mistake Tag Coverage", "mistake_tag", fail_below=20, warn_below=60))
    checks.append(_coverage_check(safe_summary, "Planned Risk/Reward Coverage", "planned_rr", fail_below=30, warn_below=70))
    checks.append(_coverage_check(safe_summary, "Rule Followed Coverage", "rule_followed", fail_below=30, warn_below=70))
    checks.append(_asset_mixing_check(safe_summary))

    edgar_summary = safe_summary.get("edgar") if isinstance(safe_summary.get("edgar"), dict) else {"enabled": False}
    if edgar_summary.get("enabled") is True:
        checks.append(_edgar_coverage_check(edgar_summary))
    checks.append(_leakage_safety_check(edgar_summary))

    score = _quality_score(checks)
    readiness_level = _readiness_level(score)

    return {
        "ready_for_training": readiness_level in {"baseline_ready", "strong_ready"},
        "readiness_level": readiness_level,
        "score": score,
        "checks": checks,
        "recommendations": _quality_recommendations(checks, readiness_level),
    }


def infer_asset_type(symbol: str | None) -> str:
    s = str(symbol or "").strip().upper()
    if not s:
        return "unknown"
    if "BTC" in s or "ETH" in s or "USDT" in s or s.endswith("-USD"):
        return "crypto"
    if s.startswith("^") or any(token in s for token in ("NIFTY", "SENSEX", "SPX", "NASDAQ")):
        return "index"
    if re.fullmatch(r"[A-Z]{6}", s) and "." not in s:
        return "forex"
    if s.endswith(".NS") or s.endswith(".BO"):
        return "stock"
    if re.sub(r"\.(NS|BO)$", "", s) in EQUITY_LIKE_TICKERS:
        return "stock"
    return "unknown"


def _normalize_trade(trade: Any, index: int) -> dict[str, Any]:
    source = trade if isinstance(trade, dict) else {}
    symbol = str(_first(source, "symbol", "ticker", default="UNKNOWN")).strip().upper() or "UNKNOWN"
    direction = str(_first(source, "type", "side", "direction", default="LONG")).strip().upper()
    if direction not in {"LONG", "SHORT"}:
        direction = "LONG"

    entry_price = _to_float(_first(source, "entry_price", "entryPrice", "entry", default=None))
    exit_price = _to_float(_first(source, "exit_price", "exitPrice", "exit", default=None))
    quantity = _to_float(_first(source, "quantity", "qty", "size", default=None))
    pnl = _to_float(_first(source, "pnl", "profitLoss", "profit_loss", default=None))

    if pnl is None and entry_price is not None and exit_price is not None and quantity is not None:
        pnl = (exit_price - entry_price) * quantity if direction == "LONG" else (entry_price - exit_price) * quantity

    pnl_pct = _to_float(_first(source, "pnl_pct", "pnlPct", "return_pct", default=None))
    if pnl_pct is None and pnl is not None and entry_price and quantity:
        cost = entry_price * quantity
        pnl_pct = (pnl / cost) * 100 if cost else None

    result = str(_first(source, "result", default="")).strip().upper()
    if result not in {"WIN", "LOSS"} and pnl is not None:
        result = "WIN" if pnl > 0 else "LOSS"

    raw_asset_type = str(_first(source, "asset_type", "assetType", default="")).strip().lower()
    asset_type = raw_asset_type if raw_asset_type in ASSET_TYPES else infer_asset_type(symbol)

    return {
        "trade_id": str(_first(source, "id", "trade_id", "tradeId", default=f"{symbol}-{index}")),
        "date": str(_first(source, "date", "entryDate", "entry_date", default="")),
        "symbol": symbol,
        "asset_type": asset_type,
        "direction": direction,
        "entry_price": entry_price,
        "exit_price": exit_price,
        "quantity": quantity,
        "pnl": pnl,
        "pnl_pct": pnl_pct,
        "result": result if result in {"WIN", "LOSS"} else None,
        "setup_tag": _clean_optional_text(_first(source, "setup_tag", "setupTag", default=None)),
        "mistake_tag": _clean_optional_text(_first(source, "mistake_tag", "mistakeTag", default="none")) or "none",
        "confidence_score": _to_int(_first(source, "confidence_score", "confidenceScore", default=None), minimum=1, maximum=5),
        "planned_risk": _to_float(_first(source, "planned_risk", "plannedRisk", default=None)),
        "planned_reward": _to_float(_first(source, "planned_reward", "plannedReward", default=None)),
        "rule_followed": _to_bool(_first(source, "rule_followed", "ruleFollowed", default=None)),
        "entry_reason": _clean_optional_text(_first(source, "entry_reason", "entryReason", default="")) or "",
        "exit_reason": _clean_optional_text(_first(source, "exit_reason", "exitReason", default="")) or "",
        "notes": _clean_optional_text(_first(source, "notes", "note", default="")) or "",
    }


def _build_row(trade: dict[str, Any], actual_rr: float | None) -> dict[str, Any]:
    date_info = _date_parts(trade["date"])
    planned_risk = trade["planned_risk"]
    planned_reward = trade["planned_reward"]
    planned_rr = None
    if _positive(planned_risk) and _positive(planned_reward):
        planned_rr = round(planned_reward / planned_risk, 4)

    result = trade["result"]
    result_binary = 1 if result == "WIN" else 0 if result == "LOSS" else None
    setup_tag = trade["setup_tag"] or ""
    mistake_tag = trade["mistake_tag"] or "none"
    asset_type = trade["asset_type"]

    return {
        "trade_id": trade["trade_id"],
        "date": trade["date"],
        "symbol": trade["symbol"],
        "asset_type": asset_type,
        "direction": trade["direction"],
        "entry_price": trade["entry_price"],
        # Outcome/evaluation field, not a pre-entry model input.
        "exit_price": trade["exit_price"],
        "quantity": trade["quantity"],
        # Outcome columns below are labels/evaluation fields, not input features.
        "pnl": _round_or_none(trade["pnl"]),
        "pnl_pct": _round_or_none(trade["pnl_pct"]),
        "result": result,
        "result_binary": result_binary,
        "setup_tag": setup_tag,
        "mistake_tag": mistake_tag,
        "confidence_score": trade["confidence_score"],
        "planned_risk": _round_or_none(planned_risk),
        "planned_reward": _round_or_none(planned_reward),
        "planned_rr": planned_rr,
        # Dataset-level realized R/R; outcome-derived label/evaluation field.
        "actual_rr": actual_rr,
        "rule_followed": trade["rule_followed"],
        "entry_reason": trade["entry_reason"],
        "exit_reason": trade["exit_reason"],
        "notes": trade["notes"],
        "day_of_week": date_info["day_of_week"],
        "month": date_info["month"],
        "is_stock": asset_type == "stock",
        "is_forex": asset_type == "forex",
        "is_crypto": asset_type == "crypto",
        "is_index": asset_type == "index",
        "has_setup_tag": bool(setup_tag and setup_tag.lower() not in SETUP_TAG_NONE),
        "has_mistake_tag": bool(mistake_tag and mistake_tag.lower() not in MISTAKE_TAG_NONE),
        "has_plan": _positive(planned_risk) and _positive(planned_reward),
        "has_notes": bool(trade["notes"].strip()),
        "pnl_bucket": _pnl_bucket(trade["pnl"], trade["pnl_pct"]),
    }


def _build_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    total_rows = len(rows)
    missing_label_rows = sum(1 for row in rows if row["result_binary"] is None)
    usable_rows = sum(1 for row in rows if _is_usable_row(row))
    asset_mix = {asset_type: 0 for asset_type in sorted(ASSET_TYPES)}
    asset_mix.update(Counter(row["asset_type"] for row in rows))

    label_coverage = {
        "result": _coverage(total_rows, total_rows - missing_label_rows),
        "setup_tag": _coverage(total_rows, sum(1 for row in rows if row["has_setup_tag"])),
        "mistake_tag": _coverage(total_rows, sum(1 for row in rows if row["has_mistake_tag"])),
        "planned_risk": _coverage(total_rows, sum(1 for row in rows if row["planned_risk"] is not None)),
        "planned_reward": _coverage(total_rows, sum(1 for row in rows if row["planned_reward"] is not None)),
        "planned_rr": _coverage(total_rows, sum(1 for row in rows if row["planned_rr"] is not None)),
        "rule_followed": _coverage(total_rows, sum(1 for row in rows if row["rule_followed"] is not None)),
        "confidence_score": _coverage(total_rows, sum(1 for row in rows if row["confidence_score"] is not None)),
    }

    return {
        "total_rows": total_rows,
        "usable_rows": usable_rows,
        "missing_label_rows": missing_label_rows,
        "asset_mix": asset_mix,
        "label_coverage": label_coverage,
        "warnings": _warnings(rows, asset_mix, label_coverage),
    }


def _build_edgar_fields(
    trade: dict[str, Any],
    edgar_cache: dict[str, dict[str, Any]],
    edgar_state: dict[str, Any],
) -> dict[str, Any]:
    fields = _empty_edgar_fields()
    symbol = str(trade.get("symbol") or "").strip().upper()

    if not _is_edgar_supported_trade(trade):
        fields["edgar_warnings"] = "EDGAR skipped: only US stock tickers without non-US suffixes are supported."
        return fields

    edgar_state["supported_rows"] += 1
    trade_date = parse_date_safe(trade.get("date"))
    if trade_date is None:
        warning = "Invalid or missing trade date for point-in-time EDGAR filtering."
        edgar_state["rows_without_point_in_time_data"] += 1
        _remember_edgar_warnings(edgar_state, [warning])
        fields["edgar_warnings"] = warning
        return fields

    as_of_date = trade_date.date().isoformat()
    fields["edgar_point_in_time"] = True
    fields["edgar_as_of_date"] = as_of_date
    source = _get_cached_edgar_source(symbol, edgar_cache)
    context = build_edgar_context_from_source_as_of(source, as_of_date)
    warnings: list[str] = []

    if not isinstance(context, dict):
        warnings.append("EDGAR context unavailable for this ticker.")
        edgar_state["rows_without_point_in_time_data"] += 1
        _remember_edgar_warnings(edgar_state, warnings)
        fields["edgar_warnings"] = _join_warnings(warnings)
        return fields

    context_warnings = _warning_list(context.get("warnings"))
    warnings.extend(context_warnings)
    if context.get("available") is True:
        edgar_state["available_rows"] += 1
        fields["edgar_available"] = True
    elif not context_warnings:
        warnings.append("EDGAR context unavailable for this ticker.")
    if context.get("available") is not True:
        edgar_state["rows_without_point_in_time_data"] += 1

    recent_filings = context.get("recent_filings") if isinstance(context.get("recent_filings"), list) else []
    facts = {}
    core_facts = context.get("core_facts")
    if isinstance(core_facts, dict) and isinstance(core_facts.get("facts"), dict):
        facts = core_facts["facts"]
        warnings.extend(_warning_list(core_facts.get("warnings")))

    fields.update({
        "edgar_cik": context.get("cik"),
        "edgar_company_name": context.get("company_name"),
        "edgar_recent_10k_date": _recent_filing_date(recent_filings, "10-K"),
        "edgar_recent_10q_date": _recent_filing_date(recent_filings, "10-Q"),
        "edgar_recent_8k_date": _recent_filing_date(recent_filings, "8-K"),
        "edgar_revenues": _fact_value(facts, "revenues"),
        "edgar_net_income": _fact_value(facts, "net_income"),
        "edgar_assets": _fact_value(facts, "assets"),
        "edgar_liabilities": _fact_value(facts, "liabilities"),
        "edgar_equity": _fact_value(facts, "stockholders_equity"),
        "edgar_cash": _fact_value(facts, "cash_and_cash_equivalents"),
        "edgar_operating_cash_flow": _fact_value(facts, "operating_cash_flow"),
        "edgar_eps_diluted": _fact_value(facts, "eps_diluted"),
    })

    warnings = _unique_warnings(warnings)
    _remember_edgar_warnings(edgar_state, warnings)
    fields["edgar_warnings"] = _join_warnings(warnings)
    return fields


def _empty_edgar_fields() -> dict[str, Any]:
    return {
        "edgar_point_in_time": False,
        "edgar_as_of_date": None,
        "edgar_available": False,
        "edgar_cik": None,
        "edgar_company_name": None,
        "edgar_recent_10k_date": None,
        "edgar_recent_10q_date": None,
        "edgar_recent_8k_date": None,
        "edgar_revenues": None,
        "edgar_net_income": None,
        "edgar_assets": None,
        "edgar_liabilities": None,
        "edgar_equity": None,
        "edgar_cash": None,
        "edgar_operating_cash_flow": None,
        "edgar_eps_diluted": None,
        "edgar_warnings": "",
    }


def _build_edgar_summary(enabled: bool, edgar_state: dict[str, Any]) -> dict[str, Any]:
    if not enabled:
        return {"enabled": False}

    supported_rows = int(edgar_state.get("supported_rows") or 0)
    available_rows = int(edgar_state.get("available_rows") or 0)
    rows_without_point_in_time_data = int(edgar_state.get("rows_without_point_in_time_data") or 0)
    coverage = round((available_rows / supported_rows) * 100, 1) if supported_rows else 0

    return {
        "enabled": True,
        "point_in_time": True,
        "coverage": coverage,
        "supported_rows": supported_rows,
        "available_rows": available_rows,
        "rows_without_point_in_time_data": rows_without_point_in_time_data,
        "warnings": _unique_warnings(edgar_state.get("warnings") or []),
    }


def _total_rows_check(total_rows: int) -> dict[str, Any]:
    if total_rows < 30:
        return _quality_check(
            "Total Rows",
            "fail",
            "Dataset has fewer than 30 trades; keep using analysis before training.",
            total_rows,
        )
    if total_rows < 100:
        return _quality_check(
            "Total Rows",
            "warn",
            "Dataset has enough rows for weak pattern checks, but not enough for reliable baseline training.",
            total_rows,
        )
    return _quality_check(
        "Total Rows",
        "pass",
        "Dataset has at least 100 trades, enough for first baseline model experiments.",
        total_rows,
    )


def _class_balance_check(rows: list[dict[str, Any]]) -> dict[str, Any]:
    wins = sum(1 for row in rows if row.get("result") == "WIN")
    losses = sum(1 for row in rows if row.get("result") == "LOSS")
    labeled = wins + losses
    value = {"wins": wins, "losses": losses}

    if labeled == 0 or wins == 0 or losses == 0:
        return _quality_check(
            "Class Balance",
            "fail",
            "Both WIN and LOSS examples are required before training.",
            value,
        )

    minority_pct = round((min(wins, losses) / labeled) * 100, 1)
    value["minority_pct"] = minority_pct
    if minority_pct < 20:
        return _quality_check(
            "Class Balance",
            "warn",
            "One outcome class is below 20%; model evaluation may be biased.",
            value,
        )

    return _quality_check(
        "Class Balance",
        "pass",
        "WIN and LOSS classes are represented well enough for baseline experiments.",
        value,
    )


def _coverage_check(
    summary: dict[str, Any],
    name: str,
    coverage_key: str,
    fail_below: float,
    warn_below: float,
) -> dict[str, Any]:
    coverage = _coverage_pct_from_summary(summary, coverage_key)
    if coverage < fail_below:
        return _quality_check(
            name,
            "fail",
            f"{name} is below {fail_below:.0f}%; collect this field more consistently.",
            coverage,
        )
    if coverage < warn_below:
        return _quality_check(
            name,
            "warn",
            f"{name} is usable but incomplete; improve coverage before relying on model features.",
            coverage,
        )
    return _quality_check(
        name,
        "pass",
        f"{name} is high enough for baseline model features.",
        coverage,
    )


def _asset_mixing_check(summary: dict[str, Any]) -> dict[str, Any]:
    asset_mix = summary.get("asset_mix") if isinstance(summary.get("asset_mix"), dict) else {}
    nonzero_assets = [asset for asset, count in asset_mix.items() if isinstance(count, int) and count > 0]
    value = {asset: asset_mix.get(asset, 0) for asset in nonzero_assets}

    if len(nonzero_assets) > 1:
        return _quality_check(
            "Asset Mixing",
            "warn",
            "Dataset contains multiple asset types; train separate models or include asset-aware validation.",
            value,
        )

    return _quality_check(
        "Asset Mixing",
        "pass",
        "Dataset is single-asset-type or empty, so asset mixing is not a training risk.",
        value,
    )


def _edgar_coverage_check(edgar_summary: dict[str, Any]) -> dict[str, Any]:
    coverage = _to_float(edgar_summary.get("coverage")) or 0
    if coverage < 50:
        return _quality_check(
            "EDGAR Coverage",
            "warn",
            "EDGAR coverage is below 50%; use EDGAR fields as sparse context only.",
            coverage,
        )
    return _quality_check(
        "EDGAR Coverage",
        "pass",
        "EDGAR coverage is above 50% for supported US stock rows.",
        coverage,
    )


def _leakage_safety_check(edgar_summary: dict[str, Any]) -> dict[str, Any]:
    if edgar_summary.get("enabled") is not True:
        return _quality_check(
            "Leakage Safety",
            "pass",
            "EDGAR is disabled, so EDGAR-based future leakage is not present.",
            {"edgar_enabled": False},
        )
    if edgar_summary.get("point_in_time") is True:
        return _quality_check(
            "Leakage Safety",
            "pass",
            "EDGAR fields are point-in-time filtered by trade date.",
            {"edgar_enabled": True, "point_in_time": True},
        )
    return _quality_check(
        "Leakage Safety",
        "fail",
        "EDGAR is enabled without point-in-time filtering; this can leak future data.",
        {"edgar_enabled": True, "point_in_time": False},
    )


def _quality_check(name: str, status: str, message: str, value: Any) -> dict[str, Any]:
    return {
        "name": name,
        "status": status,
        "message": message,
        "value": value,
    }


def _coverage_pct_from_summary(summary: dict[str, Any], key: str) -> float:
    label_coverage = summary.get("label_coverage") if isinstance(summary.get("label_coverage"), dict) else {}
    item = label_coverage.get(key) if isinstance(label_coverage.get(key), dict) else {}
    return float(item.get("coverage_pct") or 0)


def _quality_score(checks: list[dict[str, Any]]) -> int:
    if not checks:
        return 0
    status_points = {"pass": 1.0, "warn": 0.5, "fail": 0.0}
    weights = {
        "Total Rows": 50.0,
        "Class Balance": 20.0,
        "Setup Tag Coverage": 5.0,
        "Mistake Tag Coverage": 5.0,
        "Planned Risk/Reward Coverage": 5.0,
        "Rule Followed Coverage": 5.0,
        "Asset Mixing": 5.0,
        "EDGAR Coverage": 2.5,
        "Leakage Safety": 5.0,
    }
    total_weight = sum(weights.get(str(check.get("name")), 5.0) for check in checks)
    if total_weight <= 0:
        return 0
    earned = sum(
        weights.get(str(check.get("name")), 5.0) * status_points.get(str(check.get("status")), 0.0)
        for check in checks
    )
    return int(round((earned / total_weight) * 100))


def _readiness_level(score: int) -> str:
    if score < 40:
        return "not_ready"
    if score < 60:
        return "basic_analysis_only"
    if score < 80:
        return "baseline_ready"
    return "strong_ready"


def _quality_recommendations(checks: list[dict[str, Any]], readiness_level: str) -> list[str]:
    recommendations: list[str] = []

    if readiness_level == "not_ready":
        recommendations.append("Keep using Trade Intelligence analysis; do not train a model yet.")
    elif readiness_level == "basic_analysis_only":
        recommendations.append("Use this dataset for analysis and labeling improvements before model training.")
    elif readiness_level == "baseline_ready":
        recommendations.append("Dataset is suitable for cautious baseline experiments, not production predictions.")
    else:
        recommendations.append("Dataset is strong enough for baseline experiments with time-based validation.")

    by_name = {str(check.get("name")): check for check in checks}
    if by_name.get("Total Rows", {}).get("status") != "pass":
        recommendations.append("Collect at least 100 trades before trusting personalized model results.")
    if by_name.get("Class Balance", {}).get("status") != "pass":
        recommendations.append("Collect more examples of the underrepresented WIN or LOSS class.")
    if by_name.get("Setup Tag Coverage", {}).get("status") != "pass":
        recommendations.append("Tag setups consistently for future setup-quality modeling.")
    if by_name.get("Mistake Tag Coverage", {}).get("status") != "pass":
        recommendations.append("Record mistake tags after each trade to support mistake classification.")
    if by_name.get("Planned Risk/Reward Coverage", {}).get("status") != "pass":
        recommendations.append("Add planned risk and planned reward before entry for risk-aware training.")
    if by_name.get("Rule Followed Coverage", {}).get("status") != "pass":
        recommendations.append("Record whether each trade followed the plan.")
    if by_name.get("Asset Mixing", {}).get("status") == "warn":
        recommendations.append("Split stock, forex, crypto, and index trades or validate models by asset type.")
    if by_name.get("EDGAR Coverage", {}).get("status") == "warn":
        recommendations.append("Treat EDGAR features as optional context until US-stock coverage improves.")
    if by_name.get("Leakage Safety", {}).get("status") != "pass":
        recommendations.append("Do not use EDGAR features until point-in-time filtering is enabled.")

    return recommendations


def _is_edgar_supported_trade(trade: dict[str, Any]) -> bool:
    symbol = str(trade.get("symbol") or "").strip().upper()
    asset_type = str(trade.get("asset_type") or infer_asset_type(symbol)).lower()
    if asset_type != "stock":
        return False
    if "." in symbol:
        return False
    return bool(re.fullmatch(r"[A-Z]{1,5}", symbol))


def _get_cached_edgar_source(symbol: str, edgar_cache: dict[str, dict[str, Any]]) -> dict[str, Any]:
    if symbol not in edgar_cache:
        try:
            edgar_cache[symbol] = fetch_edgar_source_for_ticker(symbol)
        except Exception:
            edgar_cache[symbol] = {
                "ticker": symbol,
                "cik": None,
                "company_name": None,
                "available": False,
                "submissions": {},
                "companyfacts": {},
                "warnings": [f"EDGAR source lookup failed for {symbol}. Dataset export continued without EDGAR fields."],
            }
    return edgar_cache[symbol]


def _recent_filing_date(filings: list[Any], form: str) -> str | None:
    for filing in filings:
        if isinstance(filing, dict) and filing.get("form") == form:
            return filing.get("filingDate")
    return None


def _fact_value(facts: dict[str, Any], name: str) -> Any:
    fact = facts.get(name)
    if isinstance(fact, dict):
        return fact.get("value")
    return None


def _warning_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item or "").strip()]


def _remember_edgar_warnings(edgar_state: dict[str, Any], warnings: list[str]) -> None:
    bucket = edgar_state.setdefault("warnings", [])
    for warning in _unique_warnings(warnings):
        if warning not in bucket:
            bucket.append(warning)


def _unique_warnings(warnings: list[Any]) -> list[str]:
    unique: list[str] = []
    for warning in warnings:
        text = str(warning or "").strip()
        if text and text not in unique:
            unique.append(text)
    return unique


def _join_warnings(warnings: list[str]) -> str:
    return " | ".join(_unique_warnings(warnings))


def _warnings(rows: list[dict[str, Any]], asset_mix: dict[str, int], label_coverage: dict[str, dict[str, float | int]]) -> list[str]:
    warnings: list[str] = []
    total_rows = len(rows)
    wins = sum(1 for row in rows if row["result"] == "WIN")
    losses = sum(1 for row in rows if row["result"] == "LOSS")
    nonzero_assets = [asset for asset, count in asset_mix.items() if count > 0]

    if total_rows < 30:
        warnings.append("Dataset has fewer than 30 trades; use analysis only or very cautious baseline experiments.")
    if label_coverage["setup_tag"]["coverage_pct"] < 70:
        warnings.append("setup_tag coverage is low; add setup tags before training setup-quality models.")
    if label_coverage["mistake_tag"]["coverage_pct"] < 70:
        warnings.append("mistake_tag coverage is low; mistake classification will be weak.")
    if label_coverage["planned_rr"]["coverage_pct"] < 70:
        warnings.append("planned_risk/planned_reward coverage is low; planned R/R features are incomplete.")
    if len(nonzero_assets) > 1:
        warnings.append("Dataset contains mixed asset types; consider separate models or asset_type-aware validation.")
    if losses < 3:
        warnings.append("Dataset has too few losses for reliable risk or weakness modeling.")
    if wins < 3:
        warnings.append("Dataset has too few wins for reliable success-pattern modeling.")

    return warnings


def _dataset_actual_rr(trades: list[dict[str, Any]]) -> float | None:
    wins = [trade["pnl"] for trade in trades if trade["result"] == "WIN" and trade["pnl"] is not None and trade["pnl"] > 0]
    losses = [trade["pnl"] for trade in trades if trade["result"] == "LOSS" and trade["pnl"] is not None and trade["pnl"] < 0]
    if not wins or not losses:
        return None
    avg_win = sum(wins) / len(wins)
    avg_loss = sum(losses) / len(losses)
    if avg_win <= 0 or avg_loss >= 0:
        return None
    return round(abs(avg_win / avg_loss), 4)


def _pnl_bucket(pnl: float | None, pnl_pct: float | None) -> str:
    value = pnl_pct if pnl_pct is not None else pnl
    if value is None:
        return "flat"
    if value <= -2:
        return "large_loss"
    if value < -0.1:
        return "small_loss"
    if value <= 0.1:
        return "flat"
    if value < 2:
        return "small_win"
    return "large_win"


def _date_parts(value: str) -> dict[str, str | None]:
    parsed = _parse_date(value)
    if not parsed:
        return {"day_of_week": None, "month": None}
    return {"day_of_week": parsed.strftime("%A"), "month": parsed.strftime("%B")}


def _parse_date(value: str) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    for candidate in (text, text[:10]):
        try:
            return datetime.fromisoformat(candidate)
        except ValueError:
            continue
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%m/%d/%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def _is_usable_row(row: dict[str, Any]) -> bool:
    return (
        row["result_binary"] is not None
        and _positive(row["entry_price"])
        and _positive(row["exit_price"])
        and _positive(row["quantity"])
    )


def _coverage(total: int, count: int) -> dict[str, float | int]:
    return {
        "count": count,
        "coverage_pct": round((count / total) * 100, 1) if total else 0,
    }


def _first(source: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key in source:
            return source[key]
    return default


def _clean_optional_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def _to_float(value: Any) -> float | None:
    if value in ("", None):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def _to_int(value: Any, minimum: int | None = None, maximum: int | None = None) -> int | None:
    number = _to_float(value)
    if number is None or not number.is_integer():
        return None
    result = int(number)
    if minimum is not None and result < minimum:
        return None
    if maximum is not None and result > maximum:
        return None
    return result


def _to_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "yes", "y", "1"}:
            return True
        if lowered in {"false", "no", "n", "0"}:
            return False
    if value in (1, 0):
        return bool(value)
    return None


def _positive(value: Any) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(value) and value > 0


def _round_or_none(value: float | None) -> float | None:
    return round(value, 4) if value is not None else None
