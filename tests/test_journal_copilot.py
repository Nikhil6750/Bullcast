from __future__ import annotations

from types import SimpleNamespace

import backend.intelligence.journal_copilot as journal_copilot
from backend.intelligence.journal_copilot import (
    DISCLAIMER,
    SYSTEM_INSTRUCTION,
    analyze_journal,
    build_analysis_prompt,
    fetch_user_trades,
    filter_unsafe_insights,
)


def mock_supabase(monkeypatch, rows, captured=None):
    captured = captured if captured is not None else {}
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return rows

    def fake_get(url, *, headers=None, params=None, timeout=None):
        captured["url"] = url
        captured["headers"] = headers
        captured["params"] = params
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr(journal_copilot.requests, "get", fake_get)
    return captured


def mock_gemini(monkeypatch, response_text: str):
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    monkeypatch.setattr(journal_copilot, "GEMINI_SDK_AVAILABLE", True)

    class FakeModels:
        def generate_content(self, *, model, contents):
            return SimpleNamespace(text=response_text)

    class FakeClient:
        def __init__(self, api_key):
            self.models = FakeModels()

    monkeypatch.setattr(journal_copilot, "genai", SimpleNamespace(Client=FakeClient))


def sample_trades(count=5):
    return [
        {
            "id": f"trade-{index}",
            "symbol": "RELIANCE.NS" if index % 2 == 0 else "TATA.NS",
            "side": "LONG",
            "entry": 100 + index,
            "exit": 110 + index,
            "quantity": 1,
            "setup_tag": "breakout",
            "mistake_tag": "early_exit" if index % 2 else "none",
            "confidence_score": 3,
            "notes": "Followed rules but reviewed execution.",
            "planned_risk": 100,
            "planned_reward": 200,
            "data_origin": "",
            "created_at": f"2026-05-1{index}T10:00:00+00:00",
        }
        for index in range(count)
    ]


def test_fetch_user_trades_with_mocked_supabase_returns_correct_fields(monkeypatch):
    rows = sample_trades(1)
    captured = mock_supabase(monkeypatch, rows)

    result = fetch_user_trades("user-123", limit=25)

    assert result == rows
    assert captured["url"] == "https://example.supabase.co/rest/v1/journal_trades"
    assert "symbol" in captured["params"]["select"]
    assert "planned_reward" in captured["params"]["select"]
    assert captured["params"]["limit"] == "25"


def test_fetch_user_trades_always_filters_by_user_id(monkeypatch):
    captured = mock_supabase(monkeypatch, [])

    fetch_user_trades("strict-user")

    assert captured["params"]["user_id"] == "eq.strict-user"


def test_analyze_journal_with_empty_trades_returns_empty_state(monkeypatch):
    monkeypatch.setattr(journal_copilot, "fetch_user_trades", lambda user_id: [])

    result = analyze_journal("user-123")

    assert result["insights"] == []
    assert result["summary"] == "No journal trades found. Start logging trades to receive analysis."
    assert result["disclaimer"] == DISCLAIMER
    assert result["trades_analyzed"] == 0
    assert result["llm_enabled"] is False


def test_analyze_journal_with_mocked_gemini_response_returns_structured_insights(monkeypatch):
    monkeypatch.setattr(journal_copilot, "fetch_user_trades", lambda user_id: sample_trades(5))
    mock_gemini(
        monkeypatch,
        """
        {
          "insights": [
            {
              "category": "risk_discipline",
              "observation": "Risk fields are present on all sampled trades.",
              "evidence": "5 of 5 trades include planned risk and planned reward.",
              "suggestion": "Keep reviewing whether actual behavior matched the written plan."
            }
          ],
          "summary": "The journal has consistent structure and usable risk notes.",
          "disclaimer": "This is journal behavior analysis only. Not financial advice.",
          "trades_analyzed": 5,
          "data_range": "2026-05-10 to 2026-05-14"
        }
        """,
    )

    result = analyze_journal("user-123")

    assert result["llm_enabled"] is True
    assert result["trades_analyzed"] == 5
    assert result["insights"][0]["category"] == "risk_discipline"


def test_filter_unsafe_insights_removes_directional_recommendations():
    insights = [
        {"observation": "x", "evidence": "x", "suggestion": "buy now"},
        {"observation": "go long", "evidence": "x", "suggestion": "x"},
        {"observation": "x", "evidence": "price target was mentioned", "suggestion": "x"},
        {"observation": "Valid", "evidence": "Journal has repeated early exits.", "suggestion": "Review execution notes."},
    ]

    filtered = filter_unsafe_insights(insights)

    assert len(filtered) == 1
    assert filtered[0]["observation"] == "Valid"


def test_filter_unsafe_insights_keeps_neutral_buy_sell_usage():
    insights = [
        {"observation": "selling too early appears often", "evidence": "3 notes mention early exits", "suggestion": "Review exit discipline."},
        {"observation": "buy-side pressure was noted", "evidence": "Notes mention context", "suggestion": "Keep journaling context."},
    ]

    assert filter_unsafe_insights(insights) == insights


def test_analyze_journal_injects_disclaimer_if_gemini_omits_it(monkeypatch):
    monkeypatch.setattr(journal_copilot, "fetch_user_trades", lambda user_id: sample_trades(5))
    mock_gemini(
        monkeypatch,
        """
        {
          "insights": [],
          "summary": "Journal reviewed.",
          "trades_analyzed": 5,
          "data_range": "2026-05-10 to 2026-05-14"
        }
        """,
    )

    result = analyze_journal("user-123")

    assert result["disclaimer"] == DISCLAIMER


def test_analyze_journal_with_mocked_gemini_failure_returns_gracefully(monkeypatch):
    monkeypatch.setattr(journal_copilot, "fetch_user_trades", lambda user_id: sample_trades(5))
    monkeypatch.setattr(journal_copilot, "_call_gemini", lambda prompt: (_ for _ in ()).throw(RuntimeError("down")))

    result = analyze_journal("user-123")

    assert result["llm_enabled"] is False
    assert result["insights"] == []
    assert "Analysis unavailable" in result["summary"]


def test_build_analysis_prompt_includes_hardcoded_system_instruction():
    prompt = build_analysis_prompt(sample_trades(1))

    assert SYSTEM_INSTRUCTION in prompt
    assert "Return valid JSON only" in prompt


def test_build_analysis_prompt_truncates_long_notes():
    long_note = "x" * 250
    trade = sample_trades(1)[0]
    trade["notes"] = long_note

    prompt = build_analysis_prompt([trade])

    assert ("x" * 200) + "..." in prompt
    assert "x" * 220 not in prompt
