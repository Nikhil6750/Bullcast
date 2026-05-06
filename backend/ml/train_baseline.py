from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import joblib
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.compose import ColumnTransformer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    confusion_matrix,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from backend.ml.feature_schema import (
    build_input_column_lists,
    choose_target_column,
    make_feature_schema,
)
from backend.ml.leakage_guard import (
    LeakageGuardError,
    collect_warnings,
    validate_edgar_safety,
    validate_no_forbidden_inputs,
    validate_quality_gate,
    validate_rows,
    validate_target,
)


DEFAULT_OUTPUT_DIR = Path("backend/models")


def train_from_export(
    exported_dataset: dict[str, Any],
    *,
    output_dir: str | Path = DEFAULT_OUTPUT_DIR,
    requested_target: str | None = None,
    test_fraction: float = 0.25,
) -> dict[str, Any]:
    quality_gate = validate_quality_gate(exported_dataset)
    rows = validate_rows(exported_dataset.get("rows") if isinstance(exported_dataset, dict) else None)
    summary = exported_dataset.get("summary") if isinstance(exported_dataset.get("summary"), dict) else {}

    target_column = choose_target_column(rows, requested_target)
    validate_target(rows, target_column)

    selected_columns, categorical_columns, numeric_columns, text_columns = build_input_column_lists(
        rows,
        target_column,
    )
    validate_no_forbidden_inputs(selected_columns)

    edgar_enabled, edgar_point_in_time = validate_edgar_safety(
        selected_input_columns=selected_columns,
        summary=summary,
    )

    dataframe = pd.DataFrame(rows)
    dataframe = dataframe[dataframe[target_column].notna()].copy()
    dataframe = dataframe[dataframe[target_column] != ""].copy()

    if "date" in dataframe.columns:
        dataframe["_parsed_date"] = pd.to_datetime(dataframe["date"], errors="coerce")
        dataframe = dataframe.sort_values(["_parsed_date", "date"], na_position="last")
    else:
        dataframe["_parsed_date"] = pd.NaT

    if len(dataframe) < 30:
        raise LeakageGuardError("Training blocked. At least 30 labeled rows are required.")

    split_index = int(len(dataframe) * (1 - test_fraction))
    split_index = max(1, min(split_index, len(dataframe) - 1))

    train_df = dataframe.iloc[:split_index].copy()
    test_df = dataframe.iloc[split_index:].copy()

    if train_df[target_column].nunique(dropna=True) < 2:
        raise LeakageGuardError("Training split has fewer than two target classes. Training blocked.")

    x_train = _prepare_features(train_df, selected_columns)
    y_train = train_df[target_column]
    x_test = _prepare_features(test_df, selected_columns)
    y_test = test_df[target_column]

    pipeline = _build_pipeline(
        categorical_columns=categorical_columns,
        numeric_columns=numeric_columns,
        text_columns=text_columns,
    )
    pipeline.fit(x_train, y_train)

    predictions = pipeline.predict(x_test)
    probabilities = _positive_class_probabilities(pipeline, x_test)
    metrics = _evaluate_model(y_test, predictions, probabilities, pipeline.classes_)

    schema = make_feature_schema(
        selected_input_columns=selected_columns,
        categorical_columns=categorical_columns,
        numeric_columns=numeric_columns,
        text_columns=text_columns,
        target_column=target_column,
        quality_gate=quality_gate,
        dataset_row_count=len(dataframe),
        train_start_date=_date_boundary(train_df, first=True),
        train_end_date=_date_boundary(train_df, first=False),
        test_start_date=_date_boundary(test_df, first=True),
        test_end_date=_date_boundary(test_df, first=False),
        edgar_enabled=edgar_enabled,
        edgar_point_in_time_verified=edgar_point_in_time,
    )

    report = {
        "status": "trained",
        "model_type": "LogisticRegression",
        "model_version": "baseline_v1",
        "target_column": target_column,
        "target_note": _target_note(target_column),
        "dataset_rows": len(dataframe),
        "train_rows": len(train_df),
        "test_rows": len(test_df),
        "selected_input_columns": selected_columns,
        "metrics": metrics,
        "quality_gate": quality_gate,
        "warnings": collect_warnings(rows, summary),
    }

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    model_path = output_path / "baseline_trade_quality_model.joblib"
    schema_path = output_path / "baseline_feature_schema.json"
    report_path = output_path / "baseline_training_report.json"

    joblib.dump(pipeline, model_path)
    schema_path.write_text(json.dumps(schema.to_dict(), indent=2), encoding="utf-8")

    report["artifacts"] = {
        "model": str(model_path),
        "feature_schema": str(schema_path),
        "training_report": str(report_path),
    }
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    return report


def _build_pipeline(
    *,
    categorical_columns: list[str],
    numeric_columns: list[str],
    text_columns: list[str],
) -> Pipeline:
    transformers = []

    if categorical_columns:
        transformers.append(
            (
                "categorical",
                Pipeline(
                    steps=[
                        ("clean", _CategoricalCleaner()),
                        ("onehot", OneHotEncoder(handle_unknown="ignore")),
                    ]
                ),
                categorical_columns,
            )
        )

    if numeric_columns:
        transformers.append(
            (
                "numeric",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="median")),
                        ("scaler", StandardScaler()),
                    ]
                ),
                numeric_columns,
            )
        )

    if text_columns:
        transformers.append(
            (
                "entry_reason_text",
                Pipeline(
                    steps=[
                        ("imputer", SimpleImputer(strategy="constant", fill_value="")),
                        ("flatten", _TextColumnFlattener()),
                        ("tfidf", TfidfVectorizer(max_features=100, ngram_range=(1, 2))),
                    ]
                ),
                text_columns,
            )
        )

    if not transformers:
        raise LeakageGuardError("No valid input features selected. Training blocked.")

    preprocessor = ColumnTransformer(transformers=transformers)
    return Pipeline(
        steps=[
            ("preprocessor", preprocessor),
            (
                "model",
                LogisticRegression(
                    max_iter=1000,
                    class_weight="balanced",
                    solver="lbfgs",
                ),
            ),
        ]
    )


class _CategoricalCleaner(BaseEstimator, TransformerMixin):
    missing_token = "__missing__"

    def fit(self, x: Any, y: Any = None) -> "_CategoricalCleaner":
        return self

    def transform(self, x: Any) -> pd.DataFrame:
        if hasattr(x, "copy") and hasattr(x, "columns"):
            frame = x.copy()
        else:
            frame = pd.DataFrame(x)

        frame = frame.astype("object")
        frame = frame.where(pd.notna(frame), self.missing_token)
        frame = frame.replace("", self.missing_token)
        return frame.astype(str)


class _TextColumnFlattener(BaseEstimator, TransformerMixin):
    def fit(self, x: Any, y: Any = None) -> "_TextColumnFlattener":
        return self

    def transform(self, x: Any) -> list[str]:
        if hasattr(x, "iloc"):
            return x.iloc[:, 0].fillna("").astype(str).tolist()

        flattened: list[str] = []
        for item in x:
            if isinstance(item, (list, tuple)):
                value = item[0] if item else ""
            elif hasattr(item, "tolist"):
                values = item.tolist()
                value = values[0] if isinstance(values, list) and values else values
            else:
                value = item
            flattened.append("" if value is None else str(value))
        return flattened


def _prepare_features(dataframe: pd.DataFrame, selected_columns: list[str]) -> pd.DataFrame:
    features = dataframe.copy()
    for column in selected_columns:
        if column not in features.columns:
            features[column] = None
    return features[selected_columns]


def _positive_class_probabilities(pipeline: Pipeline, x_test: pd.DataFrame) -> list[float] | None:
    if not hasattr(pipeline, "predict_proba"):
        return None

    classes = list(pipeline.classes_)
    if len(classes) != 2:
        return None

    positive_class = _positive_class(classes)
    positive_index = classes.index(positive_class)
    return pipeline.predict_proba(x_test)[:, positive_index].tolist()


def _evaluate_model(
    y_true: pd.Series,
    predictions: Any,
    probabilities: list[float] | None,
    classes: Any,
) -> dict[str, Any]:
    class_list = list(classes)
    binary_numeric = set(class_list).issubset({0, 1, False, True}) and len(class_list) == 2
    average = "binary" if binary_numeric else "weighted"

    metrics: dict[str, Any] = {
        "accuracy": round(float(accuracy_score(y_true, predictions)), 4),
        "precision": round(float(precision_score(y_true, predictions, average=average, zero_division=0)), 4),
        "recall": round(float(recall_score(y_true, predictions, average=average, zero_division=0)), 4),
        "confusion_matrix": confusion_matrix(y_true, predictions).tolist(),
    }

    if probabilities is not None and len(set(y_true.dropna().tolist())) == 2:
        try:
            metrics["roc_auc"] = round(float(roc_auc_score(y_true, probabilities)), 4)
        except ValueError:
            metrics["roc_auc"] = None

        try:
            binary_y_true = _binary_target_values(y_true, _positive_class(class_list))
            metrics["brier_score"] = round(float(brier_score_loss(binary_y_true, probabilities)), 4)
        except ValueError:
            metrics["brier_score"] = None
    else:
        metrics["roc_auc"] = None
        metrics["brier_score"] = None

    return metrics


def _positive_class(classes: list[Any]) -> Any:
    if 1 in classes:
        return 1
    if True in classes:
        return True
    return classes[-1]


def _binary_target_values(y_true: pd.Series, positive_class: Any) -> list[int]:
    return [1 if value == positive_class else 0 for value in y_true.tolist()]


def _date_boundary(dataframe: pd.DataFrame, *, first: bool) -> str | None:
    if "date" not in dataframe.columns or dataframe.empty:
        return None

    values = dataframe["date"].dropna().astype(str).tolist()
    if not values:
        return None

    return values[0] if first else values[-1]


def _target_note(target_column: str) -> str:
    if target_column == "risk_bucket":
        return "Preferred target for trade risk classification."
    if target_column == "high_quality_trade":
        return "Process-quality target. Better than raw profit when labels are reliable."
    if target_column == "result_binary":
        return (
            "Experimental fallback target. Profit outcome is noisy and should not be "
            "treated as direct prediction quality."
        )
    return "Custom target selected."


def load_exported_dataset(path: str | Path) -> dict[str, Any]:
    dataset_path = Path(path)
    return json.loads(dataset_path.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Train Bullcast baseline trade quality model.")
    parser.add_argument("--dataset-file", required=True, help="Path to exported Bullcast dataset JSON.")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR), help="Directory for model artifacts.")
    parser.add_argument("--target", default=None, help="Optional target column override.")
    args = parser.parse_args()

    exported_dataset = load_exported_dataset(args.dataset_file)
    try:
        report = train_from_export(
            exported_dataset,
            output_dir=args.output_dir,
            requested_target=args.target,
        )
    except LeakageGuardError as error:
        print(json.dumps({"status": "blocked", "reason": str(error)}, indent=2))
        return

    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
