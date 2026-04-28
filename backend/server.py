from __future__ import annotations

import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Final

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from backend.data_loader import CandleCSVError, load_candles_from_csv_path
from backend.gap_handling import generate_trades_and_setups_with_gap_resets
from backend.strategy_lab import StrategyLabError, run_strategy_lab

_INVALID_FILENAME_MSG: Final[str] = "Invalid CSV filename format"
_PAIR_RE: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z0-9]+$")

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
    pine_script: str = Form(""),
):
    candles = await _load_uploaded_candles(file)

    try:
        parameters = json.loads(parameters_json or "{}")
    except Exception as exc:
        raise HTTPException(400, "Invalid parameters JSON.") from exc

    if not isinstance(parameters, dict):
        raise HTTPException(400, "parameters_json must decode to an object.")

    try:
        return run_strategy_lab(
            candles,
            strategy_type=strategy_type,
            parameters=parameters,
            pine_script=pine_script,
        )
    except StrategyLabError as exc:
        raise HTTPException(400, str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc


from backend.market_data import search_symbols, list_assets, fetch_ohlcv, fetch_quote
from backend.backtesting import run_backtest
from pydantic import BaseModel

class BacktestRequest(BaseModel):
    symbol: str
    strategy: str
    period: str = "1y"
    interval: str = "1d"
    initial_capital: float = 100000.0
    commission: float = 0.001
    slippage: float = 0.0005
    sentiment_score: int | None = None

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
