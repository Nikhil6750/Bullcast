# Bullcast — Backend Phase 2 Prompt

> Paste everything below the line into Claude Code at D:\Bullcast

---

## CONTEXT

You are working on the Bullcast algorithmic trading platform. The backend is FastAPI. The Phase 1 fixes are already done — the signal endpoint returns the correct nested shape with `signal_output`, `regime`, and `kelly` keys. Two files need changes in this phase:

1. `backend/algo/router.py`
2. `backend/algo/advanced/drift_detector.py` (already fixed, do not touch)

Do NOT touch any other file. No new pip packages.

---

## BUG 1 — HOLD confidence is 1.0 (should be 0.0)

**File:** `backend/algo/router.py`

In `_run_full_pipeline()`, find the two early-return blocks that return HOLD signals. Both currently return `"confidence": 1.0`. This is wrong — a HOLD means no setup was found, so confidence should be `0.0`.

Find these two blocks:

```python
# Block 1 — insufficient data
return (
    {
        ...
        "signal": "HOLD", "confidence": 1.0,   # ← wrong
        ...
    },
    candles_raw,
)

# Block 2 — no setup on latest candle
return (
    {
        ...
        "signal": "HOLD", "confidence": 1.0,   # ← wrong
        ...
    },
    candles_raw,
)
```

Change **both** to `"confidence": 0.0`.

---

## FEATURE 2 — Open Positions Tracking

**File:** `backend/algo/router.py`

Currently `_paper_trades` stores every trade that was ever placed, but there is no concept of "open" vs "closed". Traders need to see what positions are currently active.

Add a second module-level list:

```python
_open_positions: list[dict] = []   # trades currently open (not yet closed)
```

### New endpoint: `POST /api/algo/position/open`

When a paper trade is placed via `POST /api/algo/trade/place`, also add it to `_open_positions`. Each open position entry should have:

```python
{
    "id":           str(uuid.uuid4())[:8],
    "symbol":       trade["symbol"],
    "side":         trade["side"],          # "BUY" or "SELL"
    "entry":        trade["entry"],
    "stop_loss":    trade["stop_loss"],
    "target_price": trade["target_price"],
    "confidence":   trade.get("confidence", 0),
    "regime":       trade.get("regime", "Unknown"),
    "kelly_fraction": trade.get("kelly_fraction", 0),
    "opened_at":    datetime.now().isoformat(),
    "current_price": trade["entry"],        # updated on close
    "unrealized_pnl": 0.0,
}
```

Update the `place_trade` endpoint to append to `_open_positions` as well as `_paper_trades`:

```python
@router.post("/trade/place")
async def place_trade(req: PlaceTradeRequest) -> dict:
    from backend.algo.paper_trader.trader import place_paper_trade
    result = place_paper_trade(...)
    if result is None:
        raise HTTPException(status_code=400, detail="Signal did not pass validation")

    _paper_trades.append(result)
    _paper_trades[:] = _paper_trades[-200:]

    # Also track as open position
    position = {
        "id":             str(uuid.uuid4())[:8],
        "symbol":         result.get("symbol", req.validated_signal.get("symbol", "")),
        "side":           result.get("side", req.validated_signal.get("signal", "")),
        "entry":          result.get("entry", req.validated_signal.get("entry", 0)),
        "stop_loss":      result.get("stop_loss", req.validated_signal.get("stop_loss", 0)),
        "target_price":   result.get("target_price", req.validated_signal.get("target_price", 0)),
        "confidence":     req.validated_signal.get("confidence", 0),
        "regime":         req.validated_signal.get("regime", "Unknown"),
        "kelly_fraction": req.validated_signal.get("kelly_fraction", 0),
        "opened_at":      datetime.now().isoformat(),
        "unrealized_pnl": 0.0,
    }
    _open_positions.append(position)
    return {**result, "position_id": position["id"]}
```

### New endpoint: `GET /api/algo/positions`

```python
@router.get("/positions")
async def get_open_positions() -> dict:
    """Return all currently open paper positions."""
    return {"positions": list(_open_positions)}
```

### New endpoint: `DELETE /api/algo/position/{position_id}`

Allow closing a position manually:

```python
@router.delete("/position/{position_id}")
async def close_position(position_id: str, exit_price: float = 0.0) -> dict:
    global _open_positions
    pos = next((p for p in _open_positions if p["id"] == position_id), None)
    if not pos:
        raise HTTPException(status_code=404, detail="Position not found")

    # Calculate P&L
    entry = pos["entry"]
    side  = pos["side"]
    pnl   = (exit_price - entry) if side == "BUY" else (entry - exit_price)
    pnl_pct = (pnl / entry * 100) if entry else 0

    closed = {
        **pos,
        "closed_at":   datetime.now().isoformat(),
        "exit_price":  exit_price,
        "realized_pnl": round(pnl, 6),
        "pnl_pct":     round(pnl_pct, 4),
        "outcome":     "WIN" if pnl > 0 else "LOSS",
    }

    _open_positions[:] = [p for p in _open_positions if p["id"] != position_id]
    _paper_trades.append(closed)
    _paper_trades[:] = _paper_trades[-200:]

    return {"ok": True, "closed": closed}
```

---

## FEATURE 3 — Trade Statistics Endpoint

**File:** `backend/algo/router.py`

Add a new endpoint that computes live performance stats from `_paper_trades`. This powers the win rate, P&L, and equity curve in the frontend.

```python
@router.get("/stats")
async def get_trade_stats() -> dict:
    """
    Compute live performance statistics from paper trade history.
    Only counts closed trades (those with 'realized_pnl' or 'pnl' key).
    """
    from datetime import date

    closed = [t for t in _paper_trades if "realized_pnl" in t or "pnl" in t]
    if not closed:
        return {
            "total_trades":  0,
            "win_rate":      0.0,
            "avg_rr":        0.0,
            "total_pnl":     0.0,
            "today_pnl":     0.0,
            "open_positions": len(_open_positions),
            "equity_curve":  [],
        }

    today_str = date.today().isoformat()
    wins      = [t for t in closed if t.get("outcome") == "WIN" or t.get("pnl", 0) > 0]
    today_closed = [t for t in closed if (t.get("closed_at") or t.get("timestamp", ""))[:10] == today_str]

    total_pnl  = sum(t.get("realized_pnl", t.get("pnl", 0)) for t in closed)
    today_pnl  = sum(t.get("realized_pnl", t.get("pnl", 0)) for t in today_closed)
    win_rate   = len(wins) / len(closed) if closed else 0.0

    # Equity curve: running sum of P&L over all closed trades
    running = 0.0
    equity_curve = []
    for t in closed:
        running += t.get("realized_pnl", t.get("pnl", 0))
        equity_curve.append({
            "time": t.get("closed_at", t.get("timestamp", "")),
            "equity": round(running, 6),
        })

    return {
        "total_trades":   len(closed),
        "win_rate":       round(win_rate, 4),
        "wins":           len(wins),
        "losses":         len(closed) - len(wins),
        "avg_rr":         0.0,       # requires target_price tracking — future
        "total_pnl":      round(total_pnl, 6),
        "today_pnl":      round(today_pnl, 6),
        "open_positions": len(_open_positions),
        "equity_curve":   equity_curve[-50:],   # last 50 points
    }
```

---

## VERIFICATION

After making changes, restart the server and check:

1. `GET /api/algo/signal/EURUSD=X?interval=5m`
   - When signal is HOLD: `signal_output.confidence` must be `0.0` not `1.0`
   - When signal is BUY/SELL: confidence should remain whatever the strategy returns

2. `GET /api/algo/positions`
   - Must return `{"positions": []}` initially (empty array, not error)

3. `GET /api/algo/stats`
   - Must return `{"total_trades": 0, "win_rate": 0.0, "today_pnl": 0.0, "open_positions": 0, ...}`

4. Python syntax check both modified files:
   ```bash
   python3 -c "import ast; ast.parse(open('backend/algo/router.py').read()); print('OK')"
   ```

## END OF PROMPT
