from fastapi.testclient import TestClient

from backend.intelligence.mistake_summary import build_mistake_summary
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
            "rule_followed": True,
        },
    ]


def test_mistake_summary_uses_local_fallback_without_gemini_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    result = build_mistake_summary(sample_trades(), limit=100)

    assert result["method"] == "local_fallback"
    assert result["local_fallback"] is True
    assert result["model"] == "local-deterministic"
    assert result["trade_count"] == 3
    assert "GEMINI_API_KEY" in result["fallback_reason"]
    assert any("revenge trade" in item for item in result["repeated_mistakes"])
    assert any("confidence_score >= 4" in item for item in result["confidence_issues"])
    assert "does not predict market direction" in result["educational_disclaimer"]


def test_mistake_summary_endpoint_returns_fallback_payload(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    client = TestClient(app)

    response = client.post(
        "/api/intelligence/mistake-summary",
        json={"trades": sample_trades(), "limit": 2},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["method"] == "local_fallback"
    assert payload["local_fallback"] is True
    assert payload["trade_count"] == 2
    assert payload["limit"] == 2
    assert payload["improvement_checklist"]
