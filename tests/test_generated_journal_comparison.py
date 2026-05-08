from __future__ import annotations

import json
from pathlib import Path

from backend.datasets.compare_generated_journals import build_comparison, write_comparison_report


def _write_json(path: Path, payload: dict) -> Path:
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_generated_journal_comparison_report(tmp_path: Path):
    old_summary = _write_json(
        tmp_path / "old-summary.json",
        {
            "files": [
                {"symbol": "NIFTY", "simulated_trades": 4, "setups_found": 10, "valid_candles": 100},
                {"symbol": "BTCUSDT", "simulated_trades": 8, "setups_found": 12, "valid_candles": 120},
            ]
        },
    )
    latest_summary = _write_json(
        tmp_path / "latest-summary.json",
        {
            "files": [
                {"symbol": "NIFTY", "simulated_trades": 9, "setups_found": 15, "valid_candles": 110},
                {"symbol": "EURUSD", "simulated_trades": 3, "setups_found": 5, "valid_candles": 80},
            ]
        },
    )
    old_stats = _write_json(
        tmp_path / "old-stats.json",
        {
            "strategy": "Streak Pullback Confirmation",
            "input_files": 2,
            "total_input_candles": 220,
            "valid_candles": 220,
            "total_setups_found": 22,
            "valid_setups": 12,
            "invalid_setups": 10,
            "simulated_trades_generated": 12,
            "win_rate": 25.0,
            "average_rr": -0.5,
            "mistake_distribution": {"none": 10, "revenge trade": 2},
        },
    )
    latest_stats = _write_json(
        tmp_path / "latest-stats.json",
        {
            "strategy": "Streak Pullback Confirmation",
            "input_files": 2,
            "total_input_candles": 190,
            "valid_candles": 190,
            "total_setups_found": 20,
            "valid_setups": 12,
            "invalid_setups": 8,
            "simulated_trades_generated": 12,
            "win_rate": 50.0,
            "average_rr": 0.25,
            "mistake_distribution": {"none": 7, "weak confirmation": 5},
        },
    )

    report = build_comparison(old_summary, old_stats, latest_summary, latest_stats)

    assert report["old"]["trades_generated"] == 12
    assert report["latest"]["win_rate"] == 50.0
    assert report["delta"]["win_rate"] == 25.0
    assert report["latest"]["top_symbols"][0]["symbol"] == "NIFTY"
    assert report["latest"]["mistake_distribution"] == {"none": 7, "weak confirmation": 5}


def test_write_generated_journal_comparison_report(tmp_path: Path):
    old_summary = _write_json(tmp_path / "old-summary.json", {"files": []})
    latest_summary = _write_json(tmp_path / "latest-summary.json", {"files": []})
    old_stats = _write_json(tmp_path / "old-stats.json", {"simulated_trades_generated": 1})
    latest_stats = _write_json(tmp_path / "latest-stats.json", {"simulated_trades_generated": 3})
    output = tmp_path / "comparison.json"

    write_comparison_report(
        output,
        old_summary_path=old_summary,
        old_stats_path=old_stats,
        latest_summary_path=latest_summary,
        latest_stats_path=latest_stats,
    )

    report = json.loads(output.read_text(encoding="utf-8"))
    assert report["delta"]["trades_generated"] == 2.0
