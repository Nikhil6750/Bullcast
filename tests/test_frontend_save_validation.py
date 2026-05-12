from pathlib import Path


SOURCE = Path("trading-ui/src/services/supabaseStorage.js").read_text(encoding="utf-8")


def test_frontend_save_validation_accepts_valid_data_origins():
    for origin in [
        "manual",
        "gemini_text_parse",
        "gemini_file_import",
        "smart_import_deterministic_fallback",
    ]:
        assert f"'{origin}'" in SOURCE


def test_frontend_save_validation_defaults_missing_origin_to_manual():
    assert "return origin || 'manual'" in SOURCE


def test_frontend_save_validation_rejects_unknown_origin():
    assert "Invalid data_origin value" in SOURCE
    assert "VALID_DATA_ORIGINS.includes(dataOrigin)" in SOURCE


def test_frontend_save_validation_rejects_missing_critical_fields():
    assert "Missing required fields" in SOURCE
    for field in ["symbol", "entry", "exit", "quantity"]:
        assert f"missingFields.push('{field}')" in SOURCE


def test_frontend_save_validation_runs_before_supabase_upsert():
    validation_index = SOURCE.index("validateJournalTradeForSave(toJournalTradeRow")
    upsert_index = SOURCE.index(".upsert(row, { onConflict: 'id' })")

    assert validation_index < upsert_index
