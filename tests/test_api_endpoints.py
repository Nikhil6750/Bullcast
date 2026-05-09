from fastapi.testclient import TestClient

import backend.intelligence.context as intelligence_context
import backend.server as server


client = TestClient(server.app)


def sample_trades():
    return [
        {
            "date": "2026-02-01",
            "symbol": "EURUSD",
            "type": "LONG",
            "entry_price": 1.08,
            "exit_price": 1.09,
            "quantity": 1000,
            "pnl": 10,
            "result": "WIN",
            "setup_tag": "Pattern Alert",
            "mistake_tag": "none",
            "confidence_score": 4,
            "planned_risk": 5,
            "planned_reward": 10,
            "rule_followed": True,
            "notes": "Clean continuation setup.",
        },
        {
            "date": "2026-02-02",
            "symbol": "EURUSD",
            "type": "SHORT",
            "entry_price": 1.1,
            "exit_price": 1.105,
            "quantity": 1000,
            "pnl": -5,
            "result": "LOSS",
            "setup_tag": "Streak Pullback Confirmation",
            "mistake_tag": "late_entry",
            "confidence_score": 3,
            "planned_risk": 5,
            "planned_reward": 8,
            "rule_followed": False,
            "notes": "Entered late after confirmation weakened.",
        },
    ]


def sample_candles(count=60):
    return [
        {
            "time": index,
            "open": 100 + index,
            "high": 101 + index,
            "low": 99 + index,
            "close": 100.5 + index,
            "volume": 1000 + index,
        }
        for index in range(count)
    ]


def test_health_endpoint_returns_ok():
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_journal_summary_endpoint_returns_gemini_missing_key_fallback(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    response = client.post(
        "/api/intelligence/journal-summary",
        json={"trades": sample_trades(), "limit": 10},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["provider"] == "gemini"
    assert payload["llm_enabled"] is False
    assert payload["llm_summary"] is None
    assert payload["warnings"] == [
        "Gemini summary unavailable because GEMINI_API_KEY is not configured"
    ]
    assert payload["deterministic_summary"]["trade_count"] == 2
    assert payload["deterministic_summary"]["source"] == "deterministic_journal_analytics"


def test_intelligence_analyze_endpoint_returns_deterministic_analysis(monkeypatch):
    monkeypatch.setattr(
        intelligence_context,
        "fetch_quote",
        lambda _symbol: {
            "current_price": 1.1,
            "change_pct": 0.2,
            "high": 1.11,
            "low": 1.08,
        },
    )

    response = client.post(
        "/api/intelligence/analyze",
        json={"trades": sample_trades()},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["llm_available"] is False
    assert payload["rag_available"] is False
    assert payload["model"] == "keyword-fallback"
    assert payload["basic_stats"]["total_trades"] == 2
    assert payload["trader_profile"]["sample_size"] == 2
    assert payload["context_summary"]["market_coverage"] == 100.0


def test_backtest_endpoint_runs_with_deterministic_market_data(monkeypatch):
    monkeypatch.setattr(server, "fetch_ohlcv", lambda *_args, **_kwargs: sample_candles())

    response = client.post(
        "/api/backtest",
        json={
            "symbol": "TEST",
            "strategy": "sma_cross",
            "period": "3mo",
            "interval": "1d",
            "initial_capital": 50000,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["chart_data"]) == 60
    assert payload["metrics"]["initial_capital"] == 50000
    assert "total_trades" in payload["metrics"]
    assert isinstance(payload["equity_curve"], list)
