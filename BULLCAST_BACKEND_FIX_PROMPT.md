# Bullcast Algo Trading — Backend Fix Prompt for Claude Code

> **HOW TO USE:** Copy everything below the horizontal rule and paste it as a single prompt into a Claude Code session opened at the root of the `D:\Bullcast` directory.

---

## PROMPT START

You are fixing the backend of **Bullcast**, a professional algorithmic trading platform built on FastAPI + React. The goal is to make it work like a real trading workstation (inspired by TradeStation's professional algo platform). I am going to give you the full context — what is broken, the exact files to touch, and what the correct code looks like. Do not change any files outside the ones listed. Do not install any new packages. Work through the fixes in order.

---

## CONTEXT: What is TradeStation and Why Does It Matter

TradeStation is a professional algo trading platform (est. 1991) that Bullcast is modeled after. After researching it thoroughly, these are the patterns we are implementing:

1. **Signal Confidence Display** — Every signal has a numeric confidence score (0–100%), color-coded green/amber/grey. Never shows 0% or "—" for a live signal.
2. **Market Regime Context** — Every signal is accompanied by a regime label: "Bullish Trend", "Bearish Trend", "Volatile", or "Ranging" — plus a confidence score. This tells the trader whether market conditions favor the signal.
3. **Kelly Criterion Position Sizing** — Every passed signal shows how much capital fraction to risk (half-Kelly formula). This is TradeStation's equivalent of its position sizing module.
4. **Paper Trade Log** — TradeStation's simulated trading stores every paper trade with full detail: entry, stop, target, P&L. The log feeds back into model health calculation. Currently Bullcast discards all paper trades immediately.
5. **Model Health Badge** — A live system status indicator. Shows "Healthy", "Degraded", or "Stale" based on actual trade performance. Currently always "Stale" because it receives an empty trade list.
6. **Strategy Parameter Configuration** — TradeStation's EasyLanguage allows traders to adjust strategy inputs (streak length, pullback candles, RR target) without touching code. Bullcast hardcodes everything.

---

## CONTEXT: Current Architecture

```
React UI (localhost:5173) → FastAPI (localhost:8000) → yfinance → detect_streak_pullback_setups()
```

The strategy logic is already correct. The problems are all in the API layer.

---

## CONTEXT: The Core Bug — Response Format Mismatch

The React frontend (`trading-ui/src/pages/AlgoTrading.jsx`, line 105) reads:
```js
const sigOut = data.signal_output || data;
```

And then:
```js
const sig = latestSig?.signal_output || latestSig;
const sigConf = sig?.confidence != null ? `${(sig.confidence * 100).toFixed(1)}%` : "—";
const regime  = latestSig?.regime;
const kelly   = latestSig?.kelly;
```

The backend currently returns a **flat** dict like:
```json
{ "symbol": "EURUSD=X", "signal": "BUY", "confidence": 0.85, "passed": true, ... }
```

The frontend expects this **nested** shape:
```json
{
  "signal_output": {
    "signal": "BUY",
    "confidence": 0.85,
    "atr_14": 0.0025
  },
  "passed": true,
  "entry": 1.1234,
  "stop_loss": 1.1200,
  "target_price": 1.1302,
  "regime": { "regime": "Bullish Trend", "confidence": 0.72 },
  "kelly":  { "fraction": 0.04, "quantity": 0, "risk_amount_inr": 0 },
  "timestamp": "2026-05-16T09:00:00Z"
}
```

Because of this mismatch: confidence shows 0%, regime shows "—", Kelly shows "—", and the Explain button never appears.

---

## FILES TO MODIFY

Only two files:
1. `backend/algo/router.py` — primary file, all 6 fixes go here
2. `backend/algo/advanced/drift_detector.py` — one fix: handle empty trade list gracefully

Do NOT touch:
- `backend/datasets/pattern_alert_journal.py` (strategy logic is correct)
- `backend/algo/live/feed.py` (feed loop is already fixed)
- `trading-ui/` (frontend is Phase 2)
- Any other file

---

## FIX 1 — Normalize the Signal Response Shape

**In `backend/algo/router.py`**, find the `GET /api/algo/signal/{symbol}` endpoint (or the `_run_full_pipeline()` call inside it). After computing `signal_dict`, reshape the return value into the nested structure the frontend expects:

```python
return {
    "signal_output": {
        "signal":     signal_dict["signal"],
        "confidence": signal_dict["confidence"],
        "atr_14":     signal_dict.get("risk_distance", 0),
    },
    "passed":      signal_dict["passed"],
    "reason":      signal_dict.get("reason"),
    "entry":       signal_dict.get("entry"),
    "stop_loss":   signal_dict.get("stop_loss"),
    "target_price":signal_dict.get("target_price"),
    "streak_length":             signal_dict.get("streak_length"),
    "pullback_candles":          signal_dict.get("pullback_candles"),
    "midpoint_touched":          signal_dict.get("midpoint_touched"),
    "structural_target_source":  signal_dict.get("structural_target_source"),
    "current_price":             signal_dict.get("current_price"),
    "symbol":      signal_dict["symbol"],
    "interval":    signal_dict["interval"],
    "regime":      _detect_regime(candles_raw),   # Fix 2 helper
    "kelly":       _calc_kelly(signal_dict),       # Fix 3 helper
    "timestamp":   signal_dict["timestamp"],
}
```

`candles_raw` is the list of candle dicts already fetched to compute the signal. Pass it through to `_detect_regime`.

---

## FIX 2 — Add `_detect_regime()` Helper

**In `backend/algo/router.py`**, add this module-level helper function (above the router endpoint):

```python
def _detect_regime(candles: list[dict]) -> dict:
    """
    Rule-based regime detection on the last 60 candles.
    No ML — pure price-action math. TradeStation-style market context.
    Returns: {"regime": str, "confidence": float}
    """
    if len(candles) < 20:
        return {"regime": "Unknown", "confidence": 0.0}

    closes = [float(c["close"]) for c in candles[-60:]]
    highs  = [float(c["high"])  for c in candles[-60:]]
    lows   = [float(c["low"])   for c in candles[-60:]]

    # SMA-20 slope (compare current SMA-20 to SMA-20 from 10 bars ago)
    sma20      = sum(closes[-20:]) / 20
    sma20_prev = sum(closes[-30:-10]) / 20 if len(closes) >= 30 else sma20
    slope_pct  = (sma20 - sma20_prev) / sma20_prev * 100 if sma20_prev else 0

    # ATR-14 as percentage of current price
    trs = []
    for i in range(1, min(16, len(highs))):
        h, l, pc = highs[-i], lows[-i], closes[-(i+1)] if i+1 <= len(closes) else closes[-i]
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    atr14   = sum(trs[:14]) / min(14, len(trs)) if trs else 0
    atr_pct = atr14 / closes[-1] * 100 if closes[-1] else 0

    # Classification logic
    if atr_pct > 0.3:
        return {
            "regime":     "Volatile",
            "confidence": round(min(atr_pct / 0.5, 1.0), 2),
        }
    elif slope_pct > 0.05:
        return {
            "regime":     "Bullish Trend",
            "confidence": round(min(abs(slope_pct) / 0.2, 1.0), 2),
        }
    elif slope_pct < -0.05:
        return {
            "regime":     "Bearish Trend",
            "confidence": round(min(abs(slope_pct) / 0.2, 1.0), 2),
        }
    else:
        return {"regime": "Ranging", "confidence": 0.70}
```

---

## FIX 3 — Add `_calc_kelly()` Helper

**In `backend/algo/router.py`**, add this module-level helper:

```python
def _calc_kelly(signal: dict, win_rate: float = 0.45, rr_ratio: float = 2.0) -> dict:
    """
    Half-Kelly position sizing. TradeStation-style risk-based lot sizing.
    Uses conservative defaults until real win rate is computed from trade history.
    Returns: {"fraction": float, "quantity": int, "risk_amount_inr": int}
    """
    if not signal.get("passed"):
        return {"fraction": 0.0, "quantity": 0, "risk_amount_inr": 0}

    # Compute live win rate from paper trade history if available
    if _paper_trades:
        won = sum(1 for t in _paper_trades if t.get("pnl", 0) > 0)
        win_rate = won / len(_paper_trades)
        # Use strategy RR from config
        rr_ratio = _strategy_config.get("rr_target", 2.0)

    b = rr_ratio
    p = win_rate
    q = 1 - p
    raw_fraction = (p * b - q) / b
    fraction = max(0.0, round(raw_fraction * 0.5, 4))  # half-Kelly for safety

    return {
        "fraction":        fraction,
        "quantity":        0,           # requires account size — future feature
        "risk_amount_inr": 0,           # requires account size — future feature
        "win_rate_used":   round(p, 3),
        "rr_used":         b,
    }
```

Note: `_paper_trades` and `_strategy_config` are module-level (defined in Fix 4 and Fix 5). Python resolves these at call time so forward references are fine.

---

## FIX 4 — Add Strategy Config Endpoints

**In `backend/algo/router.py`**, add the following near the top (after imports, before the router endpoints):

```python
from typing import Optional

# Module-level strategy config — persists within a server session
_strategy_config: dict = {
    "min_streak":           4,
    "max_pullback_candles": 2,
    "rr_target":            2.0,
    "max_hold_candles":     36,
}

class StrategyConfigRequest(BaseModel):
    min_streak:           Optional[int]   = None
    max_pullback_candles: Optional[int]   = None
    rr_target:            Optional[float] = None
    max_hold_candles:     Optional[int]   = None
```

Add two new endpoint functions (inside the router):

```python
@router.get("/strategy/config")
async def get_strategy_config() -> dict:
    """Return current strategy parameters. TradeStation EasyLanguage equivalent."""
    return dict(_strategy_config)


@router.post("/strategy/config")
async def set_strategy_config(config: StrategyConfigRequest) -> dict:
    """Update strategy parameters at runtime without restarting the server."""
    _strategy_config.update({k: v for k, v in config.model_dump().items() if v is not None})
    return {"ok": True, "config": dict(_strategy_config)}
```

Then update `_run_full_pipeline()` (or wherever `detect_streak_pullback_setups()` is called) to pass `_strategy_config` values as keyword arguments instead of hardcoded literals. Look for calls like:
```python
detect_streak_pullback_setups(df, min_streak=4, max_pullback_candles=2)
```
and change to:
```python
detect_streak_pullback_setups(
    df,
    min_streak=_strategy_config["min_streak"],
    max_pullback_candles=_strategy_config["max_pullback_candles"],
)
```

---

## FIX 5 — In-Memory Paper Trade Store

**In `backend/algo/router.py`**, add this near the top (after `_strategy_config`):

```python
_paper_trades: list[dict] = []   # rolling window of last 200 paper trades
```

Then find where `place_paper_trade()` is called (inside the signal endpoint or feed loop). After the call, add:

```python
trade = place_paper_trade(...)   # however it's called now
if trade:
    _paper_trades.append(trade)
    _paper_trades[:] = _paper_trades[-200:]   # keep only last 200
```

Find the `GET /api/algo/trades` endpoint. It currently returns an empty list. Update it to:

```python
@router.get("/trades")
async def get_trades() -> dict:
    """Return paper trade history. TradeStation simulated trading log equivalent."""
    return {"trades": list(_paper_trades)}
```

---

## FIX 6 — Model Health Uses Real Trades (Not Empty List)

**In `backend/algo/advanced/drift_detector.py`**, find the `get_model_health()` method. It currently returns `{"status": "stale"}` when given an empty list. Change it so that:

- If `len(trades) == 0` → return `{"status": "healthy", "trade_count": 0, "message": "No trades yet — model nominal"}`
- If `len(trades) < 5` → return `{"status": "healthy", "trade_count": len(trades), "message": "Insufficient trades for drift analysis"}`
- If `len(trades) >= 5` → perform the existing win-rate / drift analysis

**In `backend/algo/router.py`**, find the `GET /api/algo/model-health` endpoint. Update it to pass the real `_paper_trades` list:

```python
@router.get("/model-health")
async def model_health() -> dict:
    from backend.algo.advanced.drift_detector import DriftDetector
    detector = DriftDetector()
    return detector.get_model_health(list(_paper_trades))
```

---

## VERIFICATION CHECKLIST

After making all changes, restart the FastAPI server and verify each fix:

1. `GET /api/algo/signal/EURUSD=X?interval=5m`
   - Response must contain `signal_output.confidence` (non-zero float)
   - Response must contain `regime` object with `regime` and `confidence` keys
   - Response must contain `kelly` object with `fraction` key

2. `GET /api/algo/strategy/config`
   - Must return `{min_streak: 4, max_pullback_candles: 2, rr_target: 2.0, max_hold_candles: 36}`

3. `POST /api/algo/strategy/config` with body `{"rr_target": 3.0}`
   - Must return `{ok: true, config: {..., rr_target: 3.0}}`
   - Subsequent GET must show updated value

4. `GET /api/algo/trades`
   - Must return `{trades: [...]}` (initially empty array is fine, not an error)

5. `GET /api/algo/model-health`
   - With no trades: must return `{status: "healthy"}` not `{status: "stale"}`

6. Open `localhost:5173/algo` in the browser:
   - Confidence KPI chip must show a real % value (e.g. "72.0%")
   - Regime KPI chip must show text (e.g. "Bullish Trend" or "Ranging")
   - Kelly Size KPI chip must show a % value (e.g. "2.25%")
   - Model Health badge must NOT show "Stale"

---

## IMPORTANT NOTES

- The `detect_streak_pullback_setups()` function in `backend/datasets/pattern_alert_journal.py` is correct — do not touch it.
- The live feed loop in `backend/algo/live/feed.py` is already working — do not touch it.
- The `force=True` flag for weekend testing is already implemented — do not touch it.
- The React frontend in `trading-ui/` is not part of this phase — do not touch it.
- Do not create any new files. All changes go in the two files listed.
- Do not add any pip dependencies. Only Python stdlib and what's already installed.

## PROMPT END
