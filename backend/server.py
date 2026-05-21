from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, List

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from backend.datasets import build_trade_dataset
from backend.edgar import build_edgar_context_for_ticker
from backend.intelligence.coach import TradeCoach
from backend.journal import JournalTrade

logger = logging.getLogger(__name__)

app = FastAPI(title="Bullcast API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://bullcast-ruddy.vercel.app",
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from backend.news_api import router as news_router
app.include_router(news_router)


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(_request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=400,
        content={"error": "Invalid input", "details": exc.errors()},
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException):
    detail = exc.detail
    msg = detail if isinstance(detail, str) else str(detail)
    return JSONResponse(status_code=exc.status_code, content={"error": msg})


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request: Request, exc: Exception):
    logger.error("Unhandled server error")
    return JSONResponse(status_code=500, content={"error": "Internal server error."})


@app.get("/health")
def health() -> dict:
    return {"ok": True}


from backend.market_data import search_symbols, list_assets, fetch_ohlcv, fetch_quote
from pydantic import BaseModel, ConfigDict, Field, model_validator
from backend.fflc.backtest import IST, SUPPORTED_PAIRS, get_latest_pattern, run_backtest
from backend.fflc.alert_store import load_alerts, save_alerts
from backend.fflc.candles import CandleFetchError, fetch_candles
from backend.fflc.multi_backtest import run_multi_backtest
from backend.intelligence.mistake_summary import build_mistake_summary
from backend.intelligence.journal_summary import build_journal_summary
from backend.intelligence.trade_entry_parser import parse_trade_entries
from backend.intelligence.smart_import import (
    DETERMINISTIC_FALLBACK_ORIGIN,
    DETERMINISTIC_FALLBACK_WARNING,
    GEMINI_FILE_IMPORT_ORIGIN,
    GeminiSmartImportError,
    MAX_FILE_BYTES,
    apply_mapping,
    get_column_mapping,
    mapping_warnings,
    parse_uploaded_file,
)
from backend.intelligence.journal_copilot import analyze_journal, validate_supabase_jwt
from backend.middleware.rate_limiter import rate_limiter

TradeEntry = JournalTrade

class AnalyzeRequest(BaseModel):
    trades: List[TradeEntry]

class AskRequest(BaseModel):
    trades: List[TradeEntry]
    question: str

class TradeAnalysisRequest(BaseModel):
    trades: List[TradeEntry] = Field(default_factory=list)
    trade: TradeEntry

class MistakeSummaryRequest(BaseModel):
    trades: List[TradeEntry] = Field(default_factory=list)
    limit: int = Field(default=100, ge=1, le=500)

class JournalSummaryRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    trades: List[TradeEntry] = Field(default_factory=list)
    profile_summary: dict[str, Any] | None = None
    limit: int = Field(default=100, ge=1, le=500)

    @model_validator(mode="before")
    @classmethod
    def _map_aliases(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        data = dict(value)
        if "trades" not in data:
            for key in ("recent_trades", "recent_journal_trades", "journal_trades"):
                if key in data:
                    data["trades"] = data.get(key)
                    break
        if "profile_summary" not in data:
            for key in ("profile", "trader_profile"):
                if key in data:
                    data["profile_summary"] = data.get(key)
                    break
        return data

class JournalTradeParseRequest(BaseModel):
    text: str = Field(default="", max_length=8000)
    timezone: str | None = Field(default=None, max_length=80)
    default_date: str | None = Field(default=None, max_length=20)

class TradeDatasetExportRequest(BaseModel):
    trades: List[dict] = Field(default_factory=list)
    include_edgar: bool = False

class MultiBacktestRequest(BaseModel):
    pairs: List[str] = Field(default_factory=list)
    date: str | None = None

MAX_PARSE_TEXT_CHARS = 2000
MAX_IMPORT_ROWS = 5000


def _authenticated_user_id(authorization: str | None) -> str:
    scheme, _, token = str(authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="Authentication required.")

    user_id = validate_supabase_jwt(token.strip())
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid authentication token.")
    return user_id


def _rate_limit_response(user_id: str, endpoint: str, limit: int, window_seconds: int) -> JSONResponse | None:
    if rate_limiter.check(user_id, endpoint, limit, window_seconds):
        return None
    return JSONResponse(
        status_code=429,
        content={
            "error": "Rate limit exceeded. Please wait before retrying.",
            "retry_after_seconds": rate_limiter.retry_after_seconds(user_id, endpoint, window_seconds),
        },
    )

@app.get("/api/search")
async def search_api(q: str = "", limit: int = 8):
    return search_symbols(q, limit)

@app.get("/api/assets")
async def assets_api(type: str | None = None):
    return list_assets(type)

@app.get("/api/history")
async def history_api(symbol: str, period: str = "1y", interval: str = "1d"):
    return fetch_ohlcv(symbol, period, interval)

@app.get("/api/market-data/ohlcv")
async def market_data_ohlcv(symbol: str, interval: str = "5m", period: str = "30d"):
    candles = fetch_ohlcv(symbol, period=period, interval=interval)
    return {"symbol": symbol, "interval": interval, "candles": candles, "count": len(candles)}

@app.get("/api/quote")
async def quote_api(symbol: str):
    return fetch_quote(symbol)

@app.get("/api/backtest/pairs")
async def backtest_pairs():
    return {"pairs": SUPPORTED_PAIRS, "count": len(SUPPORTED_PAIRS)}

@app.get("/api/backtest/candles")
async def backtest_candles(pair: str):
    try:
        candles = fetch_candles(pair)
        return {"pair": pair.upper(), "count": len(candles), "candles": candles}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except CandleFetchError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

@app.get("/api/alerts-log")
async def alerts_log():
    return load_alerts()

@app.get("/api/backtest/run")
async def backtest_run(pair: str, date: str | None = None, live: bool = False):
    try:
        result = run_backtest(pair, date, fetch_limit=100 if live else 2000)
        save_alerts(result.get("patterns", []), pair, result.get("date") or date or "")
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except CandleFetchError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

@app.get("/api/live-scan")
async def live_scan(pair: str):
    try:
        today = datetime.now(tz=IST).date().isoformat()
        pattern = get_latest_pattern(pair, today)
        if pattern is None:
            return {}
        save_alerts([pattern], pair, today)
        return pattern
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except CandleFetchError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

@app.post("/api/backtest/run-multi")
async def backtest_run_multi(req: MultiBacktestRequest):
    try:
        pairs = req.pairs or SUPPORTED_PAIRS
        return run_multi_backtest(pairs, req.date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/backtest/run-from-csv")
async def backtest_run_from_csv(
    pair: str = Form(...),
    date: str = Form(...),
    file: UploadFile = File(...),
    use_csv_alerts: bool = Form(True),
):
    """Run backtest using a user-uploaded CSV file (no saved data needed)."""
    import csv
    import io
    from datetime import date as date_type, datetime, time, timedelta
    from zoneinfo import ZoneInfo
    from backend.fflc.candles import normalize_pair
    from backend.fflc.detector import detect_patterns
    from backend.fflc.evaluator import evaluate_trade

    IST = ZoneInfo("Asia/Kolkata")
    SESSION_START = time(12, 50)
    SESSION_END = time(21, 0)
    TARGET_DAY_START = time(0, 0)
    TARGET_DAY_END = time(23, 59, 59)

    try:
        clean_pair = normalize_pair(pair)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        target_date = date_type.fromisoformat(date.strip())
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    if target_date.weekday() == 6:
        return {
            "pair": clean_pair, "date": target_date.isoformat(),
            "total_setups": 0, "wins": 0, "losses": 0,
            "setup_not_formed": 0, "pending": 0, "win_rate": 0.0,
            "patterns": [], "candles_count": 0, "skipped": True,
            "data_source": "upload",
        }

    try:
        raw = await file.read()
        content = raw.decode("utf-8", errors="replace")
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Could not read uploaded file.") from exc

    session_start_dt = datetime.combine(target_date, SESSION_START, tzinfo=IST)
    target_start_dt = datetime.combine(target_date, TARGET_DAY_START, tzinfo=IST)
    target_end_dt = datetime.combine(target_date, TARGET_DAY_END, tzinfo=IST)
    detection_start_dt = datetime.combine(target_date - timedelta(days=1), TARGET_DAY_START, tzinfo=IST)
    session_end_dt = datetime.combine(target_date, SESSION_END, tzinfo=IST)
    start_ts = int(session_start_dt.timestamp())
    target_start_ts = int(target_start_dt.timestamp())
    target_end_ts = int(target_end_dt.timestamp())
    detection_start_ts = int(detection_start_dt.timestamp())
    end_ts = int(session_end_dt.timestamp())

    candles = []
    reader = csv.DictReader(io.StringIO(content))

    def _get(row, *keys):
        for key in keys:
            for row_key, value in row.items():
                if str(row_key or "").strip().lower() == str(key).strip().lower():
                    return value
        return None

    def _alert_value(row):
        try:
            return float(_get(row, "pattern alert", "pattern_alert") or 0)
        except (TypeError, ValueError):
            return 0.0

    for row in reader:
        try:
            ts_raw = _get(row, "time", "timestamp")
            ts = int(float(ts_raw))
        except (ValueError, TypeError):
            continue
        if detection_start_ts <= ts <= target_end_ts:
            try:
                candles.append({
                    "time": ts,
                    "open": float(_get(row, "open")),
                    "high": float(_get(row, "high")),
                    "low": float(_get(row, "low")),
                    "close": float(_get(row, "close")),
                    "pattern_alert": _alert_value(row),
                })
            except (TypeError, ValueError):
                continue

    candles.sort(key=lambda c: c["time"])

    if len(candles) < 4:
        return {
            "pair": clean_pair, "date": target_date.isoformat(),
            "total_setups": 0, "wins": 0, "losses": 0,
            "setup_not_formed": 0, "pending": 0, "win_rate": 0.0,
            "patterns": [], "candles_count": len(candles), "candles": candles, "skipped": False,
            "data_source": "upload",
        }

    session_end_ts = end_ts
    patterns = [
        p for p in detect_patterns(candles, clean_pair)
        if target_start_ts <= int(p["alert_timestamp"]) <= target_end_ts
    ]

    for p in patterns:
        alert_ts = int(p["alert_timestamp"])
        if alert_ts < start_ts or alert_ts > end_ts:
            p["result"] = "setup_not_formed"
            p["reason"] = "Outside trading window"
            p["win_count"] = 0
            continue

        stop_reference = p["c1"]["open"]
        ev = evaluate_trade(
            candles,
            p["direction"],
            p["target"],
            p["alert_candle_index"],
            session_end_ts,
            zone_lower=p["zone_lower"],
            zone_upper=p["zone_upper"],
            c1_open=stop_reference,
        )
        p["result"] = ev["result"]
        p["reason"] = ev["reason"]
        p["win_count"] = 1 if ev["result"] == "win" else 0

    wins = sum(1 for p in patterns if p["result"] == "win")
    losses = sum(1 for p in patterns if p["result"] == "loss")
    setup_not_formed = sum(1 for p in patterns if p["result"] == "setup_not_formed")
    pending = sum(1 for p in patterns if p["result"] == "pending")
    closed = wins + losses
    win_rate = round((wins / closed) * 100, 2) if closed else 0.0

    return {
        "pair": clean_pair, "date": target_date.isoformat(),
        "total_setups": len(patterns), "wins": wins, "losses": losses,
        "setup_not_formed": setup_not_formed, "pending": pending,
        "win_rate": win_rate, "patterns": patterns,
        "candles_count": len(candles), "candles": candles, "skipped": False,
        "data_source": "upload",
        "use_csv_alerts": False,
        "detection_mode": "detector_two_day",
    }

# ─────────────────────────────────────────────────────
# Trade Intelligence
# ─────────────────────────────────────────────────────
@app.post("/api/intelligence/analyze")
async def intelligence_analyze(req: AnalyzeRequest):
    """
    Full behavioral analysis of trade journal.
    Returns stats, insights, patterns.
    Frontend sends its localStorage trades here.
    """
    try:
        trades_dicts = [t.model_dump() for t in req.trades]
        coach = TradeCoach(trades_dicts)
        return coach.get_full_analysis()
    except Exception:
        logger.error("Intelligence analyze error")
        raise HTTPException(
            status_code=500,
            detail="Analysis failed. Please try again."
        )

@app.post("/api/intelligence/ask")
async def intelligence_ask(req: AskRequest):
    """
    RAG Q&A: answer a question about trade journal.
    Retrieves relevant trades, generates grounded answer.
    """
    if not req.question or len(req.question.strip()) < 3:
        raise HTTPException(
            status_code=400,
            detail="Question must be at least 3 characters."
        )

    try:
        trades_dicts = [t.model_dump() for t in req.trades]
        coach = TradeCoach(trades_dicts)
        return coach.answer_question(req.question.strip())
    except Exception:
        logger.error("Intelligence ask error")
        raise HTTPException(
            status_code=500,
            detail="Could not answer question. Please try again."
        )


@app.post("/api/intelligence/trade-analysis")
async def intelligence_trade_analysis(req: TradeAnalysisRequest):
    """
    Score a possible future trade against journal behavior history.
    Returns decision-support context only, never buy/sell instructions.
    """
    try:
        trades_dicts = [t.model_dump() for t in req.trades]
        candidate = req.trade.model_dump()
        coach = TradeCoach(trades_dicts)
        return coach.analyze_trade_setup(candidate)
    except Exception:
        logger.error("Trade setup analysis error")
        raise HTTPException(
            status_code=500,
            detail="Trade analysis failed. Please try again."
        )


@app.post("/api/intelligence/mistake-summary")
async def intelligence_mistake_summary(req: MistakeSummaryRequest):
    """
    Summarize repeated journal mistakes using Gemini when configured.
    Falls back to deterministic local analysis when GEMINI_API_KEY is absent.
    """
    try:
        trades_dicts = [t.model_dump() for t in req.trades]
        return build_mistake_summary(trades_dicts, limit=req.limit)
    except Exception:
        logger.error("Mistake summary error")
        raise HTTPException(
            status_code=500,
            detail="Mistake summary failed. Please try again."
        )


@app.post("/api/intelligence/journal-summary")
async def intelligence_journal_summary(req: JournalSummaryRequest):
    """
    Return deterministic journal analytics first, with optional Gemini summarization.
    Gemini is server-side only and falls back safely when GEMINI_API_KEY is absent.
    """
    try:
        trades_dicts = [t.model_dump() for t in req.trades]
        return build_journal_summary(
            trades_dicts,
            profile_summary=req.profile_summary,
            limit=req.limit,
        )
    except Exception:
        logger.error("Journal summary error")
        raise HTTPException(
            status_code=500,
            detail="Journal summary failed. Please try again."
        )


@app.post("/api/journal/parse-trades")
async def journal_parse_trades(req: JournalTradeParseRequest, authorization: str | None = Header(default=None)):
    """
    Parse natural-language trade descriptions into structured journal rows.
    Gemini stays server-side and falls back safely when unavailable.
    """
    user_id = _authenticated_user_id(authorization)
    if len(req.text or "") > MAX_PARSE_TEXT_CHARS:
        raise HTTPException(status_code=400, detail="Input too long. Maximum 2000 characters.")
    rate_limited = _rate_limit_response(user_id, "/api/journal/parse-trades", 20, 60)
    if rate_limited:
        return rate_limited

    try:
        return parse_trade_entries(
            req.text,
            timezone=req.timezone,
            default_date=req.default_date,
        )
    except Exception:
        logger.error("Journal trade parser error")
        raise HTTPException(
            status_code=500,
            detail="Journal trade parser failed. Please try again."
        )


@app.post("/api/journal/import-file")
async def journal_import_file(
    file: UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    """
    Use Gemini to map uploaded CSV/XLSX columns, then apply that mapping deterministically.
    Gemini never rewrites row values; the backend maps the original file cells.
    """
    user_id = _authenticated_user_id(authorization)
    rate_limited = _rate_limit_response(user_id, "/api/journal/import-file", 10, 60)
    if rate_limited:
        return rate_limited

    filename = str(file.filename or "")
    suffix = Path(filename).suffix.lower()
    if suffix not in {".csv", ".xlsx"}:
        raise HTTPException(status_code=400, detail="Smart Import accepts only .csv and .xlsx files.")

    file_bytes = await file.read()
    if len(file_bytes or b"") > MAX_FILE_BYTES:
        raise HTTPException(status_code=400, detail="Smart Import files must be 5MB or smaller.")

    try:
        headers, rows = parse_uploaded_file(file_bytes, filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if len(rows) > MAX_IMPORT_ROWS:
        raise HTTPException(status_code=400, detail="File too large. Maximum 5000 rows.")

    try:
        column_mapping, used_fallback = get_column_mapping(headers, rows[:5])
        data_origin = DETERMINISTIC_FALLBACK_ORIGIN if used_fallback else GEMINI_FILE_IMPORT_ORIGIN
        trades = apply_mapping(rows, column_mapping, data_origin=data_origin)
        warnings = mapping_warnings(column_mapping)
        if used_fallback:
            warnings = [DETERMINISTIC_FALLBACK_WARNING, *warnings]
        return {
            "trades": trades,
            "column_mapping": column_mapping,
            "warnings": warnings,
            "provider": "gemini",
            "llm_enabled": not used_fallback,
        }
    except GeminiSmartImportError as exc:
        return {
            "trades": [],
            "column_mapping": {},
            "warnings": [exc.warning],
            "provider": "gemini",
            "llm_enabled": False,
        }
    except Exception:
        logger.error("Journal smart import failed")
        return {
            "trades": [],
            "column_mapping": {},
            "warnings": ["Gemini smart import unavailable because the import request failed."],
            "provider": "gemini",
            "llm_enabled": False,
        }


@app.post("/api/datasets/trade-export")
async def trade_dataset_export(req: TradeDatasetExportRequest):
    """
    Convert journal trades into a model-ready dataset.
    Returns JSON only; no files are written by this endpoint.
    """
    try:
        return build_trade_dataset(req.trades, include_edgar=req.include_edgar)
    except Exception:
        logger.error("Trade dataset export error")
        raise HTTPException(
            status_code=500,
            detail="Dataset export failed. Please try again."
        )


@app.get("/api/edgar/context/{ticker}")
async def edgar_context(ticker: str):
    """
    Prototype SEC EDGAR context endpoint for US public-company tickers.
    This is not connected to Trade Intelligence or model training yet.
    """
    try:
        return build_edgar_context_for_ticker(ticker)
    except Exception:
        logger.error("EDGAR context error")
        return {
            "ticker": str(ticker or "").upper(),
            "cik": None,
            "company_name": None,
            "available": False,
            "recent_filings": [],
            "core_facts": {"available": False, "facts": {}, "warnings": []},
            "warnings": ["EDGAR context lookup failed. Please try again later."],
        }


from datetime import datetime

_ticker_cache: dict = {"data": None, "ts": None}

TICKER_SYMBOLS = [
    "RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS", "SBIN.NS", "TATAMOTORS.NS",
    "NVDA", "AAPL", "MSFT", "AMZN",
    "^NSEI", "^GSPC"
]

@app.get("/api/ticker")
async def api_ticker():
    """Live price + change % for ticker tape. Cached 5 minutes."""
    now = datetime.now()
    if _ticker_cache["data"] and _ticker_cache["ts"]:
        from datetime import timedelta
        if now - _ticker_cache["ts"] < timedelta(minutes=5):
            return _ticker_cache["data"]

    results = []
    for sym in TICKER_SYMBOLS:
        try:
            q = fetch_quote(sym)
            if q.get("current_price"):
                results.append({
                    "symbol": sym,
                    "display": sym.replace(".NS", "").replace(".BO", "").replace("=X", "").replace("=F", "").replace("^", ""),
                    "price": q["current_price"],
                    "change_pct": q.get("change_pct", 0),
                    "currency": q.get("currency", "INR"),
                })
        except Exception:
            pass  # skip failed symbols silently

    response = {"data": results, "count": len(results), "timestamp": now.isoformat()}
    _ticker_cache["data"] = response
    _ticker_cache["ts"] = now
    return response


@app.post("/api/intelligence/copilot")
async def intelligence_journal_copilot(authorization: str | None = Header(default=None)):
    """
    Read-only journal behavior analysis for the authenticated Supabase user.
    The user id is derived only from the Supabase JWT, never from request body data.
    """
    user_id = _authenticated_user_id(authorization)
    rate_limited = _rate_limit_response(user_id, "/api/intelligence/copilot", 5, 60)
    if rate_limited:
        return rate_limited

    return analyze_journal(user_id)


# ─────────────────────────────────────────────────────
# /api/market-overview — Categorized live market data
# ─────────────────────────────────────────────────────
_market_cache: dict = {"data": None, "ts": None}

MARKET_CATEGORIES = {
    "Indian Stocks": [
        "RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS",
        "ICICIBANK.NS", "SBIN.NS", "WIPRO.NS", "BAJFINANCE.NS",
        "TATAMOTORS.NS", "AXISBANK.NS"
    ],
    "US Stocks": ["NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META"],
    "Indices": ["^NSEI", "^NSEBANK", "^BSESN", "^GSPC", "^DJI"],
    "Commodities": ["GC=F", "SI=F", "CL=F", "NG=F"],
    "Forex": ["USDINR=X", "EURINR=X", "GBPINR=X", "EURUSD=X"],
}

@app.get("/api/market-overview")
async def api_market_overview():
    """Live prices for top assets across categories. Cached 10 minutes."""
    now = datetime.now()
    if _market_cache["data"] and _market_cache["ts"]:
        from datetime import timedelta
        if now - _market_cache["ts"] < timedelta(minutes=10):
            return _market_cache["data"]

    result = {}
    for category, symbols in MARKET_CATEGORIES.items():
        items = []
        for sym in symbols:
            try:
                q = fetch_quote(sym)
                if q.get("current_price"):
                    items.append({
                        "symbol": sym,
                        "display": sym.replace(".NS", "").replace(".BO", "").replace("=X", "").replace("=F", "").replace("^", ""),
                        "name": q.get("name", sym),
                        "price": q["current_price"],
                        "change_pct": q.get("change_pct", 0),
                        "currency": q.get("currency", "INR"),
                        "sector": q.get("sector", ""),
                    })
            except Exception:
                pass
        result[category] = items

    response = {"categories": result, "timestamp": now.isoformat()}
    _market_cache["data"] = response
    _market_cache["ts"] = now
    return response
