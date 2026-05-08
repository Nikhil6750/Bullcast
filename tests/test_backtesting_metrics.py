from __future__ import annotations

from backend.backtesting.metrics import calculate_metrics


def test_symbol_backtest_metrics_include_consistent_core_fields():
    trades = [
        {"pnl": 100.0},
        {"pnl": -50.0},
        {"pnl": 200.0},
    ]
    equity_curve = [
        {"time": 1, "equity": 1000.0},
        {"time": 2, "equity": 950.0},
        {"time": 3, "equity": 1250.0},
    ]

    metrics = calculate_metrics(trades, equity_curve, 1000.0)

    assert metrics["total_trades"] == 3
    assert metrics["winning_trades"] == 2
    assert metrics["losing_trades"] == 1
    assert metrics["win_rate"] == 66.67
    assert metrics["loss_rate"] == 33.33
    assert metrics["total_pnl"] == 250.0
    assert metrics["net_pnl"] == 250.0
    assert metrics["profit_factor"] == 6.0
    assert metrics["average_rr"] == 3.0
    assert metrics["avg_rr"] == 3.0
    assert metrics["max_drawdown"] == 5.0


def test_symbol_backtest_empty_metrics_keep_same_shape():
    metrics = calculate_metrics([], [], 1000.0)

    for key in [
        "total_trades",
        "win_rate",
        "loss_rate",
        "total_pnl",
        "net_pnl",
        "max_drawdown",
        "profit_factor",
        "average_rr",
        "avg_rr",
    ]:
        assert key in metrics
