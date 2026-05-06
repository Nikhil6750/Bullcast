from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any


READY_LEVELS = {"baseline_ready", "strong_ready"}

TARGET_PRIORITY = [
    "risk_bucket",
    "high_quality_trade",
    "result_binary",
]

FORBIDDEN_INPUT_COLUMNS = {
    "exit_price",
    "pnl",
    "pnl_pct",
    "result",
    "result_binary",
    "actual_rr",
    "exit_reason",
    "pnl_bucket",
    "mistake_tag",
    "notes",
}

DIAGNOSTIC_COLUMNS = {
    "trade_id",
    "date",
    "edgar_warnings",
    "edgar_as_of_date",
    "edgar_cik",
    "edgar_company_name",
}

CATEGORICAL_INPUT_COLUMNS = [
    "asset_type",
    "symbol",
    "direction",
    "setup_tag",
    "rule_followed",
    "day_of_week",
    "month",
]

NUMERIC_INPUT_COLUMNS = [
    "entry_price",
    "quantity",
    "confidence_score",
    "planned_risk",
    "planned_reward",
    "planned_rr",
    "is_stock",
    "is_forex",
    "is_crypto",
    "is_index",
    "has_setup_tag",
    "has_plan",
    "has_notes",
    "edgar_available",
    "edgar_revenues",
    "edgar_net_income",
    "edgar_assets",
    "edgar_liabilities",
    "edgar_equity",
    "edgar_cash",
    "edgar_operating_cash_flow",
    "edgar_eps_diluted",
]

TEXT_INPUT_COLUMNS = [
    "entry_reason",
]


@dataclass(frozen=True)
class FeatureSchema:
    selected_input_columns: list[str]
    categorical_columns: list[str]
    numeric_columns: list[str]
    text_columns: list[str]
    forbidden_leakage_columns: list[str]
    target_column: str
    training_timestamp: str
    quality_gate: dict[str, Any]
    dataset_row_count: int
    train_start_date: str | None
    train_end_date: str | None
    test_start_date: str | None
    test_end_date: str | None
    edgar_enabled: bool
    edgar_point_in_time_verified: bool
    model_type: str
    model_version: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def choose_target_column(rows: list[dict[str, Any]], requested_target: str | None = None) -> str:
    candidates = [requested_target] if requested_target else TARGET_PRIORITY

    for target in candidates:
        if not target:
            continue
        values = [
            row.get(target)
            for row in rows
            if row.get(target) is not None and row.get(target) != ""
        ]
        if len(set(values)) >= 2:
            return target

    raise ValueError(
        "No usable target column found. Need at least two classes in one of: "
        + ", ".join(TARGET_PRIORITY)
    )


def build_input_column_lists(
    rows: list[dict[str, Any]],
    target_column: str,
) -> tuple[list[str], list[str], list[str], list[str]]:
    available_columns: set[str] = set()
    for row in rows:
        available_columns.update(row.keys())

    forbidden = set(FORBIDDEN_INPUT_COLUMNS)
    forbidden.add(target_column)

    categorical = [
        column
        for column in CATEGORICAL_INPUT_COLUMNS
        if column in available_columns and column not in forbidden
    ]
    numeric = [
        column
        for column in NUMERIC_INPUT_COLUMNS
        if column in available_columns and column not in forbidden
    ]
    text = [
        column
        for column in TEXT_INPUT_COLUMNS
        if column in available_columns and column not in forbidden
    ]

    selected = categorical + numeric + text
    return selected, categorical, numeric, text


def make_feature_schema(
    *,
    selected_input_columns: list[str],
    categorical_columns: list[str],
    numeric_columns: list[str],
    text_columns: list[str],
    target_column: str,
    quality_gate: dict[str, Any],
    dataset_row_count: int,
    train_start_date: str | None,
    train_end_date: str | None,
    test_start_date: str | None,
    test_end_date: str | None,
    edgar_enabled: bool,
    edgar_point_in_time_verified: bool,
) -> FeatureSchema:
    return FeatureSchema(
        selected_input_columns=selected_input_columns,
        categorical_columns=categorical_columns,
        numeric_columns=numeric_columns,
        text_columns=text_columns,
        forbidden_leakage_columns=sorted(FORBIDDEN_INPUT_COLUMNS),
        target_column=target_column,
        training_timestamp=datetime.now(timezone.utc).isoformat(),
        quality_gate=quality_gate,
        dataset_row_count=dataset_row_count,
        train_start_date=train_start_date,
        train_end_date=train_end_date,
        test_start_date=test_start_date,
        test_end_date=test_end_date,
        edgar_enabled=edgar_enabled,
        edgar_point_in_time_verified=edgar_point_in_time_verified,
        model_type="LogisticRegression",
        model_version="baseline_v1",
    )
