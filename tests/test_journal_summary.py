from types import SimpleNamespace

from fastapi.testclient import TestClient

import backend.intelligence.journal_summary as journal_summary
from backend.intelligence.journal_summary import build_journal_summary
from backend.server import app


def sample_trades():
    return [
        {
            "date": "2026-01-01",
            "symbol": "NIFTY",
            "type": "LONG",
            "result": "LOSS",
            "pnl": -1200,
            "setup_tag": "Streak Pullback Confirmation",
            "mistake_tag": "revenge_trade",
            "confidence_score": 5,
            "planned_risk": 1000,
            "planned_reward": 800,
            "rule_followed": False,
            "notes": "Entered after a loss with weak confirmation.",
        },
        {
            "date": "2026-01-02",
            "symbol": "NIFTY",
            "type": "LONG",
            "result": "LOSS",
            "pnl": -800,
            "setup_tag": "Streak Pullback Confirmation",
            "mistake_tag": "revenge_trade",
            "confidence_score": 4,
            "planned_risk": 1000,
            "planned_reward": 900,
            "rule_followed": True,
            "notes": "Repeated the same setup without enough review.",
        },
        {
            "date": "2026-01-03",
            "symbol": "BANKNIFTY",
            "type": "SHORT",
            "result": "WIN",
            "pnl": 900,
            "setup_tag": "Pattern Alert",
            "mistake_tag": "none",
            "confidence_score": 2,
            "planned_risk": 500,
            "planned_reward": 1000,
            "rule_followed": True,
        },
    ]


def sample_profile_summary():
    return {
        "status": "ready",
        "sample_size": 6,
        "metrics": {
            "total_trades": 6,
            "total_wins": 3,
            "total_losses": 3,
            "win_rate": 50.0,
            "loss_rate": 50.0,
            "net_pnl": -400,
            "average_rr": 0.9,
            "profit_factor": 0.8,
        },
        "repeated_mistakes": [{"tag": "late_entry", "count": 2, "loss_rate": 100}],
        "best_setups": [{"key": "breakout", "trades": 2, "win_rate": 100, "total_pnl": 600}],
        "behavior_profile": {
            "label": "Risk/reward-compression profile",
            "risk_score": 62,
            "confidence_score": 41,
            "behavioral_warning": "Average R:R is below 1.0.",
            "strengths": ["Strongest setup by PnL: breakout."],
            "weaknesses": ["Average R:R is below 1.0."],
        },
    }


def test_journal_summary_missing_gemini_key_fallback(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    result = build_journal_summary(sample_trades(), limit=100)

    assert result["provider"] == "gemini"
    assert result["llm_enabled"] is False
    assert result["llm_summary"] is None
    assert result["warnings"] == [
        "Gemini summary unavailable because GEMINI_API_KEY is not configured"
    ]
    assert result["deterministic_summary"]["trade_count"] == 3
    assert result["deterministic_summary"]["metrics"]["total_trades"] == 3
    assert result["deterministic_summary"]["repeated_mistakes"][0]["tag"] == "revenge_trade"
    assert "does not predict market direction" in result["educational_disclaimer"]


def test_journal_summary_endpoint_accepts_valid_recent_trades_shape(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    client = TestClient(app)

    response = client.post(
        "/api/intelligence/journal-summary",
        json={"recent_trades": sample_trades(), "limit": 2},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["provider"] == "gemini"
    assert payload["llm_enabled"] is False
    assert payload["llm_summary"] is None
    assert payload["deterministic_summary"]["input_type"] == "trades"
    assert payload["deterministic_summary"]["trade_count"] == 2


def test_journal_summary_endpoint_accepts_profile_summary_without_trades(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    client = TestClient(app)

    response = client.post(
        "/api/intelligence/journal-summary",
        json={"profile_summary": sample_profile_summary()},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["provider"] == "gemini"
    assert payload["deterministic_summary"]["input_type"] == "profile_summary"
    assert payload["deterministic_summary"]["trade_count"] == 6
    assert payload["deterministic_summary"]["risk_behavior"]["risk_score"] == 62
    assert payload["deterministic_summary"]["improvement_areas"]


def test_deterministic_summary_still_works_without_gemini(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    result = build_journal_summary(sample_trades(), limit=100)
    deterministic = result["deterministic_summary"]

    assert result["provider"] == "gemini"
    assert deterministic["source"] == "deterministic_journal_analytics"
    assert deterministic["metrics"]["win_rate"] == 33.3
    assert deterministic["risk_behavior"]["behavioral_warning"]
    assert deterministic["strong_setups"]
    assert deterministic["improvement_areas"]


def test_journal_summary_uses_gemini_when_configured(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-secret-key")
    monkeypatch.setattr(journal_summary, "GEMINI_SDK_AVAILABLE", True)
    captured = {}

    class FakeModels:
        def generate_content(self, *, model, contents):
            captured["model"] = model
            captured["contents"] = contents
            return SimpleNamespace(text="Review repeated revenge_trade behavior and improve setup discipline.")

    class FakeClient:
        def __init__(self, api_key):
            captured["api_key"] = api_key
            self.models = FakeModels()

    monkeypatch.setattr(journal_summary, "genai", SimpleNamespace(Client=FakeClient))

    result = build_journal_summary(sample_trades(), limit=100)

    assert result["provider"] == "gemini"
    assert result["llm_enabled"] is True
    assert result["llm_summary"] == "Review repeated revenge_trade behavior and improve setup discipline."
    assert result["warnings"] == []
    assert captured["model"] == "gemini-2.5-flash"
    assert captured["api_key"] == "test-secret-key"
    assert "financial advice" in captured["contents"]
    assert "test-secret-key" not in str(result)
