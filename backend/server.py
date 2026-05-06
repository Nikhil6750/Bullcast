from __future__ import annotations

import json
import logging
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Final, List, Optional

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
from backend.strategy_lab import StrategyLabError, run_strategy_lab

_INVALID_FILENAME_MSG: Final[str] = "Invalid CSV filename format"
_PAIR_RE: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z0-9]+$")
logger = logging.getLogger(__name__)
ML_TRAINING_REPORT_PATH: Final[Path] = Path(ROOT) / "backend" / "models" / "baseline_training_report.json"

app = FastAPI(title="Backtest API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
from pydantic import BaseModel, Field

class BacktestRequest(BaseModel):
    symbol: str
    strategy: str
    period: str = "1y"
    interval: str = "1d"
    initial_capital: float = 100000.0
    commission: float = 0.001
    slippage: float = 0.0005
    sentiment_score: int | None = None

class TradeEntry(BaseModel):
    id: str
    date: str
    symbol: str
    asset_type: Optional[str] = None
    type: str
    entry_price: float
    exit_price: float
    quantity: int
    pnl: float
    pnl_pct: Optional[float] = 0
    result: str
    notes: Optional[str] = ""
    setup_tag: Optional[str] = None
    mistake_tag: Optional[str] = None
    confidence_score: Optional[int] = None
    planned_risk: Optional[float] = None
    planned_reward: Optional[float] = None
    rule_followed: Optional[bool] = None
    entry_reason: Optional[str] = None
    exit_reason: Optional[str] = None

class AnalyzeRequest(BaseModel):
    trades: List[TradeEntry]

class AskRequest(BaseModel):
    trades: List[TradeEntry]
    question: str

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
