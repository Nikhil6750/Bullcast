from __future__ import annotations

from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import backend.intelligence.smart_import as smart_import
from backend.intelligence.smart_import import (
    DETERMINISTIC_FALLBACK_ORIGIN,
    GEMINI_FILE_IMPORT_ORIGIN,
    MAX_FILE_BYTES,
    apply_mapping,
    get_deterministic_column_mapping,
    get_column_mapping,
    parse_uploaded_file,
)
from backend.server import app

AUTH_HEADERS = {"Authorization": "Bearer test-token"}


def mock_auth(monkeypatch, user_id: str = "user-1"):
    import backend.server as server

    monkeypatch.setattr(server, "validate_supabase_jwt", lambda token: user_id)
    server.rate_limiter.reset()


def mock_gemini(monkeypatch, response_text: str, captured: dict | None = None):
    monkeypatch.setenv("GEMINI_API_KEY", "test-secret-key")
    monkeypatch.setattr(smart_import, "GEMINI_SDK_AVAILABLE", True)

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

    monkeypatch.setattr(smart_import, "genai", SimpleNamespace(Client=FakeClient))


def mock_gemini_failure(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-secret-key")
    monkeypatch.setattr(smart_import, "GEMINI_SDK_AVAILABLE", True)

    class FakeModels:
        def generate_content(self, *, model, contents):
            raise RuntimeError("Gemini unavailable")

    class FakeClient:
        def __init__(self, api_key):
            self.models = FakeModels()

    monkeypatch.setattr(smart_import, "genai", SimpleNamespace(Client=FakeClient))


def test_valid_csv_parses_correctly():
    payload = (
        "Trade Date,Ticker,Direction,Buy Price,Sell Price,Shares,Strategy\n"
        "2024-01-15,RELIANCE.NS,BUY,2450,2510,5,Momentum breakout\n"
    ).encode("utf-8")

    headers, rows = parse_uploaded_file(payload, "trades.csv")

    assert headers == ["Trade Date", "Ticker", "Direction", "Buy Price", "Sell Price", "Shares", "Strategy"]
    assert rows == [
        {
            "Trade Date": "2024-01-15",
            "Ticker": "RELIANCE.NS",
            "Direction": "BUY",
            "Buy Price": "2450",
            "Sell Price": "2510",
            "Shares": "5",
            "Strategy": "Momentum breakout",
        }
    ]


def test_valid_xlsx_parses_correctly():
    from openpyxl import Workbook

    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["Trade Date", "Ticker", "Direction", "Buy Price", "Sell Price", "Shares"])
    sheet.append(["2024-01-15", "RELIANCE.NS", "BUY", 2450, 2510, 5])
    buffer = BytesIO()
    workbook.save(buffer)

    headers, rows = parse_uploaded_file(buffer.getvalue(), "trades.xlsx")

    assert headers == ["Trade Date", "Ticker", "Direction", "Buy Price", "Sell Price", "Shares"]
    assert rows[0]["Ticker"] == "RELIANCE.NS"
    assert rows[0]["Buy Price"] == 2450


def test_file_exceeding_5mb_raises_value_error():
    with pytest.raises(ValueError, match="5MB"):
        parse_uploaded_file(b"x" * (MAX_FILE_BYTES + 1), "large.csv")


def test_unsupported_file_type_raises_value_error():
    with pytest.raises(ValueError, match="only .csv and .xlsx"):
        parse_uploaded_file(b"symbol,entry\nTATA,820\n", "trades.txt")


def test_apply_mapping_correctly_maps_known_columns():
    rows = [
        {
            "Trade Date": "2024-01-15",
            "Ticker": "RELIANCE.NS",
            "Direction": "BUY",
            "Buy Price": "2450",
            "Sell Price": "2510",
            "Shares": "5",
            "Strategy": "Momentum breakout",
        }
    ]
    mapping = {
        "Trade Date": "date",
        "Ticker": "symbol",
        "Direction": "side",
        "Buy Price": "entry",
        "Sell Price": "exit",
        "Shares": "quantity",
        "Strategy": "setup_tag",
    }

    trade = apply_mapping(rows, mapping)[0]

    assert trade["date"] == "2024-01-15"
    assert trade["symbol"] == "RELIANCE.NS"
    assert trade["side"] == "LONG"
    assert trade["entry"] == 2450
    assert trade["exit"] == 2510
    assert trade["quantity"] == 5
    assert trade["setup_tag"] == "breakout"


def test_apply_mapping_sets_needs_review_for_unmapped_fields():
    rows = [{"Ticker": "RELIANCE.NS", "Buy Price": "2450"}]
    mapping = {"Ticker": "symbol", "Buy Price": "entry"}

    trade = apply_mapping(rows, mapping)[0]

    assert trade["needs_review"] is True
    assert "date" in trade["missing_fields"]
    assert "side" in trade["missing_fields"]
    assert "quantity" in trade["missing_fields"]


def test_apply_mapping_sets_file_import_origin_on_every_row():
    rows = [{"Ticker": "RELIANCE.NS"}, {"Ticker": "INFY.NS"}]
    mapping = {"Ticker": "symbol"}

    trades = apply_mapping(rows, mapping)

    assert [trade["data_origin"] for trade in trades] == ["gemini_file_import", "gemini_file_import"]
    assert all(trade["is_synthetic"] is False for trade in trades)


def test_deterministic_column_mapping_maps_standard_headers():
    mapping = get_deterministic_column_mapping(["symbol", "date", "side", "entry", "exit", "quantity"])

    assert mapping == {
        "symbol": "symbol",
        "date": "date",
        "side": "side",
        "entry": "entry",
        "exit": "exit",
        "quantity": "quantity",
    }


def test_deterministic_column_mapping_maps_recognisable_headers():
    mapping = get_deterministic_column_mapping(["Ticker", "Buy Price", "Shares", "Strategy"])

    assert mapping["Ticker"] == "symbol"
    assert mapping["Buy Price"] == "entry"
    assert mapping["Shares"] == "quantity"
    assert mapping["Strategy"] == "setup_tag"


def test_deterministic_column_mapping_returns_null_for_unrecognisable_headers():
    mapping = get_deterministic_column_mapping(["Broker Fee", "Random Column"])

    assert mapping["Broker Fee"] is None
    assert mapping["Random Column"] is None


def test_get_column_mapping_with_mocked_gemini_response(monkeypatch):
    captured = {}
    mock_gemini(
        monkeypatch,
        """
        {
          "column_mapping": {
            "Trade Date": "date",
            "Ticker": "symbol",
            "Direction": "side",
            "Buy Price": "entry",
            "Sell Price": "exit",
            "Shares": "quantity",
            "Strategy": "setup_tag",
            "Ignored": null
          }
        }
        """,
        captured,
    )

    mapping, used_fallback = get_column_mapping(
        ["Trade Date", "Ticker", "Direction", "Buy Price", "Sell Price", "Shares", "Strategy", "Ignored"],
        [{"Ticker": "RELIANCE.NS", "Buy Price": 2450}],
    )

    assert used_fallback is False
    assert mapping["Ticker"] == "symbol"
    assert mapping["Buy Price"] == "entry"
    assert mapping["Sell Price"] == "exit"
    assert mapping["Shares"] == "quantity"
    assert mapping["Ignored"] is None
    assert "column mapping only" in captured["contents"].lower()
    assert captured["api_key"] == "test-secret-key"


def test_get_column_mapping_uses_fallback_when_gemini_raises(monkeypatch):
    mock_gemini_failure(monkeypatch)

    mapping, used_fallback = get_column_mapping(
        ["Trade Date", "Ticker", "Direction", "Buy Price", "Sell Price", "Shares"],
        [{"Ticker": "RELIANCE.NS", "Buy Price": 2450}],
    )
    trades = apply_mapping(
        [{"Trade Date": "2024-01-15", "Ticker": "RELIANCE.NS", "Direction": "BUY", "Buy Price": "2450", "Sell Price": "2510", "Shares": "5"}],
        mapping,
        data_origin=DETERMINISTIC_FALLBACK_ORIGIN,
    )

    assert used_fallback is True
    assert mapping["Ticker"] == "symbol"
    assert trades[0]["data_origin"] == DETERMINISTIC_FALLBACK_ORIGIN


def test_import_file_endpoint_warns_when_fallback_is_used(monkeypatch):
    mock_auth(monkeypatch)
    mock_gemini_failure(monkeypatch)
    client = TestClient(app)
    csv_body = (
        "Trade Date,Ticker,Direction,Buy Price,Sell Price,Shares,Strategy\n"
        "2024-01-15,RELIANCE.NS,BUY,2450,2510,5,Momentum breakout\n"
    )

    response = client.post(
        "/api/journal/import-file",
        headers=AUTH_HEADERS,
        files={"file": ("trades.csv", csv_body, "text/csv")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["llm_enabled"] is False
    assert "deterministic heuristic fallback" in " ".join(payload["warnings"])
    assert payload["column_mapping"]["Ticker"] == "symbol"
    assert payload["trades"][0]["data_origin"] == DETERMINISTIC_FALLBACK_ORIGIN


def test_import_file_endpoint_uses_gemini_origin_when_gemini_succeeds(monkeypatch):
    mock_auth(monkeypatch)
    mock_gemini(
        monkeypatch,
        """
        {
          "column_mapping": {
            "Trade Date": "date",
            "Ticker": "symbol",
            "Direction": "side",
            "Buy Price": "entry",
            "Sell Price": "exit",
            "Shares": "quantity",
            "Strategy": "setup_tag"
          }
        }
        """,
    )
    client = TestClient(app)
    csv_body = (
        "Trade Date,Ticker,Direction,Buy Price,Sell Price,Shares,Strategy\n"
        "2024-01-15,RELIANCE.NS,BUY,2450,2510,5,Momentum breakout\n"
    )

    response = client.post(
        "/api/journal/import-file",
        headers=AUTH_HEADERS,
        files={"file": ("trades.csv", csv_body, "text/csv")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["llm_enabled"] is True
    assert payload["trades"][0]["data_origin"] == GEMINI_FILE_IMPORT_ORIGIN


def test_import_file_endpoint_rejects_more_than_500_rows(monkeypatch):
    mock_auth(monkeypatch)
    mock_gemini_failure(monkeypatch)
    client = TestClient(app)
    csv_body = "Ticker,Buy Price,Sell Price,Shares\n" + "\n".join(
        f"RELIANCE.NS,{2450 + i},2510,5" for i in range(501)
    )

    response = client.post(
        "/api/journal/import-file",
        headers=AUTH_HEADERS,
        files={"file": ("trades.csv", csv_body, "text/csv")},
    )

    assert response.status_code == 400
    assert response.json()["error"] == "File too large. Maximum 500 rows."


def test_import_file_endpoint_accepts_exactly_500_rows(monkeypatch):
    mock_auth(monkeypatch)
    mock_gemini_failure(monkeypatch)
    client = TestClient(app)
    csv_body = "Ticker,Buy Price,Sell Price,Shares\n" + "\n".join(
        f"RELIANCE.NS,{2450 + i},2510,5" for i in range(500)
    )

    response = client.post(
        "/api/journal/import-file",
        headers=AUTH_HEADERS,
        files={"file": ("trades.csv", csv_body, "text/csv")},
    )

    assert response.status_code == 200
    assert len(response.json()["trades"]) == 500
