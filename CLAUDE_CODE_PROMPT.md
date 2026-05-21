# Claude Code Build Prompt — Bullcast Algorithmic Trading Engine

## Context

You are building an algorithmic trading engine on top of an existing FastAPI + React project called Bullcast. Read this prompt fully before writing a single line of code.

**Project root:** `D:/Bullcast/` (Windows) / `/sessions/.../mnt/Bullcast/` (bash)  
**Backend:** FastAPI, Python 3.11+, `backend/` package  
**Frontend:** React + Vite, `trading-ui/src/`  
**Database:** Supabase (journal persistence)  
**Data source:** yfinance via `backend/market_data/fetcher.py`

---

## Critical: What Already Exists — Do Not Rebuild

Before touching any file, understand these exist and are production-quality:

**`backend/datasets/pattern_alert_journal.py`**
The user's complete trading strategy is already implemented here. Functions you will import and reuse:
- `detect_streaks(candles, config)` — finds 4+ consecutive same-color candle runs
- `evaluate_streak_setup(candles, streak, config)` — validates pullback + breaking candle + confirmation, returns `Setup` dataclass
- `detect_streak_pullback_setups(candles, config)` — convenience wrapper
- `candle_color(candle, threshold)` — returns "bullish", "bearish", or "doji"
- `Candle`, `Streak`, `Setup`, `SimulatedTrade`, `StrategyConfig` dataclasses
- `simulate_trade(candles, setup, config)` — simulates trade exit against historical data

**`backend/backtesting/engine.py`** — `run_backtest()` with slippage, commission, equity curve  
**`backend/backtesting/metrics.py`** — `calculate_metrics()` with Sharpe, Sortino, Calmar, drawdown  
**`backend/backtesting/signals.py`** — `calculate_rsi()`, `calculate_sma()`, `calculate_macd()`, `calculate_bollinger_bands()`  
**`backend/market_data/fetcher.py`** — `fetch_ohlcv(symbol, period, interval)` using yfinance  
**`backend/ml/leakage_guard.py`** — `validate_no_forbidden_inputs()`, `validate_quality_gate()`  
**`backend/ml/feature_schema.py`** — feature schema and quality gate patterns  
**`backend/server.py`** — FastAPI app with CORS, existing routes, imports `sentiment_api`  
**`backend/journal/`** — all journal CRUD and Supabase persistence

---

## Phase 0 — Rename Sentiment to News (Do This First)

1. Rename `backend/sentiment_api.py` → `backend/news_api.py`
2. Inside `news_api.py`: rename variable `router` tag prefix from `sentiment` to `news`. Change all route paths from `/api/sentiment/...` → `/api/news/...`. Change class `SentimentRequest` → `NewsRequest`. Change `stock_sentiment_cache` → `stock_news_cache`. Change `analyzer` references internally — no logic changes.
3. In `backend/server.py`: change `from backend.sentiment_api import router as sentiment_router` → `from backend.news_api import router as news_router`. Change `app.include_router(sentiment_router)` → `app.include_router(news_router)`.
4. In `trading-ui/src/pages/Sentiment.jsx`: rename file to `News.jsx`. Update component function name from `Sentiment` to `News`. Change page title to "News". Update all internal string references from "Sentiment" to "News".
5. In `trading-ui/src/components/SentimentCard.jsx`: rename file to `NewsCard.jsx`. Update component name.
6. In `trading-ui/src/components/Sidebar.jsx` (or wherever nav items are defined): update the import from `Sentiment` to `News`. Move News to the **last** position in the nav array. Add an "Algo Trading" placeholder entry as the **first** nav item (route: `/algo`, label: "Algo Trading", icon: TrendingUp or similar from lucide-react).
7. In `trading-ui/src/App.jsx` (or router file): add route `/algo` pointing to `AlgoTrading` (stub component for now). Update Sentiment route to `/news`.
8. Run `python -m pytest tests -q` to confirm no regressions.

---

## Phase 1 — Candle Feature Pipeline

Create `backend/algo/` package. Create `__init__.py` in every subdirectory.

### `backend/algo/features/price_action.py`
Functions take a `pd.DataFrame` with columns `[open, high, low, close, volume]` sorted ascending. All output columns are `shift(1)` applied **after** computation — no lookahead.

```python
def add_price_action_features(df: pd.DataFrame) -> pd.DataFrame:
    # return_1: (close - close.shift(1)) / close.shift(1), then .shift(1)
    # return_5: (close - close.shift(5)) / close.shift(5), then .shift(1)
    # log_return_1: np.log(close / close.shift(1)), then .shift(1)
    # hl_spread: (high - low) / close, then .shift(1)
    # body_ratio: abs(close - open) / (high - low + 1e-9), then .shift(1)
    # upper_wick_ratio: (high - close.clip(lower=open)) / (high - low + 1e-9), then .shift(1)
    # lower_wick_ratio: (open.clip(upper=close) - low) / (high - low + 1e-9), then .shift(1)
    # close_position: (close - low) / (high - low + 1e-9), then .shift(1)
```

### `backend/algo/features/moving_averages.py`
```python
def add_moving_average_features(df: pd.DataFrame) -> pd.DataFrame:
    # ema9, ema21, ema50, ema200: ewm(span=N, adjust=False).mean().shift(1)
    # sma20, sma50: rolling(N).mean().shift(1)
    # price_vs_ema9: (close - ema9) / ema9 — compute ratio AFTER shift
    # price_vs_ema21, price_vs_ema50, price_vs_ema200: same pattern
    # ema9_vs_ema21: (ema9 - ema21) / (ema21 + 1e-9)
    # ema21_vs_ema50, ema50_vs_ema200: same pattern
```

### `backend/algo/features/momentum.py`
```python
def add_momentum_features(df: pd.DataFrame) -> pd.DataFrame:
    # Import calculate_rsi from backend.backtesting.signals — do not reimplement
    # rsi_7, rsi_14, rsi_21: calculate_rsi(df["close"], window).shift(1)
    # stoch_k: (close - lowest_low_14) / (highest_high_14 - lowest_low_14 + 1e-9) * 100, shift(1)
    # stoch_d: stoch_k.rolling(3).mean(), shift(1)
    # roc_5, roc_10, roc_20: (close - close.shift(N)) / close.shift(N) * 100, shift(1)
    # williams_r: (highest_high_14 - close) / (highest_high_14 - lowest_low_14 + 1e-9) * -100, shift(1)
    # cci_20: (close - sma_20) / (0.015 * mean_abs_deviation_20 + 1e-9), shift(1)
    # mfi_14: Money Flow Index using typical price and volume, shift(1)
```

### `backend/algo/features/volatility.py`
```python
def add_volatility_features(df: pd.DataFrame) -> pd.DataFrame:
    # Import calculate_bollinger_bands from backend.backtesting.signals
    # atr_7, atr_14: Wilder ATR (true range smoothed), shift(1)
    # atr_pct: atr_14 / (close + 1e-9), shift(1)
    # bb_upper, bb_middle, bb_lower from calculate_bollinger_bands(close, 20, 2)
    # bb_width: (bb_upper - bb_lower) / (bb_middle + 1e-9), shift(1)
    # bb_position: (close - bb_lower) / (bb_upper - bb_lower + 1e-9), shift(1)
    # hist_vol_10, hist_vol_20: close.pct_change().rolling(N).std() * sqrt(252*390), shift(1)
```

### `backend/algo/features/volume.py`
```python
def add_volume_features(df: pd.DataFrame) -> pd.DataFrame:
    # obv: cumulative OBV, then obv_slope = obv.diff(5), shift(1)
    # vwap: cumsum(typical_price * volume) / cumsum(volume), reset by date
    # vwap_deviation: (close - vwap) / (vwap + 1e-9), shift(1)
    # volume_zscore: (volume - volume.rolling(20).mean()) / (volume.rolling(20).std() + 1e-9), shift(1)
    # volume_ratio: volume / (volume.rolling(20).mean() + 1e-9), shift(1)
    # cmf_20: Chaikin Money Flow 20, shift(1)
```

### `backend/algo/features/multi_timeframe.py`
```python
def add_multitf_features(df_1m: pd.DataFrame, symbol: str) -> pd.DataFrame:
    # Resample df_1m to 5m, 15m, 1h using:
    #   open=first, high=max, low=min, close=last, volume=sum
    # On each resampled frame compute: ema9, ema21, rsi_14
    # trend = 1 if ema9 > ema21 * 1.001, -1 if ema9 < ema21 * 0.999, else 0
    # Merge back to 1m index using ffill()
    # Apply shift(1) at the 1m level AFTER merge
    # Columns: tf5m_trend, tf5m_rsi14, tf5m_ema9_vs_ema21
    #          tf15m_trend, tf15m_rsi14, tf15m_ema9_vs_ema21
    #          tf1h_trend, tf1h_rsi14, tf1h_ema9_vs_ema21
```

### `backend/algo/features/streak_features.py`
**This is the bridge between the existing strategy engine and the ML pipeline.**
```python
# Import from backend.datasets.pattern_alert_journal:
#   Candle, StrategyConfig, candle_color, detect_streaks

def add_streak_features(df: pd.DataFrame) -> pd.DataFrame:
    # Convert df rows to list[Candle] for pattern_alert_journal functions
    # For each row i, look back at rows max(0, i-20):i (no lookahead)
    # Compute:
    #   streak_active: 1 if currently in a streak of >= 4 same-color candles
    #   streak_direction: 1 bullish, -1 bearish, 0 none
    #   streak_length: current streak run length (0 if not in streak)
    #   candles_since_streak: candles elapsed since last streak ended
    #   pullback_active: 1 if 1 or 2 opposite candles have appeared after a streak
    #   pullback_count: number of pullback candles so far (0, 1, or 2)
    #   midpoint_touched: 1 if pullback has touched 50% of last streak candle
    #   structural_target_dist: (close - structural_target) / close if setup forming
    #   setup_forming: 1 if streak + valid pullback detected, pre-confirmation
    # All values shift(1) before assignment
```

### `backend/algo/features/schema.py`
```python
import hashlib, json

FEATURE_GROUPS = {
    "price_action": [...],   # list all column names
    "moving_averages": [...],
    "momentum": [...],
    "volatility": [...],
    "volume": [...],
    "multi_timeframe": [...],
    "streak": [...],
}
ALL_FEATURE_NAMES = [name for group in FEATURE_GROUPS.values() for name in group]
PIPELINE_CONFIG = {"version": "1.0.0", "min_history_candles": 210}

def get_pipeline_version() -> str:
    payload = json.dumps({"features": sorted(ALL_FEATURE_NAMES), "config": PIPELINE_CONFIG}, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]
```

### `backend/algo/features/pipeline.py`
```python
def compute_features(candles: list[dict], symbol: str) -> pd.DataFrame:
    # 1. Convert to DataFrame, sort ascending by time
    # 2. Call add_price_action_features, add_moving_average_features,
    #    add_momentum_features, add_volatility_features, add_volume_features
    # 3. Call add_multitf_features(df, symbol)
    # 4. Call add_streak_features(df)
    # 5. Drop rows with all-NaN features (first ~200 rows of history warmup)
    # 6. Add column pipeline_version = get_pipeline_version()
    # 7. Return df with only columns in ALL_FEATURE_NAMES + [time, symbol, pipeline_version]

def compute_single_feature_vector(candles: list[dict], symbol: str) -> dict:
    # Calls compute_features, returns last row as dict
    # Raises ValueError if fewer than PIPELINE_CONFIG["min_history_candles"] provided
```

### `tests/test_features_lookahead.py`
**This is mandatory.** For each feature group function, test that truncating the dataframe at index k produces the identical feature value at index k as the full dataframe. Use a real 500-row candle fixture. Any lookahead failure must raise an AssertionError with the offending column name.

---

## Phase 2 — Signal Model (XGBoost)

### `backend/algo/model/labeler.py`
```python
def label_candles(df: pd.DataFrame, forward_window: int = 10, min_rr: float = 1.5, cost_bps: float = 5.0) -> pd.DataFrame:
    # Forward-looking label for training only — never used at inference
    # future_return = (close.shift(-forward_window) - close) / close
    # BUY if future_return > cost_bps/10000 * min_rr
    # SELL if future_return < -cost_bps/10000 * min_rr
    # HOLD otherwise
    # Label goes in column "signal_label"
    # Drop last forward_window rows (no label available)
```

### `backend/algo/model/walk_forward.py`
```python
def walk_forward_cv(
    feature_df: pd.DataFrame,
    label_col: str = "signal_label",
    train_months: int = 6,
    val_months: int = 1,
    min_folds: int = 4,
) -> list[dict]:
    # Returns list of fold results: {fold, train_size, val_size, accuracy, precision, recall, roc_auc, avg_confidence}
    # Model passes quality gates: mean accuracy > 0.52, std accuracy < 0.08, no fold < 0.45
```

### `backend/algo/model/trainer.py`
```python
def train_signal_model(
    symbol: str,
    period: str = "2y",
    interval: str = "1m",
    output_dir: str = "backend/models/algo",
) -> dict:
    # 1. fetch_ohlcv(symbol, period, interval) from backend.market_data.fetcher
    # 2. compute_features(candles, symbol)
    # 3. label_candles(df)
    # 4. walk_forward_cv — fail if quality gates not met
    # 5. Train final XGBoost on full dataset
    # 6. Save model + schema + report + SHAP explainer (TreeExplainer)
    # 7. Save baseline confidence distribution for drift detection
    # 8. Return training report dict
```

### `backend/algo/model/predictor.py`
```python
def predict(feature_vector: dict, model_dir: str = "backend/models/algo") -> dict:
    # Load model from disk (cache in module-level variable after first load)
    # Run XGBoost predict_proba
    # Return {signal, confidence, raw_probabilities, pipeline_version, model_version}
```

### `backend/algo/advanced/fingerprint.py`
```python
def compute_fingerprint(model_version: str, pipeline_version: str, rules_hash: str) -> str:
    # SHA-256 of sorted JSON of all three components, return first 16 chars
```

---

## Phase 3 — Strategy Validator

**The strategy is already implemented.** Do not rewrite it.

### `backend/algo/validator/engine.py`
```python
# Import from backend.datasets.pattern_alert_journal:
#   Candle, StrategyConfig, evaluate_streak_setup, detect_streaks
#   Setup dataclass

@dataclass
class Rule:
    name: str
    description: str
    check: Callable[[dict, dict], bool]   # (signal_output, feature_vector) -> bool
    required_for: list[str]               # ["BUY"], ["SELL"], or ["BUY", "SELL"]

def validate(signal_output: dict, feature_vector: dict, candles: list[dict]) -> dict:
    # Returns ValidatedSignal:
    # {signal_output, passed: bool, rejection_reason: str|None, rules_checked: list[dict]}
    # Runs all rules matching signal direction
    # First failing required rule sets passed=False and records reason
    # All rule outcomes always recorded in rules_checked
```

### `backend/algo/validator/rules.py`
```python
# Rule 1 — Minimum confidence
MinConfidenceRule = Rule(
    name="min_confidence",
    description="Reject if model confidence below 0.58",
    check=lambda sig, feat: sig["confidence"] >= 0.58,
    required_for=["BUY", "SELL"],
)

# Rule 2 — Streak pattern active
# Uses feature_vector["setup_forming"] == 1 OR candles are passed through
# evaluate_streak_setup from pattern_alert_journal to confirm a valid Setup exists
StreakPatternRule = Rule(
    name="streak_pattern",
    description="Signal must occur within a valid Streak Pullback Confirmation setup",
    check=_check_streak_pattern,   # see below
    required_for=["BUY", "SELL"],
)

# Rule 3 — Hourly trend alignment
# BUY rejected if tf1h_trend == -1, SELL rejected if tf1h_trend == 1
TrendAlignmentRule = Rule(...)

# Rule 4 — Not in volatile regime
# Reject if feature_vector["regime"] == 2 and signal confidence < 0.72
VolatileRegimeRule = Rule(...)

def _check_streak_pattern(signal_output: dict, feature_vector: dict) -> bool:
    # Returns True only if feature_vector["setup_forming"] == 1
    # AND streak_direction matches signal direction
    # (1 for bullish/BUY, -1 for bearish/SELL)
    ...

RULES: list[Rule] = [MinConfidenceRule, StreakPatternRule, TrendAlignmentRule, VolatileRegimeRule]
```

---

## Phase 4 — Paper Trader, Circuit Breaker, DevReplay

### `backend/algo/paper_trader/position_sizer.py`
```python
def recommend_quantity(
    signal_confidence: float,
    current_capital: float,
    entry_price: float,
    stop_loss_price: float,
    rolling_win_rate: float,     # from last 50 paper trades, default 0.5 cold start
    rolling_avg_rr: float,       # from last 50 paper trades, default 1.5 cold start
    cold_start: bool = False,    # True if fewer than 20 trades in history
    max_kelly_fraction: float = 0.20,
) -> dict:
    # Kelly: f* = (p*b - q) / b, multiply by signal_confidence
    # If cold_start: use 0.01 (1% fixed)
    # Cap at max_kelly_fraction
    # Never below 0.0025 of capital
    # Returns {fraction, quantity, risk_amount_inr, stop_distance}
```

### `backend/algo/paper_trader/circuit_breaker.py`
```python
STATE_PATH = "backend/models/algo/circuit_breaker_state.json"

class CircuitBreaker:
    def check(self, current_capital: float, initial_capital: float, trades_today: list) -> tuple[bool, str]:
        # Returns (trading_allowed: bool, reason: str)
        # Halt if: daily drawdown > 3%, weekly drawdown > 7%,
        #          5 consecutive losses, model health stale

    def reset_daily(self): ...
    def reset_manual(self): ...  # for API endpoint
```

### `backend/algo/paper_trader/trader.py`
```python
def place_paper_trade(
    validated_signal: dict,
    current_price: float,
    current_capital: float,
    algo_trade_history: list[dict],
    supabase_client,
    user_id: str | None,
) -> dict | None:
    # Returns None if validated_signal["passed"] is False
    # Calls recommend_quantity, constructs AlgoPaperTrade
    # Writes to Supabase journal table with source="algo" and all extra algo fields
    # Returns the created trade record
```

### `backend/algo/replay/dev_replay.py`
```python
def run_replay(config: dict) -> dict:
    # config keys: symbol, start_date, end_date, interval, speed_multiplier,
    #              initial_capital, use_kelly_sizing, save_to_journal
    # 1. fetch_ohlcv for date range
    # 2. Iterate candles in order, maintain rolling window
    # 3. For each candle: compute_single_feature_vector → predict → validate → place_paper_trade
    # 4. Same production functions — no special replay path
    # 5. Collect results, run calculate_metrics at end
    # Returns {trades, metrics, equity_curve, config_used}
    # speed_multiplier only applies if > 0 and < inf (add time.sleep(60/speed))
```

---

## Phase 5 — Advanced Features

### `backend/algo/advanced/regime.py`
```python
# Library: hmmlearn (pip install hmmlearn)
# 3-state Gaussian HMM on features: [daily_vol, adx_14, return_autocorr_5]
# States map to: 0=Ranging, 1=Trending, 2=Volatile

class RegimeDetector:
    def fit(self, daily_candles: list[dict], symbol: str) -> None:
        # Train HMM, save to backend/models/algo/regime_{symbol}.joblib

    def predict(self, recent_daily_candles: list[dict]) -> dict:
        # Returns {regime: str, regime_id: int, confidence: float}
        # regime str: "Ranging", "Trending", "Volatile"
```

### `backend/algo/advanced/explainer.py`
```python
# Library: shap (pip install shap)
# Uses pre-fitted TreeExplainer loaded from backend/models/algo/xgboost_v1_shap.joblib

def explain_signal(feature_vector: dict, model_dir: str = "backend/models/algo") -> dict:
    # Returns:
    # {top_features: [{feature, contribution, value}x5], counterfactual: str}
    # Counterfactual: sweep top feature value in small steps until prediction class changes

def generate_counterfactual(feature_vector: dict, top_feature: str, current_class: str, explainer) -> str:
    # Returns human-readable string: "To flip to HOLD, {feature} would need to be {threshold} (currently {value})"
```

### `backend/algo/advanced/drift_detector.py`
```python
# Population Stability Index (PSI) for feature drift
# No external library needed — implement PSI from scratch (10 equal-frequency buckets)

def compute_psi(expected: list[float], actual: list[float], buckets: int = 10) -> float:
    # PSI = sum((actual_pct - expected_pct) * ln(actual_pct / expected_pct))

class DriftDetector:
    def __init__(self, baseline_path: str = "backend/models/algo/feature_baseline_distributions.json"): ...

    def check_feature_drift(self, recent_feature_vectors: list[dict]) -> dict:
        # Returns {status, psi_by_feature, drifted_features, overall_psi}

    def check_confidence_drift(self, recent_confidences: list[float]) -> dict:
        # Compare rolling mean to baseline_avg_confidence.json

    def get_model_health(self, recent_paper_trades: list[dict]) -> dict:
        # Aggregate feature_drift + confidence_drift + outcome_drift
        # Returns ModelHealthReport with status: "healthy"|"degraded"|"stale"
```

### `backend/algo/advanced/retrainer.py`
```python
def should_retrain(health_report: dict) -> bool:
    return health_report["status"] == "stale"

def run_retrain(symbol: str, output_dir: str = "backend/models/algo") -> dict:
    # 1. Run train_signal_model(symbol)
    # 2. If quality gates pass, run dev_replay on last 30 days
    # 3. If replay metrics within 10% of walk-forward metrics, promote
    # 4. Save retraining log entry
    # Returns {promoted: bool, reason: str, metrics: dict}
```

---

## Phase 6 — FastAPI Router

### `backend/algo/router.py`
Register all new endpoints under prefix `/api/algo`:

```
GET  /api/algo/signal/{symbol}        → latest signal (full inference pipeline)
POST /api/algo/signal/batch           → body: {symbols: list[str]}
GET  /api/algo/trades                 → query params: symbol, date_from, date_to
POST /api/algo/trade/place            → body: validated_signal dict
POST /api/algo/replay/start           → body: ReplayConfig
GET  /api/algo/replay/{id}/status
GET  /api/algo/replay/{id}/result
GET  /api/algo/model-health           → ModelHealthReport
GET  /api/algo/regime/{symbol}
POST /api/algo/retrain                → trigger manual retrain (async background task)
GET  /api/algo/retrain/{job_id}/status
GET  /api/algo/pipeline-versions
POST /api/algo/circuit-breaker/reset
```

In `backend/server.py`, add:
```python
from backend.algo.router import router as algo_router
app.include_router(algo_router)
```

All `/api/algo/signal/{symbol}` calls run the full pipeline:
1. `fetch_ohlcv(symbol, period="7d", interval="1m")`
2. `compute_single_feature_vector(candles, symbol)`
3. `predict(feature_vector)`
4. `regime_detector.predict(daily_candles)`  — attach regime to output
5. `explain_signal(feature_vector)` — attach explanation
6. `validate(signal_output, feature_vector, candles)`
7. Return `ValidatedSignal` with all fields

---

## Phase 7 — React Frontend

### `trading-ui/src/pages/AlgoTrading.jsx`
Full dashboard page. Layout:

```jsx
<AlgoTrading>
  <header>  // symbol search (reuse existing SearchBar), model health badge, live/replay toggle
  <StatusRow>  // 4 KPI cards: Regime | Model Health | Today P&L | Kelly Fraction
  <SignalFeed />      // scrolling live signal cards
  <ReplayControls />  // collapsible panel, hidden by default
  <RecentAlgoTrades /> // last 10 paper trades table from /api/algo/trades
</AlgoTrading>
```

Use only Tailwind utility classes and lucide-react icons. No new npm packages.

### `trading-ui/src/components/algo/SignalFeed.jsx`
Polls `GET /api/algo/signal/{symbol}` every 60 seconds. Shows cards per signal:
- Direction badge (BUY=green, SELL=red, HOLD=gray)
- Confidence bar (use existing `ScoreGauge.jsx` or simple div width %)
- Top 2 features from explanation
- Regime chip
- "Explain" button → opens TradeExplainer modal

### `trading-ui/src/components/algo/ModelHealthBadge.jsx`
Fetches `GET /api/algo/model-health`. Displays colored dot + status text. Clicking opens a drawer showing full `DriftMonitor` component.

### `trading-ui/src/components/algo/RegimeIndicator.jsx`
Chip component: "Trending" (green), "Ranging" (blue), "Volatile" (orange). Shows confidence % in tooltip.

### `trading-ui/src/components/algo/KellyPositionWidget.jsx`
Card showing: Kelly fraction %, recommended INR size, rolling win rate, rolling avg R:R. Data from last field of `/api/algo/signal/{symbol}` response.

### `trading-ui/src/components/algo/TradeExplainer.jsx`
Modal. Shows SHAP feature bars (top 5, positive=blue/negative=red), counterfactual sentence, which validator rules passed/failed. Opens from SignalFeed "Explain" button and from journal trade rows with `source="algo"`.

### `trading-ui/src/components/algo/ReplayControls.jsx`
Form: symbol selector, start/end date pickers, speed radio (Instant/Fast/Real-time), initial capital input, save-to-journal checkbox. Start/Stop buttons. Progress bar using polling of `/api/algo/replay/{id}/status`. Results summary card after completion.

---

## Required New Libraries

Add to `requirements.txt`:
```
xgboost>=2.0.0
shap>=0.44.0
hmmlearn>=0.3.0
```

No new frontend npm packages. Use only what is already in `trading-ui/package.json`.

---

## Testing Requirements

After each phase, run `python -m pytest tests -q`. All existing tests must continue to pass.

New tests required (create in `tests/`):

| File | What It Tests |
|---|---|
| `test_features_lookahead.py` | No lookahead in any feature column (mandatory) |
| `test_features_pipeline.py` | Output shape, no NaN in last row, pipeline version stable |
| `test_strategy_validator.py` | Each rule passes/rejects correct synthetic signals |
| `test_kelly_sizer.py` | Known win rate + RR → expected fraction. Cold start → 1% |
| `test_circuit_breaker.py` | Each trigger halts trading. Daily reset works |
| `test_fingerprint.py` | Changing any component changes hash. Same inputs → same hash |
| `test_replay_e2e.py` | 100 synthetic candles → signals → paper trades → metrics computed |

---

## Execution Order

1. Phase 0 — rename/nav changes (no new logic)
2. Phase 1 — feature pipeline + lookahead test (must pass before proceeding)
3. Phase 2 — model training + predictor
4. Phase 3 — validator using existing strategy engine
5. Phase 4 — paper trader + circuit breaker + dev replay
6. Phase 5 — advanced features (regime, explainer, drift, retrainer)
7. Phase 6 — FastAPI router
8. Phase 7 — React frontend

**Do not start Phase N+1 until Phase N tests pass.**

---

## What NOT to Do

- Do not reimplement `detect_streaks`, `evaluate_streak_setup`, or any function in `backend/datasets/pattern_alert_journal.py` — import them.
- Do not reimplement RSI, SMA, MACD, Bollinger Bands — import from `backend/backtesting/signals.py`.
- Do not reimplement `calculate_metrics` — import from `backend/backtesting/metrics.py`.
- Do not create a separate "training features" vs "inference features" path — one `compute_features` function used everywhere.
- Do not use `localStorage` in any React component — use React state.
- Do not add npm packages beyond what is already in `package.json`.
- Do not modify any existing journal, auth, or backtesting logic.
- Do not generate mock/dummy data for API responses — return real errors if model not trained yet.
