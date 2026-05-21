# Claude Code Prompt — Bullcast Phase 2: Forex Focus + LSTM + TradingView Interface

## Project Root
`D:/Bullcast/` — FastAPI backend (`backend/`), React/Vite frontend (`trading-ui/src/`)

Read every file you touch before editing. Run `python -m pytest tests -q` after each phase.

---

## Fix 1 — 'close' KeyError (Do This First)

The error `✗ SYMBOL — 'close'` means the DataFrame has no lowercase `close` column at some point in the pipeline. Two root causes to fix:

**Fix `backend/market_data/fetcher.py`:**
After `df = ticker.history(...)`, add column normalization before iterating rows:
```python
df.columns = [c.lower() for c in df.columns]
```
Then access `row["close"]`, `row["open"]`, `row["high"]`, `row["low"]`, `row["volume"]` (all lowercase).
Also handle empty df: if `df.empty` after fetch, return `[]` instead of raising.

**Fix `backend/algo/features/pipeline.py`:**
At the top of `compute_features()`, after `df = pd.DataFrame(candles)`, add:
```python
df.columns = [c.lower() if isinstance(c, str) else c for c in df.columns]
if "close" not in df.columns:
    raise ValueError(f"No 'close' column in candle data. Got: {list(df.columns)}")
if df.empty or len(df) < 10:
    raise ValueError("Insufficient candle data for feature computation")
```

**Fix `backend/algo/features/multi_timeframe.py`:**
The resample logic must not hardcode `"1m"` → `"5m"` etc. Make it dynamic based on the actual base interval detected from the DataFrame's time index spacing. Add a helper:
```python
def _detect_base_interval(df: pd.DataFrame) -> str:
    if not isinstance(df.index, pd.DatetimeIndex) or len(df) < 2:
        return "5m"
    median_gap = pd.Series(df.index).diff().median()
    minutes = int(median_gap.total_seconds() / 60)
    if minutes <= 1: return "1m"
    if minutes <= 5: return "5m"
    if minutes <= 15: return "15m"
    if minutes <= 60: return "1h"
    return "1d"
```
Then use `MTF_MAP`:
```python
MTF_MAP = {
    "1m":  ["5min",  "15min", "1h"],
    "5m":  ["15min", "1h",   "4h"],
    "15m": ["1h",    "4h",   "1D"],
    "1h":  ["4h",    "1D",   "1W"],
}
```
Use pandas `resample(freq)` with `ohlc()` for price and `sum()` for volume. Forward-fill back to base index. Apply `shift(1)` at the base level after merge. If resampling fails for any higher TF, fill those columns with 0 silently.

---

## Fix 2 — Replace Symbol List with Forex Only

**Replace the entire contents of `backend/market_data/symbols.py`** with the following comprehensive forex list. Use yfinance format (`XXXYYY=X`):

```python
MASTER_SYMBOLS = [
    # --- Major Pairs ---
    {"symbol": "EURUSD=X", "name": "EUR/USD", "type": "forex", "exchange": "FX", "category": "major"},
    {"symbol": "GBPUSD=X", "name": "GBP/USD", "type": "forex", "exchange": "FX", "category": "major"},
    {"symbol": "USDJPY=X", "name": "USD/JPY", "type": "forex", "exchange": "FX", "category": "major"},
    {"symbol": "USDCHF=X", "name": "USD/CHF", "type": "forex", "exchange": "FX", "category": "major"},
    {"symbol": "AUDUSD=X", "name": "AUD/USD", "type": "forex", "exchange": "FX", "category": "major"},
    {"symbol": "USDCAD=X", "name": "USD/CAD", "type": "forex", "exchange": "FX", "category": "major"},
    {"symbol": "NZDUSD=X", "name": "NZD/USD", "type": "forex", "exchange": "FX", "category": "major"},

    # --- Minor / Cross Pairs ---
    {"symbol": "EURGBP=X", "name": "EUR/GBP", "type": "forex", "exchange": "FX", "category": "minor"},
    {"symbol": "EURJPY=X", "name": "EUR/JPY", "type": "forex", "exchange": "FX", "category": "minor"},
    {"symbol": "EURCHF=X", "name": "EUR/CHF", "type": "forex", "exchange": "FX", "category": "minor"},
    {"symbol": "EURAUD=X", "name": "EUR/AUD", "type": "forex", "exchange": "FX", "category": "minor"},
    {"symbol": "EURCAD=X", "name": "EUR/CAD", "type": "forex", "exchange": "FX", "category": "minor"},
    {"symbol": "EURNZD=X", "name": "EUR/NZD", "type": "forex", "exchange": "FX", "category": "minor"},
    {"symbol": "GBPJPY=X", "name": "GBP/JPY", "type": "forex", "exchange": "FX", "category": "minor"},
    {"symbol": "GBPCHF=X", "name": "GBP/CHF", "type": "forex", "exchange": "FX", "category": "minor"},
    {"symbol": "GBPAUD=X", "name": "GBP/AUD", "type": "forex", "exchange": "FX", "category": "minor"},
    {"symbol": "GBPCAD=X", "name": "GBP/CAD", "type": "forex", "exchange": "FX", "category": "minor"},
    {"symbol": "GBPNZD=X", "name": "GBP/NZD", "type": "forex", "exchange": "FX", "category": "minor"},
    {"symbol": "AUDJPY=X", "name": "AUD/JPY", "type": "forex", "exchange": "FX", "category": "minor"},
    {"symbol": "AUDCHF=X", "name": "AUD/CHF", "type": "forex", "exchange": "FX", "category": "minor"},
    {"symbol": "AUDCAD=X", "name": "AUD/CAD", "type": "forex", "exchange": "FX", "category": "minor"},
    {"symbol": "AUDNZD=X", "name": "AUD/NZD", "type": "forex", "exchange": "FX", "category": "minor"},
    {"symbol": "CADJPY=X", "name": "CAD/JPY", "type": "forex", "exchange": "FX", "category": "minor"},
    {"symbol": "CADCHF=X", "name": "CAD/CHF", "type": "forex", "exchange": "FX", "category": "minor"},
    {"symbol": "CHFJPY=X", "name": "CHF/JPY", "type": "forex", "exchange": "FX", "category": "minor"},
    {"symbol": "NZDJPY=X", "name": "NZD/JPY", "type": "forex", "exchange": "FX", "category": "minor"},
    {"symbol": "NZDCHF=X", "name": "NZD/CHF", "type": "forex", "exchange": "FX", "category": "minor"},
    {"symbol": "NZDCAD=X", "name": "NZD/CAD", "type": "forex", "exchange": "FX", "category": "minor"},

    # --- Exotic Pairs ---
    {"symbol": "USDINR=X",  "name": "USD/INR",  "type": "forex", "exchange": "FX", "category": "exotic"},
    {"symbol": "USDSGD=X",  "name": "USD/SGD",  "type": "forex", "exchange": "FX", "category": "exotic"},
    {"symbol": "USDHKD=X",  "name": "USD/HKD",  "type": "forex", "exchange": "FX", "category": "exotic"},
    {"symbol": "USDMXN=X",  "name": "USD/MXN",  "type": "forex", "exchange": "FX", "category": "exotic"},
    {"symbol": "USDZAR=X",  "name": "USD/ZAR",  "type": "forex", "exchange": "FX", "category": "exotic"},
    {"symbol": "USDTRY=X",  "name": "USD/TRY",  "type": "forex", "exchange": "FX", "category": "exotic"},
    {"symbol": "USDNOK=X",  "name": "USD/NOK",  "type": "forex", "exchange": "FX", "category": "exotic"},
    {"symbol": "USDSEK=X",  "name": "USD/SEK",  "type": "forex", "exchange": "FX", "category": "exotic"},
    {"symbol": "USDDKK=X",  "name": "USD/DKK",  "type": "forex", "exchange": "FX", "category": "exotic"},
    {"symbol": "USDPLN=X",  "name": "USD/PLN",  "type": "forex", "exchange": "FX", "category": "exotic"},
    {"symbol": "USDTHB=X",  "name": "USD/THB",  "type": "forex", "exchange": "FX", "category": "exotic"},
    {"symbol": "EURSGD=X",  "name": "EUR/SGD",  "type": "forex", "exchange": "FX", "category": "exotic"},
    {"symbol": "EURINR=X",  "name": "EUR/INR",  "type": "forex", "exchange": "FX", "category": "exotic"},
    {"symbol": "GBPINR=X",  "name": "GBP/INR",  "type": "forex", "exchange": "FX", "category": "exotic"},
    {"symbol": "JPYINR=X",  "name": "JPY/INR",  "type": "forex", "exchange": "FX", "category": "exotic"},
]
```

Also update `_is_valid_symbol()` in `backend/market_data/fetcher.py` — forex pairs don't need special validation beyond existing in the list. Keep the existing check as-is, it will work with the new list.

---

## Fix 3 — Update batch_train.py

**Replace `backend/algo/batch_train.py`** entirely:

```python
from __future__ import annotations
import json, time, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from backend.market_data.symbols import MASTER_SYMBOLS
from backend.algo.model.trainer import train_signal_model

INTERVAL = "5m"
PERIOD   = "60d"
OUTPUT   = "backend/models/algo/batch_train_5m_report.json"

results = []
symbols = MASTER_SYMBOLS  # all forex now

print(f"Training {len(symbols)} forex pairs on {INTERVAL} candles ({PERIOD} history)\n")

for asset in symbols:
    symbol = asset["symbol"]
    category = asset.get("category", "")
    try:
        report = train_signal_model(symbol, period=PERIOD, interval=INTERVAL)
        acc = report.get("metrics", {}).get("mean_accuracy") or report.get("mean_accuracy", 0)
        results.append({"symbol": symbol, "category": category, "status": "ok", "accuracy": round(float(acc), 4), "rows": report.get("training_rows", 0)})
        print(f"  ✓  {symbol:<16} {category:<8}  acc={acc:.3f}  rows={report.get('training_rows',0)}")
    except Exception as e:
        results.append({"symbol": symbol, "category": category, "status": "failed", "reason": str(e)})
        print(f"  ✗  {symbol:<16} {category:<8}  {e}")
    time.sleep(0.8)

os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
with open(OUTPUT, "w") as f:
    json.dump(results, f, indent=2)

ok  = [r for r in results if r["status"] == "ok"]
fail = [r for r in results if r["status"] == "failed"]
print(f"\nDone. {len(ok)} trained, {len(fail)} failed.")
print(f"Report → {OUTPUT}")
```

Also update root `batch_train.py`:
```python
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from backend.algo.batch_train import *
```

---

## Feature 1 — LSTM Signal Model

Add LSTM as a second model alongside XGBoost. They form an ensemble — final signal is a weighted vote.

### `backend/algo/model/lstm_model.py`

```python
"""
LSTM trading signal model.
Architecture: 2-layer LSTM (128 → 64 units) + Dropout(0.2) + Dense(3, softmax)
Input: rolling window of LOOKBACK candles × N features
Output: probabilities for [BUY, HOLD, SELL]
"""
from __future__ import annotations
import numpy as np
import json
from pathlib import Path

LOOKBACK = 60   # candles per sequence
EPOCHS   = 50
BATCH    = 32


def build_lstm(input_shape: tuple, n_classes: int = 3):
    """
    Builds and returns a compiled Keras LSTM model.
    input_shape: (LOOKBACK, n_features)
    """
    try:
        from tensorflow import keras
    except ImportError:
        raise ImportError("pip install tensorflow")

    model = keras.Sequential([
        keras.layers.Input(shape=input_shape),
        keras.layers.LSTM(128, return_sequences=True),
        keras.layers.Dropout(0.2),
        keras.layers.LSTM(64, return_sequences=False),
        keras.layers.Dropout(0.2),
        keras.layers.Dense(32, activation="relu"),
        keras.layers.Dense(n_classes, activation="softmax"),
    ])
    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=0.001),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model


def make_sequences(X: np.ndarray, y: np.ndarray, lookback: int = LOOKBACK):
    """
    Convert flat feature array → overlapping sequences for LSTM input.
    X shape: (n_samples, n_features)
    Returns: X_seq (n_samples-lookback, lookback, n_features), y_seq (n_samples-lookback,)
    """
    X_seq, y_seq = [], []
    for i in range(lookback, len(X)):
        X_seq.append(X[i - lookback:i])
        y_seq.append(y[i])
    return np.array(X_seq), np.array(y_seq)


def train_lstm(
    X: np.ndarray,
    y: np.ndarray,
    output_dir: str,
    symbol: str,
    interval: str,
    lookback: int = LOOKBACK,
) -> dict:
    from sklearn.preprocessing import StandardScaler
    import joblib

    out = Path(output_dir)
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    joblib.dump(scaler, out / f"lstm_scaler_{symbol}_{interval}.joblib")

    X_seq, y_seq = make_sequences(X_scaled, y, lookback)
    if len(X_seq) < 100:
        raise ValueError(f"Not enough sequences after windowing: {len(X_seq)}")

    split = int(len(X_seq) * 0.8)
    X_tr, X_val = X_seq[:split], X_seq[split:]
    y_tr, y_val = y_seq[:split], y_seq[split:]

    model = build_lstm((lookback, X.shape[1]))
    from tensorflow import keras
    cb = [
        keras.callbacks.EarlyStopping(patience=5, restore_best_weights=True),
        keras.callbacks.ReduceLROnPlateau(patience=3, factor=0.5, verbose=0),
    ]
    history = model.fit(
        X_tr, y_tr,
        validation_data=(X_val, y_val),
        epochs=EPOCHS,
        batch_size=BATCH,
        callbacks=cb,
        verbose=0,
    )
    val_acc = float(max(history.history.get("val_accuracy", [0])))
    model.save(str(out / f"lstm_{symbol}_{interval}.keras"))

    return {"val_accuracy": val_acc, "epochs_trained": len(history.history["loss"])}


def predict_lstm(
    X_recent: np.ndarray,   # shape: (LOOKBACK, n_features) — already the window
    output_dir: str,
    symbol: str,
    interval: str,
) -> dict:
    """
    X_recent: the last LOOKBACK rows of scaled feature matrix.
    Returns {signal, confidence, raw_probabilities}
    """
    from tensorflow import keras
    import joblib

    out = Path(output_dir)
    model_path = out / f"lstm_{symbol}_{interval}.keras"
    scaler_path = out / f"lstm_scaler_{symbol}_{interval}.joblib"

    if not model_path.exists():
        raise FileNotFoundError(f"LSTM model not trained for {symbol} {interval}")

    scaler = joblib.load(scaler_path)
    model  = keras.models.load_model(str(model_path))

    X_scaled = scaler.transform(X_recent)
    X_input  = X_scaled[np.newaxis, :, :]   # (1, LOOKBACK, n_features)
    proba    = model.predict(X_input, verbose=0)[0]

    classes  = ["BUY", "HOLD", "SELL"]
    idx      = int(np.argmax(proba))
    return {
        "signal":            classes[idx],
        "confidence":        float(proba[idx]),
        "raw_probabilities": {c: float(p) for c, p in zip(classes, proba)},
        "model_type":        "lstm",
    }
```

### Update `backend/algo/model/trainer.py`

After training XGBoost, also train the LSTM if TensorFlow is available. Add at the end of `train_signal_model()`:

```python
# Attempt LSTM training (optional — skip gracefully if TF not installed)
lstm_report = None
try:
    from backend.algo.model.lstm_model import train_lstm
    from sklearn.preprocessing import LabelEncoder
    X_arr = df[feature_cols].fillna(0).values
    lstm_report = train_lstm(X_arr, y, str(out_path), symbol, interval)
    report["lstm"] = lstm_report
except Exception as lstm_err:
    report["lstm"] = {"status": "skipped", "reason": str(lstm_err)}
```

### Update `backend/algo/model/predictor.py`

Make `predict()` return an ensemble result:

```python
def predict(feature_vector: dict, candle_window: list[dict] | None = None,
            model_dir: str = "backend/models/algo") -> dict:
    """
    Runs XGBoost always. Runs LSTM if model exists and candle_window provided.
    Returns ensemble signal: weighted vote XGB(60%) + LSTM(40%) if both available,
    else XGB only.
    """
    # ... existing XGBoost inference ...

    # LSTM inference
    lstm_out = None
    if candle_window and len(candle_window) >= 60:
        try:
            from backend.algo.model.lstm_model import predict_lstm, LOOKBACK
            import numpy as np
            from backend.algo.features.pipeline import compute_features
            from backend.algo.features.schema import ALL_FEATURE_NAMES
            feat_df = compute_features(candle_window, feature_vector.get("symbol",""))
            feat_cols = [c for c in ALL_FEATURE_NAMES if c in feat_df.columns]
            X_window = feat_df[feat_cols].fillna(0).values[-LOOKBACK:]
            if len(X_window) == LOOKBACK:
                lstm_out = predict_lstm(X_window, model_dir,
                                        feature_vector.get("symbol",""),
                                        feature_vector.get("interval","5m"))
        except Exception:
            lstm_out = None

    # Ensemble vote
    if lstm_out:
        signal, confidence = _ensemble_vote(xgb_out, lstm_out, xgb_weight=0.6, lstm_weight=0.4)
    else:
        signal    = xgb_out["signal"]
        confidence = xgb_out["confidence"]

    return {
        "signal":            signal,
        "confidence":        confidence,
        "xgb":               xgb_out,
        "lstm":              lstm_out,
        "ensemble":          lstm_out is not None,
        "pipeline_version":  feature_vector.get("pipeline_version", ""),
        "model_version":     "ensemble_v1" if lstm_out else "xgboost_v1",
    }


def _ensemble_vote(xgb: dict, lstm: dict, xgb_weight: float, lstm_weight: float) -> tuple[str, float]:
    classes = ["BUY", "HOLD", "SELL"]
    xgb_p  = xgb["raw_probabilities"]
    lstm_p = lstm["raw_probabilities"]
    blended = {c: xgb_p.get(c, 0) * xgb_weight + lstm_p.get(c, 0) * lstm_weight for c in classes}
    best = max(blended, key=blended.get)
    return best, round(blended[best], 4)
```

### Add TensorFlow to requirements

In `requirements.txt`, add:
```
tensorflow>=2.15.0
```

---

## Feature 2 — TradingView-like Interface

### Install lightweight-charts

In `trading-ui/`, run:
```bash
npm install lightweight-charts
```

This is TradingView's official open-source charting library (MIT licence). It renders pixel-perfect candlestick charts identical to TradingView's interface.

### `trading-ui/src/components/algo/ProChart.jsx`

Build a full professional chart component:

```jsx
/**
 * ProChart — TradingView-style candlestick chart using lightweight-charts.
 * Props:
 *   symbol      {string}   e.g. "EURUSD=X"
 *   interval    {string}   e.g. "5m"
 *   candles     {array}    [{time, open, high, low, close, volume}]
 *   signals     {array}    [{time, signal, confidence}]  — overlaid as markers
 *   indicators  {object}   {ema9: bool, ema21: bool, bollinger: bool, macd: bool}
 */
import { useEffect, useRef } from "react";
import { createChart, CrosshairMode, LineStyle } from "lightweight-charts";

export default function ProChart({ symbol, interval, candles = [], signals = [], indicators = {} }) {
  const containerRef = useRef(null);
  const chartRef     = useRef(null);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;

    // Destroy existing chart on re-render
    if (chartRef.current) { chartRef.current.remove(); }

    const chart = createChart(containerRef.current, {
      layout: {
        background:   { color: "#0d1117" },
        textColor:    "#c9d1d9",
        fontSize:     12,
        fontFamily:   "Inter, sans-serif",
      },
      grid: {
        vertLines:   { color: "#21262d", style: LineStyle.Dotted },
        horzLines:   { color: "#21262d", style: LineStyle.Dotted },
      },
      crosshair:  { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#30363d" },
      timeScale: {
        borderColor:        "#30363d",
        timeVisible:        true,
        secondsVisible:     false,
        rightOffset:        5,
        barSpacing:         6,
        fixLeftEdge:        false,
        lockVisibleTimeRangeOnResize: true,
      },
      width:  containerRef.current.clientWidth,
      height: 520,
    });
    chartRef.current = chart;

    // Candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor:        "#26a641",
      downColor:      "#da3633",
      borderUpColor:  "#26a641",
      borderDownColor:"#da3633",
      wickUpColor:    "#26a641",
      wickDownColor:  "#da3633",
    });

    const chartData = candles.map(c => ({
      time:  Math.floor(c.time / 1000),
      open:  c.open,
      high:  c.high,
      low:   c.low,
      close: c.close,
    }));
    candleSeries.setData(chartData);

    // Signal markers — BUY=green arrow up, SELL=red arrow down
    if (signals.length > 0) {
      const markers = signals
        .filter(s => s.signal !== "HOLD")
        .map(s => ({
          time:     Math.floor(s.time / 1000),
          position: s.signal === "BUY" ? "belowBar" : "aboveBar",
          color:    s.signal === "BUY" ? "#26a641"  : "#da3633",
          shape:    s.signal === "BUY" ? "arrowUp"  : "arrowDown",
          text:     `${s.signal} ${(s.confidence * 100).toFixed(0)}%`,
          size:     1,
        }));
      candleSeries.setMarkers(markers);
    }

    // EMA overlays
    if (indicators.ema9 && candles.length > 9) {
      const ema9Series = chart.addLineSeries({ color: "#f0883e", lineWidth: 1, title: "EMA 9" });
      ema9Series.setData(_calcEMA(candles, 9));
    }
    if (indicators.ema21 && candles.length > 21) {
      const ema21Series = chart.addLineSeries({ color: "#58a6ff", lineWidth: 1, title: "EMA 21" });
      ema21Series.setData(_calcEMA(candles, 21));
    }

    // Volume histogram (bottom of chart — separate pane)
    const volSeries = chart.addHistogramSeries({
      color:      "#30363d",
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      scaleMargins: { top: 0.85, bottom: 0 },
    });
    volSeries.setData(candles.map(c => ({
      time:  Math.floor(c.time / 1000),
      value: c.volume,
      color: c.close >= c.open ? "#1a3a2a" : "#3a1a1a",
    })));

    chart.timeScale().fitContent();

    // Responsive resize
    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: containerRef.current?.clientWidth || 800 });
    });
    ro.observe(containerRef.current);

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [candles, signals, indicators]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "520px", borderRadius: "8px", overflow: "hidden" }}
    />
  );
}

// Pure EMA calculation for overlay
function _calcEMA(candles, period) {
  const k = 2 / (period + 1);
  let ema  = candles[0].close;
  return candles.map((c, i) => {
    if (i === 0) { ema = c.close; }
    else         { ema = c.close * k + ema * (1 - k); }
    return { time: Math.floor(c.time / 1000), value: parseFloat(ema.toFixed(6)) };
  });
}
```

### Update `trading-ui/src/pages/AlgoTrading.jsx`

Replace the existing chart placeholder with `ProChart`. The page layout must look like TradingView:

**Top bar (full width):**
- Left: Bullcast logo + symbol search dropdown (filter by category: Major/Minor/Exotic)
- Center: Timeframe tabs — `1m  5m  15m  1h  4h  1D`
- Right: Indicator toggle buttons (EMA9, EMA21, BB, MACD), Live/Replay toggle, ModelHealthBadge

**Main area (two columns):**
- Left (75%): ProChart (full height), below it a MACD sub-panel (if enabled) using a second lightweight-charts instance
- Right (25%): SignalFeed (scrolling signal cards, latest on top)

**Bottom bar (full width):**
- 5 KPI chips: Current Signal | Confidence | Regime | Kelly Size | Today P&L
- RecentAlgoTrades table (last 10, collapsible)

**Symbol selector behavior:**
- Dropdown groups symbols by category (Major / Minor / Exotic)
- When a symbol is selected, fetch candles via `GET /api/market-data/ohlcv?symbol=EURUSD=X&interval=5m&period=30d`
- Re-render ProChart with new data
- Poll for new signals every 60 seconds via `GET /api/algo/signal/EURUSD=X?interval=5m`

**Timeframe tab behavior:**
- Clicking a tab changes the `interval` param in all API calls
- Re-fetches candles and redraws chart

**Colour scheme (match TradingView Dark):**
```
background:    #0d1117
surface:       #161b22
border:        #30363d
text-primary:  #c9d1d9
text-muted:    #8b949e
green:         #26a641
red:           #da3633
blue:          #58a6ff
orange:        #f0883e
```
Apply these as CSS variables in `trading-ui/src/global.css`. Replace all hardcoded color values in algo components with these variables.

### `trading-ui/src/components/algo/TimeframeSelector.jsx`

```jsx
const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1D"];

export default function TimeframeSelector({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: "2px", background: "var(--surface)", borderRadius: "6px", padding: "3px" }}>
      {TIMEFRAMES.map(tf => (
        <button
          key={tf}
          onClick={() => onChange(tf)}
          style={{
            padding: "4px 10px",
            borderRadius: "4px",
            border: "none",
            cursor: "pointer",
            fontSize: "12px",
            fontWeight: "600",
            background: value === tf ? "var(--blue)"     : "transparent",
            color:      value === tf ? "#fff"            : "var(--text-muted)",
            transition: "all 0.15s",
          }}
        >{tf}</button>
      ))}
    </div>
  );
}
```

### `trading-ui/src/components/algo/SymbolSelector.jsx`

Dropdown grouped by category. Searching filters by symbol name. Show category badge next to each symbol. On select, call `onSelect(symbol)`.

---

## Fix 4 — Add OHLCV API Endpoint for Chart

In `backend/server.py` (or create `backend/market_data/router.py`), add:

```python
@app.get("/api/market-data/ohlcv")
def get_ohlcv(symbol: str, interval: str = "5m", period: str = "30d"):
    candles = fetch_ohlcv(symbol, period=period, interval=interval)
    return {"symbol": symbol, "interval": interval, "candles": candles, "count": len(candles)}
```

Also update `/api/algo/signal/{symbol}` to accept `?interval=5m` query param and pass it through to `train_signal_model` / `predict`.

---

## Fix 5 — Update batch_train.py to Accept Interval Arg

In `backend/algo/batch_train.py`, read interval from CLI if provided:
```python
import sys
INTERVAL = sys.argv[1] if len(sys.argv) > 1 else "5m"
PERIOD   = sys.argv[2] if len(sys.argv) > 2 else "60d"
```
So user can run: `python batch_train.py 1h 2y`

---

## Execution Order

1. Fix 1 — column normalization in `fetcher.py` and `pipeline.py`
2. Fix 2 — replace `symbols.py` with forex-only list
3. Fix 3 — update `batch_train.py`
4. Run `python batch_train.py` — confirm ✓ symbols appear
5. Feature 1 — add `lstm_model.py`, update `trainer.py` and `predictor.py`
6. Fix 4 — OHLCV endpoint
7. Feature 2 — `ProChart.jsx`, update `AlgoTrading.jsx`, `TimeframeSelector.jsx`, `SymbolSelector.jsx`
8. Run `python -m pytest tests -q` — all must pass

---

## Do Not

- Do not remove existing XGBoost model — LSTM is additive, not a replacement
- Do not install any React charting library other than `lightweight-charts`
- Do not change journal, backtester, news, or auth code
- Do not hardcode interval in the feature pipeline — always detect dynamically
- Do not generate mock data — if model not trained, return HTTP 503 with `{"error": "model_not_trained", "symbol": symbol}`
