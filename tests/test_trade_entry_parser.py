from types import SimpleNamespace

from fastapi.testclient import TestClient

import backend.intelligence.trade_entry_parser as trade_entry_parser
from backend.intelligence.trade_entry_parser import parse_trade_entries
from backend.server import app


def mock_gemini(monkeypatch, response_text: str, captured: dict | None = None):
    monkeypatch.setenv("GEMINI_API_KEY", "test-secret-key")
    monkeypatch.setattr(trade_entry_parser, "GEMINI_SDK_AVAILABLE", True)

    class FakeModels:
        def generate_content(self, *, model, contents):
            if captured is not None:
                captured["model"] = model
                captured["contents"] = contents
            return SimpleNamespace(text=response_text)

    class FakeClient:
        def __init__(self, api_key):
            if captured is not None:
                captured["api_key"] = api_key
            self.models = FakeModels()

    monkeypatch.setattr(trade_entry_parser, "genai", SimpleNamespace(Client=FakeClient))


def test_parse_trades_missing_gemini_key_fallback(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    result = parse_trade_entries("Bought TATA at 820, sold at 842, qty 10.")

    assert result["provider"] == "gemini"
    assert result["llm_enabled"] is False
    assert result["trades"] == []
    assert result["warnings"] == [
        "Gemini trade parser unavailable because GEMINI_API_KEY is not configured."
    ]


def test_parse_trades_valid_gemini_json(monkeypatch):
    captured = {}
    mock_gemini(
        monkeypatch,
        """
        {
          "trades": [
            {
              "date": "2026-05-11",
              "symbol": "TATA",
              "side": "LONG",
              "entry": 820,
              "exit": 842,
              "quantity": 10,
              "setup": "Breakout retest",
              "setup_tag": "breakout",
              "confidence": "",
              "confidence_score": null,
              "mistake": "",
              "mistake_tag": "none",
              "rule_followed": true,
              "planned_risk": 1000,
              "planned_reward": 2500,
              "entry_reason": "Breakout retest",
              "exit_reason": "",
              "notes": "Followed rules.",
              "data_origin": "gemini_text_parse",
              "is_synthetic": false,
              "needs_review": false,
              "missing_fields": []
            }
          ],
          "warnings": [],
          "llm_enabled": true,
          "provider": "gemini"
        }
        """,
        captured,
    )

    result = parse_trade_entries(
        "Bought TATA at 820, sold at 842, qty 10. Breakout retest. Followed rules. Risk was 1000 and reward target was 2500.",
        default_date="2026-05-11",
    )

    assert result["llm_enabled"] is True
    assert result["provider"] == "gemini"
    assert result["warnings"] == []
    assert result["trades"][0]["symbol"] == "TATA"
    assert result["trades"][0]["side"] == "LONG"
    assert result["trades"][0]["entry"] == 820
    assert result["trades"][0]["quantity"] == 10
    assert result["trades"][0]["data_origin"] == "gemini_text_parse"
    assert result["trades"][0]["is_synthetic"] is False
    assert result["trades"][0]["needs_review"] is False
    assert "Do not recommend buys" in captured["contents"]
    assert captured["api_key"] == "test-secret-key"
    assert "test-secret-key" not in str(result)


def test_parse_trades_invalid_gemini_json_handled_safely(monkeypatch):
    mock_gemini(monkeypatch, "not json")

    result = parse_trade_entries("Bought TATA at 820.")

    assert result["llm_enabled"] is False
    assert result["trades"] == []
    assert result["warnings"] == ["Gemini trade parser returned invalid JSON."]


def test_parse_trades_does_not_keep_invented_numbers_for_incomplete_text(monkeypatch):
    mock_gemini(
        monkeypatch,
        """
        {
          "trades": [
            {
              "date": "2026-05-11",
              "symbol": "TATA",
              "side": null,
              "entry": 820,
              "exit": 842,
              "quantity": 10,
              "setup": "Breakout retest",
              "setup_tag": "breakout",
              "confidence": "",
              "confidence_score": null,
              "mistake": "",
              "mistake_tag": "none",
              "rule_followed": null,
              "planned_risk": null,
              "planned_reward": null,
              "entry_reason": "",
              "exit_reason": "",
              "notes": "",
              "data_origin": "gemini_text_parse",
              "is_synthetic": false,
              "needs_review": true,
              "missing_fields": ["side"]
            }
          ],
          "warnings": [],
          "llm_enabled": true,
          "provider": "gemini"
        }
        """,
    )

    result = parse_trade_entries("TATA breakout retest", default_date="2026-05-11")
    trade = result["trades"][0]

    assert trade["entry"] is None
    assert trade["exit"] is None
    assert trade["quantity"] is None
    assert trade["needs_review"] is True
    assert set(["side", "entry", "exit", "quantity"]).issubset(set(trade["missing_fields"]))


def test_parse_trades_endpoint(monkeypatch):
    mock_gemini(
        monkeypatch,
        """
        {
          "trades": [
            {
              "date": null,
              "symbol": "NIFTY",
              "side": "SHORT",
              "entry": 22450,
              "exit": 22320,
              "quantity": 2,
              "setup": "",
              "setup_tag": "support_resistance",
              "confidence": "",
              "confidence_score": null,
              "mistake": "early exit",
              "mistake_tag": "early_exit",
              "rule_followed": null,
              "planned_risk": null,
              "planned_reward": null,
              "entry_reason": "rejection at resistance",
              "exit_reason": "",
              "notes": "",
              "data_origin": "gemini_text_parse",
              "is_synthetic": false,
              "needs_review": false,
              "missing_fields": []
            }
          ],
          "warnings": [],
          "llm_enabled": true,
          "provider": "gemini"
        }
        """,
    )
    client = TestClient(app)

    response = client.post(
        "/api/journal/parse-trades",
        json={
            "text": "Shorted NIFTY at 22450, covered at 22320, 2 lots. Entered because of rejection at resistance. Mistake was early exit.",
            "default_date": "2026-05-11",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["trades"][0]["date"] == "2026-05-11"
    assert payload["trades"][0]["side"] == "SHORT"
    assert payload["trades"][0]["mistake_tag"] == "early_exit"
