from fastapi.testclient import TestClient
import requests

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
    assert result["gemini_model"] == "gemini-2.5-flash"
    assert result["gemini_configured"] is False
    assert result["failure_category"] == "missing_api_key"
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
    assert payload["gemini_configured"] is False
    assert payload["failure_category"] == "missing_api_key"
    assert payload["trade_count"] == 2
    assert payload["limit"] == 2
    assert payload["improvement_checklist"]


def test_mistake_summary_fallback_when_gemini_request_fails(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-secret-key")

    def fail_request(*_args, **_kwargs):
        raise requests.Timeout("test-secret-key should not be returned")

    monkeypatch.setattr("backend.intelligence.mistake_summary.requests.post", fail_request)

    result = build_mistake_summary(sample_trades(), limit=100)

    assert result["method"] == "local_fallback"
    assert result["local_fallback"] is True
    assert result["gemini_configured"] is True
    assert result["failure_category"] == "gemini_timeout"
    assert result["fallback_reason"] == "Gemini API request timed out."
    assert "test-secret-key" not in str(result)


def test_mistake_summary_uses_gemini_when_text_is_recoverable(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-secret-key")
    captured = {}

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": (
                                        "Repeated revenge trade behavior appears in this journal. "
                                        "Review weak confirmation and confidence scoring."
                                    )
                                }
                            ]
                        }
                    }
                ]
            }

    def fake_request(*args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        return FakeResponse()

    monkeypatch.setattr("backend.intelligence.mistake_summary.requests.post", fake_request)

    result = build_mistake_summary(sample_trades(), limit=100)

    url = captured["args"][0]
    request_kwargs = captured["kwargs"]
    generation_config = request_kwargs["json"]["generationConfig"]

    assert url == "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    assert request_kwargs["headers"]["x-goog-api-key"] == "test-secret-key"
    assert "key=" not in url
    assert request_kwargs["json"]["system_instruction"]["parts"][0]["text"]
    assert generation_config["responseMimeType"] == "application/json"
    assert generation_config["responseJsonSchema"]["type"] == "object"
    assert generation_config["thinkingConfig"] == {"thinkingBudget": 0}
    assert generation_config["maxOutputTokens"] == 2048
    assert result["method"] == "gemini"
    assert result["local_fallback"] is False
    assert result["gemini_configured"] is True
    assert result["failure_category"] is None
    assert result["gemini_response_format"] == "text_recovered"
    assert "revenge trade" in result["summary"]
    assert "test-secret-key" not in str(result)


def test_mistake_summary_returns_sanitized_metadata_on_http_error(monkeypatch):
    secret = "test-secret-key"
    monkeypatch.setenv("GEMINI_API_KEY", secret)

    class FakeResponse:
        def raise_for_status(self):
            raise requests.HTTPError(f"{secret} leaked by upstream")

    monkeypatch.setattr(
        "backend.intelligence.mistake_summary.requests.post",
        lambda *_args, **_kwargs: FakeResponse(),
    )

    result = build_mistake_summary(sample_trades(), limit=100)

    assert result["method"] == "local_fallback"
    assert result["gemini_configured"] is True
    assert result["failure_category"] == "gemini_http_error"
    assert result["fallback_reason"] == "Gemini API returned an error response."
    assert secret not in str(result)
