from __future__ import annotations

import json
import logging
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any, Final, List

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from backend.data_loader import CandleCSVError, load_candles_from_csv_path
from backend.datasets import build_trade_dataset
from backend.edgar import build_edgar_context_for_ticker
from backend.gap_handling import generate_trades_and_setups_with_gap_resets
from backend.intelligence.coach import TradeCoach
from backend.journal import JournalTrade
from backend.strategy_lab import StrategyLabError, run_strategy_lab

_INVALID_FILENAME_MSG: Final[str] = "Invalid CSV filename format"
_PAIR_RE: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z0-9]+$")
logger = logging.getLogger(__name__)
ML_TRAINING_REPORT_PATH: Final[Path] = Path(ROOT) / "backend" / "models" / "baseline_training_report.json"

app = FastAPI(title="Backtest API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://bullcast-ruddy.vercel.app",
        "http://localhost:5173",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from backend.sentiment_api import router as sentiment_router
app.include_router(sentiment_router)


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
    return JSONResponse(status_code=500, content={"error": str(exc)})


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/run-backtest")
async def run_backtest(file: UploadFile = File(...)):
    candles = await _load_uploaded_candles(file)

    try:
        trades, setups = generate_trades_and_setups_with_gap_resets(candles)
    except Exception as e:
        raise HTTPException(500, str(e))

    return {"candles": candles, "setups": setups, "trades": trades}


@app.post("/run-strategy")
async def run_strategy(
    file: UploadFile = File(...),
    strategy_type: str = Form(...),
    parameters_json: str = Form("{}"),
):
    candles = await _load_uploaded_candles(file)

    try:
        parameters = json.loads(parameters_json or "{}")
    except Exception as exc:
        raise HTTPException(400, "Invalid parameters JSON.") from exc

    if not isinstance(parameters, dict):
        raise HTTPException(400, "parameters_json must decode to an object.")

    try:
        # REMOVED: Pine Script endpoint/handler — feature deprecated
        normalized_strategy_type = str(strategy_type or "").strip().lower().replace("-", " ").replace("_", " ")
        if normalized_strategy_type in {"pine", "pine script"}:
            raise HTTPException(400, "Pine Script is deprecated. Use Moving Average, RSI, or Breakout strategies.")
            
        return run_strategy_lab(
            candles,
            strategy_type=strategy_type,
            parameters=parameters,
        )
    except StrategyLabError as exc:
        raise HTTPException(400, str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc


from backend.market_data import search_symbols, list_assets, fetch_ohlcv, fetch_quote
from backend.backtesting import run_backtest
from pydantic import BaseModel, ConfigDict, Field, model_validator
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

class BacktestRequest(BaseModel):
    symbol: str
    strategy: str
    period: str = "1y"
    interval: str = "1d"
    initial_capital: float = 100000.0
    commission: float = 0.001
    slippage: float = 0.0005
    sentiment_score: int | None = None

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

VALID_STRATEGIES = ["sma_cross", "rsi", "macd", "bollinger", "sentiment_sma"]

@app.get("/api/search")
async def search_api(q: str = "", limit: int = 8):
    return search_symbols(q, limit)

@app.get("/api/assets")
async def assets_api(type: str | None = None):
    return list_assets(type)

@app.get("/api/history")
async def history_api(symbol: str, period: str = "1y", interval: str = "1d"):
    return fetch_ohlcv(symbol, period, interval)

@app.get("/api/quote")
async def quote_api(symbol: str):
    return fetch_quote(symbol)

@app.post("/api/backtest")
async def api_run_backtest(req: BacktestRequest):
    if req.strategy not in VALID_STRATEGIES:
        raise HTTPException(status_code=400, detail=f"Invalid strategy: {req.strategy}")
        
    try:
        records = fetch_ohlcv(req.symbol, period=req.period, interval=req.interval)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Market data error: {str(e)}")
        
    try:
        result = run_backtest(
            df_records=records,
            strategy=req.strategy,
            initial_capital=req.initial_capital,
            commission=req.commission,
            slippage=req.slippage
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Engine failure: {str(e)}")


# ─────────────────────────────────────────────────────
# /api/ticker — Live prices for ticker tape
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
    except Exception as e:
        logger.error(f"Intelligence analyze error: {e}")
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
    except Exception as e:
        logger.error(f"Intelligence ask error: {e}")
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
    except Exception as e:
        logger.error(f"Trade setup analysis error: {e}")
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
    except Exception as e:
        logger.error(f"Mistake summary error: {e}")
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
    except Exception as e:
        logger.error(f"Journal summary error: {e}")
        raise HTTPException(
            status_code=500,
            detail="Journal summary failed. Please try again."
        )


@app.post("/api/journal/parse-trades")
async def journal_parse_trades(req: JournalTradeParseRequest):
    """
    Parse natural-language trade descriptions into structured journal rows.
    Gemini stays server-side and falls back safely when unavailable.
    """
    try:
        return parse_trade_entries(
            req.text,
            timezone=req.timezone,
            default_date=req.default_date,
        )
    except Exception as e:
        logger.error(f"Journal trade parser error: {e}")
        raise HTTPException(
            status_code=500,
            detail="Journal trade parser failed. Please try again."
        )


@app.post("/api/journal/import-file")
async def journal_import_file(file: UploadFile = File(...)):
    """
    Use Gemini to map uploaded CSV/XLSX columns, then apply that mapping deterministically.
    Gemini never rewrites row values; the backend maps the original file cells.
    """
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
    except Exception as exc:
        logger.exception("Journal smart import failed")
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
    except Exception as e:
        logger.error(f"Trade dataset export error: {e}")
        raise HTTPException(
            status_code=500,
            detail="Dataset export failed. Please try again."
        )


@app.get("/api/ml/training-report")
async def ml_training_report():
    """
    Read-only development endpoint for the latest baseline training report.
    This does not train, load a model, or expose predictions.
    """
    if not ML_TRAINING_REPORT_PATH.exists():
        return {
            "available": False,
            "message": "No training report found. Run baseline training first.",
        }

    try:
        report = json.loads(ML_TRAINING_REPORT_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        logger.error(f"Training report read error: {e}")
        raise HTTPException(
            status_code=500,
            detail="Training report could not be read."
        )

    return {
        "available": True,
        "dev_only": True,
        "synthetic_warning": "DEV / SYNTHETIC TEST ONLY. Not real model performance.",
        "report": report,
    }


@app.get("/api/edgar/context/{ticker}")
async def edgar_context(ticker: str):
    """
    Prototype SEC EDGAR context endpoint for US public-company tickers.
    This is not connected to Trade Intelligence or model training yet.
    """
    try:
        return build_edgar_context_for_ticker(ticker)
    except Exception as e:
        logger.error(f"EDGAR context error: {e}")
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


async def _load_uploaded_candles(file: UploadFile) -> list[dict]:
    try:
        _infer_market_pair_from_filename(file.filename)
    except ValueError:
        raise HTTPException(400, _INVALID_FILENAME_MSG)

    try:
        with tempfile.TemporaryDirectory(prefix="algotradex_upload_") as tmp:
            tmp_path = Path(tmp)
            csv_path = tmp_path / "uploaded.csv"
            await file.seek(0)
            with csv_path.open("wb") as out:
                shutil.copyfileobj(file.file, out)
            if csv_path.stat().st_size <= 0:
                raise HTTPException(400, "Empty CSV")
            return load_candles_from_csv_path(csv_path)
    except CandleCSVError as exc:
        raise HTTPException(400, str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc


def _infer_market_pair_from_filename(filename: str | None) -> tuple[str, str]:
    name = Path(str(filename or "")).name
    if not name:
        raise ValueError(_INVALID_FILENAME_MSG)

    # Require a .csv extension (case-insensitive).
    if Path(name).suffix.lower() != ".csv":
        raise ValueError(_INVALID_FILENAME_MSG)

    stem = name[: -len(".csv")]

    if stem.startswith("FX_"):
        market = "forex"
        rest = stem[len("FX_") :]
    elif stem.startswith("BINANCE_"):
        market = "crypto"
        rest = stem[len("BINANCE_") :]
    else:
        raise ValueError(_INVALID_FILENAME_MSG)

    pair = rest.split("_", 1)[0]
    if not pair:
        raise ValueError(_INVALID_FILENAME_MSG)
    if not _PAIR_RE.match(pair):
        raise ValueError(_INVALID_FILENAME_MSG)
    return market, pair
