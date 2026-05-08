from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_OLD_SUMMARY = Path("trading-ui/public/generated-journal-trades-summary.json")
DEFAULT_OLD_STATS = Path("trading-ui/public/generated-journal-trades-statistics.json")
DEFAULT_LATEST_SUMMARY = Path("trading-ui/public/generated-journal-trades-latest-summary.json")
DEFAULT_LATEST_STATS = Path("trading-ui/public/generated-journal-trades-latest-statistics.json")
DEFAULT_OUTPUT = Path("trading-ui/public/generated-journal-trades-comparison.json")


def build_comparison(
    old_summary_path: str | Path = DEFAULT_OLD_SUMMARY,
    old_stats_path: str | Path = DEFAULT_OLD_STATS,
    latest_summary_path: str | Path = DEFAULT_LATEST_SUMMARY,
    latest_stats_path: str | Path = DEFAULT_LATEST_STATS,
) -> dict[str, Any]:
    old_summary = _read_json(old_summary_path)
    old_stats = _read_json(old_stats_path)
    latest_summary = _read_json(latest_summary_path)
    latest_stats = _read_json(latest_stats_path)

    old = _dataset_block("old", old_summary, old_stats)
    latest = _dataset_block("latest", latest_summary, latest_stats)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "strategy": latest_stats.get("strategy") or old_stats.get("strategy"),
        "old": old,
        "latest": latest,
        "delta": _delta_block(old, latest),
        "disclaimer": "Generated rows are simulated from OHLC structure and are not real trading history.",
    }


def write_comparison_report(
    output_path: str | Path = DEFAULT_OUTPUT,
    *,
    old_summary_path: str | Path = DEFAULT_OLD_SUMMARY,
    old_stats_path: str | Path = DEFAULT_OLD_STATS,
    latest_summary_path: str | Path = DEFAULT_LATEST_SUMMARY,
    latest_stats_path: str | Path = DEFAULT_LATEST_STATS,
) -> dict[str, Any]:
    report = build_comparison(
        old_summary_path=old_summary_path,
        old_stats_path=old_stats_path,
        latest_summary_path=latest_summary_path,
        latest_stats_path=latest_stats_path,
    )
    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    return report


def _dataset_block(label: str, summary: dict[str, Any], stats: dict[str, Any]) -> dict[str, Any]:
    files = summary.get("files") if isinstance(summary.get("files"), list) else []
    return {
        "label": label,
        "input_files": int(stats.get("input_files") or len(files)),
        "total_candles": int(stats.get("total_input_candles") or 0),
        "valid_candles": int(stats.get("valid_candles") or 0),
        "malformed_candles": int(stats.get("malformed_candles") or 0),
        "setups_detected": int(stats.get("total_setups_found") or 0),
        "valid_setups": int(stats.get("valid_setups") or 0),
        "invalid_setups": int(stats.get("invalid_setups") or 0),
        "trades_generated": int(stats.get("simulated_trades_generated") or 0),
        "win_rate": _round(stats.get("win_rate")),
        "loss_rate": _round(stats.get("loss_rate")),
        "average_rr": _round(stats.get("average_rr"), digits=4),
        "average_hold_duration": _round(stats.get("average_hold_duration"), digits=4),
        "top_symbols": _top_symbols(files),
        "mistake_distribution": _sorted_distribution(stats.get("mistake_distribution")),
    }


def _delta_block(old: dict[str, Any], latest: dict[str, Any]) -> dict[str, Any]:
    numeric_fields = [
        "input_files",
        "total_candles",
        "valid_candles",
        "malformed_candles",
        "setups_detected",
        "valid_setups",
        "invalid_setups",
        "trades_generated",
        "win_rate",
        "loss_rate",
        "average_rr",
        "average_hold_duration",
    ]
    return {field: _round(float(latest.get(field) or 0) - float(old.get(field) or 0), digits=4) for field in numeric_fields}


def _top_symbols(files: list[dict[str, Any]], limit: int = 10) -> list[dict[str, Any]]:
    rows = []
    for item in files:
        rows.append(
            {
                "symbol": item.get("symbol"),
                "trades_generated": int(item.get("simulated_trades") or item.get("valid_setups") or 0),
                "setups_found": int(item.get("setups_found") or 0),
                "valid_candles": int(item.get("valid_candles") or 0),
            }
        )
    return sorted(rows, key=lambda row: (row["trades_generated"], row["setups_found"]), reverse=True)[:limit]


def _sorted_distribution(value: Any) -> dict[str, int]:
    if not isinstance(value, dict):
        return {}
    rows = sorted(value.items(), key=lambda item: int(item[1] or 0), reverse=True)
    return {str(key): int(count or 0) for key, count in rows}


def _read_json(path: str | Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _round(value: Any, *, digits: int = 2) -> float:
    try:
        return round(float(value or 0), digits)
    except (TypeError, ValueError):
        return 0.0


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare old vs latest generated Bullcast journal datasets.")
    parser.add_argument("--old-summary", default=str(DEFAULT_OLD_SUMMARY))
    parser.add_argument("--old-statistics", default=str(DEFAULT_OLD_STATS))
    parser.add_argument("--latest-summary", default=str(DEFAULT_LATEST_SUMMARY))
    parser.add_argument("--latest-statistics", default=str(DEFAULT_LATEST_STATS))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    args = parser.parse_args()

    report = write_comparison_report(
        args.output,
        old_summary_path=args.old_summary,
        old_stats_path=args.old_statistics,
        latest_summary_path=args.latest_summary,
        latest_stats_path=args.latest_statistics,
    )
    latest = report["latest"]
    delta = report["delta"]
    print(
        f"Latest trades: {latest['trades_generated']} "
        f"({delta['trades_generated']:+.0f} vs old). "
        f"Latest win rate: {latest['win_rate']}%. "
        f"Report: {args.output}"
    )


if __name__ == "__main__":
    main()
