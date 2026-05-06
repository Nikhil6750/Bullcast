from __future__ import annotations

from typing import Any

from backend.ml.feature_schema import FORBIDDEN_INPUT_COLUMNS, READY_LEVELS


class LeakageGuardError(ValueError):
    pass


def validate_quality_gate(exported_dataset: dict[str, Any]) -> dict[str, Any]:
    quality_gate = exported_dataset.get("quality_gate") if isinstance(exported_dataset, dict) else None

    if not isinstance(quality_gate, dict):
        raise LeakageGuardError("Missing quality_gate. Training blocked.")

    readiness_level = str(quality_gate.get("readiness_level") or "")
    if readiness_level not in READY_LEVELS:
        raise LeakageGuardError(
            f"Training blocked. quality_gate.readiness_level is '{readiness_level}', "
            "but it must be 'baseline_ready' or 'strong_ready'."
        )

    if quality_gate.get("ready_for_training") is not True:
        raise LeakageGuardError("Training blocked. quality_gate.ready_for_training is not true.")

    return quality_gate


def validate_rows(rows: Any) -> list[dict[str, Any]]:
    if not isinstance(rows, list):
        raise LeakageGuardError("Dataset rows must be a list.")

    clean_rows = [row for row in rows if isinstance(row, dict)]
    if not clean_rows:
        raise LeakageGuardError("Dataset has no usable rows. Training blocked.")

    return clean_rows


def validate_target(rows: list[dict[str, Any]], target_column: str) -> None:
    if not target_column:
        raise LeakageGuardError("Target column is missing.")

    if not any(target_column in row for row in rows):
        raise LeakageGuardError(f"Target column '{target_column}' is missing from dataset rows.")

    values = [
        row.get(target_column)
        for row in rows
        if row.get(target_column) is not None and row.get(target_column) != ""
    ]
    if len(set(values)) < 2:
        raise LeakageGuardError(
            f"Target column '{target_column}' has fewer than two classes. Training blocked."
        )


def validate_no_forbidden_inputs(selected_input_columns: list[str]) -> None:
    selected = set(selected_input_columns)
    leaked = sorted(selected.intersection(FORBIDDEN_INPUT_COLUMNS))

    if leaked:
        raise LeakageGuardError(
            "Forbidden leakage columns selected as model inputs: " + ", ".join(leaked)
        )


def validate_edgar_safety(
    *,
    selected_input_columns: list[str],
    summary: dict[str, Any],
) -> tuple[bool, bool]:
    edgar_columns_selected = any(column.startswith("edgar_") for column in selected_input_columns)

    edgar_summary = summary.get("edgar") if isinstance(summary.get("edgar"), dict) else {}
    edgar_enabled = edgar_summary.get("enabled") is True
    edgar_point_in_time = edgar_summary.get("point_in_time") is True

    if edgar_columns_selected and not edgar_enabled:
        raise LeakageGuardError("EDGAR input columns were selected, but EDGAR summary is not enabled.")

    if edgar_columns_selected and not edgar_point_in_time:
        raise LeakageGuardError(
            "EDGAR input columns were selected without verified point-in-time filtering."
        )

    return edgar_enabled, edgar_point_in_time


def collect_warnings(rows: list[dict[str, Any]], summary: dict[str, Any]) -> list[str]:
    warnings: list[str] = []

    asset_mix = summary.get("asset_mix") if isinstance(summary.get("asset_mix"), dict) else {}
    nonzero_assets = [
        asset
        for asset, count in asset_mix.items()
        if isinstance(count, int) and count > 0
    ]
    if len(nonzero_assets) > 1:
        warnings.append("Dataset contains multiple asset types. Review model performance by asset type.")

    if len(rows) < 120:
        warnings.append("Small dataset. Treat baseline metrics as experimental.")

    edgar_summary = summary.get("edgar") if isinstance(summary.get("edgar"), dict) else {}
    if edgar_summary.get("enabled") is True:
        coverage = float(edgar_summary.get("coverage") or 0)
        if coverage < 50:
            warnings.append("EDGAR coverage is below 50%. EDGAR features may be sparse.")

    return warnings
