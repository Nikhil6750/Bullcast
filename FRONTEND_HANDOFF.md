# Bullcast Frontend Handoff

This handoff is for a frontend AI or developer redesigning or polishing Bullcast without breaking backend logic, data contracts, or research-only safeguards.

## 1. Project Overview

Bullcast is a full-stack market research, backtesting, trading-journal, and trader-intelligence prototype. It helps a user import or create journal trades, generate simulated journal entries from OHLC market structure datasets, review backtest metrics, inspect dataset readiness, and ask Intelligence questions grounded in journal history.

Bullcast solves a workflow problem: trading review data is usually scattered across CSV files, manual notes, screenshots, and isolated backtest results. Bullcast brings those into one prototype pipeline:

1. OHLC candles and journal rows enter the system.
2. Simulated or real/paper trades are normalized into Bullcast journal format.
3. The backend builds behavior/profile context from those rows.
4. Intelligence answers questions using setup history, symbol history, confidence, repeated mistakes, and optional market context.

Important disclaimer: Bullcast is educational and research-only. It does not provide financial advice, buy/sell signals, live broker execution, real-money trading automation, or guaranteed predictions. Synthetic and simulated rows must always be labeled as simulated/dev data, not real trader performance.

## 2. Core Modules

### Journal

Primary frontend file: `trading-ui/src/pages/Journal.jsx`

The Journal page handles:

- Manual trade creation/editing.
- CSV/XLSX journal imports.
- Generated journal CSV imports.
- Local persistence through `bullcast_journal_v1`.
- Real-only JSON export.
- ML dataset JSON export through the backend dataset endpoint.

Journal imports must preserve setup metadata. Generated rows use the CSV field `setup`, which should normalize to canonical `setup_tag`. The Streak Pullback generated setup must remain `Streak Pullback Confirmation`.

### Intelligence

Primary frontend file: `trading-ui/src/pages/Intelligence.jsx`

The Intelligence page handles:

- Journal analysis.
- Ask Your Data / RAG-style Q&A.
- Dataset readiness preview.
- Training report visibility.
- Trader profile persistence.
- Analysis history persistence.
- Market/context panels.

Intelligence must prioritize trader-profile and journal-history reasoning over generic sentiment fallback when setup history exists.

### Backtesting

Important files:

- `trading-ui/src/components/SymbolBacktest.jsx`
- `trading-ui/src/components/backtest/BeginnerBacktest.jsx`
- `trading-ui/src/hooks/useBacktest.js`
- `trading-ui/src/components/PerformanceMetrics.jsx`
- `backend/backtesting/engine.py`
- `backend/backtesting/metrics.py`

The symbol backtest path calls `/api/backtest`. It returns metrics, equity curve data, trades, and execution/log details depending on backend strategy output.

Metrics expected by frontend and docs include:

- Total trades
- Win rate
- Net PnL
- Max drawdown
- Profit factor
- Average R:R

### Strategy Builder

Primary frontend file: `trading-ui/src/pages/StrategyBuilder.jsx`

Strategy Builder has two broad modes:

- Symbol Engine, which uses reusable symbol backtest controls.
- Legacy CSV Upload, which posts a CSV file and strategy config to `/run-strategy`.

Do not add the Streak Pullback Confirmation converter as a selectable frontend strategy. That converter is an offline dataset-generation pipeline, not an interactive UI strategy.

### Dataset / Training Pipeline

Important backend files:

- `backend/datasets/pattern_alert_journal.py`
- `backend/datasets/trade_dataset.py`
- `backend/datasets/compare_generated_journals.py`
- `backend/ml/train_baseline.py`
- `backend/models/baseline_training_report.json`

The UI does not train models. Training remains an explicit backend/offline workflow. Frontend can show dataset readiness and read existing reports, but must not imply a production model is available.

### Trader Profile Engine

Important backend files:

- `backend/intelligence/training.py`
- `backend/intelligence/coach.py`
- `backend/intelligence/prompts.py`
- `backend/intelligence/analyzer.py`
- `backend/journal/models.py`

The trader profile engine builds educational behavior context from normalized journal trades. It calculates performance metrics, repeated mistakes, setup/symbol history, confidence distribution, and behavior warnings.

## 3. Data Flow

### OHLC CSV Datasets

Input OHLC files use this format:

```csv
time,open,high,low,close,Pattern Alert,Volume
```

Current historical source files live in the repo under:

- `backend/data/forex/`
- `backend/data/crypto/`
- `backend/datasets/latest/`

The latest training dataset directory is:

```text
backend/datasets/latest/
```

### Streak Pullback Confirmation Converter

Converter:

```text
backend/datasets/pattern_alert_journal.py
```

It reads OHLC candles and generates simulated Bullcast journal rows using the Streak Pullback Confirmation strategy. The generated rows are simulation-only and must not be presented as real trading history.

Core behavior:

- Detects bullish/bearish candle streaks.
- Validates pullbacks.
- Confirms breaking and confirmation candles.
- Simulates entry, stop, target, exit, R:R, confidence, and behavior mistakes.
- Writes journal-compatible CSV rows.

### Generated Journal Trades

Generated rows are written to `trading-ui/public/` so a frontend developer can import or inspect them during demos.

The generated CSV uses:

```csv
date,symbol,side,entry,exit,quantity,setup,confidence,mistake,notes
```

The `notes` field includes simulated-data disclaimers and pattern reasoning.

### Journal Import

`Journal.jsx` maps import columns into canonical journal fields. Important aliases:

- `side` -> `type`
- `entry` -> `entry_price`
- `exit` -> `exit_price`
- `setup` -> `setup_tag`
- `setupTag` -> `setup_tag`
- `setupName` -> `setup_tag`
- `strategy` -> `setup_tag`
- `confidence` -> `confidence_score`
- `mistake` -> `mistake_tag`

Generated setup labels such as `Streak Pullback Confirmation` must not be discarded just because they are not part of the manual dropdown's small built-in setup list.

### Trader Profile Generation

Frontend sends local journal trades to:

```text
POST /api/intelligence/analyze
```

Backend normalizes the rows through `backend/journal/models.py`, then `backend/intelligence/training.py` builds:

- Overall metrics
- Setup history
- Symbol history
- Confidence distribution
- Repeated mistake distribution
- Risk score
- Confidence score
- Behavioral warning
- Data origin metadata

### Intelligence Analysis

User questions are sent to:

```text
POST /api/intelligence/ask
```

Future trade scoring uses:

```text
POST /api/intelligence/trade-analysis
```

For future-trade prompts, Intelligence parses explicit fields like:

```text
Analyze this future trade:
Symbol: NIFTY
Side: BUY
Setup: Streak Pullback Confirmation
Notes: weak confirmation after high volatility
```

Explicit `Setup:` text must win over inferred setup context.

## 4. Important Generated Files

Base generated dataset:

- `trading-ui/public/generated-journal-trades.csv`
- `trading-ui/public/generated-journal-trades-summary.json`
- `trading-ui/public/generated-journal-trades-statistics.json`

Latest generated dataset:

- `trading-ui/public/generated-journal-trades-latest.csv`
- `trading-ui/public/generated-journal-trades-latest-summary.json`
- `trading-ui/public/generated-journal-trades-latest-statistics.json`

Comparison report:

- `trading-ui/public/generated-journal-trades-comparison.json`

Important: do not overwrite `generated-journal-trades.csv` when generating latest datasets. Use the `-latest` filenames.

## 5. Journal Schema

### Generated CSV Fields

Generated journal CSV fields:

- `date`: Trade date in `YYYY-MM-DD` format.
- `symbol`: Normalized market symbol, such as `NIFTY`, `EURUSD`, `BTCUSDT`.
- `side`: `BUY` or `SELL` from the simulated setup.
- `entry`: Simulated entry price.
- `exit`: Simulated exit price.
- `quantity`: Simulated quantity.
- `setup`: Human-readable setup name. For generated rows this is `Streak Pullback Confirmation`.
- `confidence`: Integer `1` through `5`.
- `mistake`: Simulated behavior mistake such as `revenge trade`, `weak confirmation`, or `none`.
- `notes`: Simulated reasoning, pattern explanation, outcome explanation, and disclaimer.

### Canonical Normalized Fields

Frontend/backend normalized journal fields:

- `id`
- `date`
- `symbol`
- `asset_type`
- `type`: `LONG` or `SHORT`; generated `BUY` maps to `LONG`, `SELL` maps to `SHORT`.
- `entry_price`
- `exit_price`
- `quantity`
- `pnl`
- `pnl_pct`
- `result`: `WIN` or `LOSS`
- `notes`
- `setup_tag`
- `mistake_tag`
- `confidence_score`
- `planned_risk`
- `planned_reward`
- `rule_followed`
- `entry_reason`
- `exit_reason`
- `scenario_context`
- `synthetic_flag`
- `source_type`

### Synthetic / Simulated Flags

Rows are considered synthetic/dev when:

- `synthetic_flag === true`
- `source_type === "synthetic_dev"`
- `id` starts with `SYN-`
- generated notes contain simulation markers

Simulated rows are allowed for coaching/profile rehearsal, but UI copy must not treat them as real performance.

## 6. Intelligence Behavior

### Future Trade Prompt Parsing

The Intelligence fallback path parses labeled fields from user text:

- `Symbol:`
- `Side:`
- `Setup:`
- `Entry:`
- `Exit:`
- `Confidence:`
- `Notes:`

Explicit `Setup:` is authoritative. It should not be overridden by top-ranked setup history, retrieved source rows, sentiment words, or market context terms.

### Setup-Aware Matching

Setup names normalize to canonical keys internally. Important mapping:

- `Streak Pullback Confirmation`
- `streak_pullback_confirmation`
- `streak pullback`

These all map to the Streak Pullback Confirmation setup history.

When setup history exists, the response should include historical setup count, win rate, average R:R, and confidence distribution.

### Symbol-Aware Matching

When a symbol is explicit, Intelligence should also report symbol-level history. For example:

```text
NIFTY symbol history: 75 trades, 29.3% win rate, average R:R -0.1.
```

### Risk Score

Risk score is journal/profile-based decision support. It may rise when:

- The matched setup historically underperforms.
- Symbol-specific history is weak.
- Planned R:R is below 1.
- Repeated mistake behavior appears.
- Candidate notes mention weak confirmation or high volatility.
- High-confidence trades have historically underperformed.

### Confidence Score

Confidence score is based on profile maturity, setup history, confidence coverage, R:R coverage, rule-following data, and risk penalties. It is not a probability of a winning trade.

### Repeated Mistake Warning

Repeated mistakes are detected from `mistake_tag`. Common simulated mistake tags include:

- `revenge_trade`
- `weak_confirmation`
- `no_patience`
- `overconfidence`
- `FOMO entry`
- `chasing momentum`
- `emotional re-entry`
- `early exit`
- `oversized position`

UI copy should explain these as behavior patterns, not as predictions.

### Simulated-Data Disclaimer

When a profile is built from generated rows, responses must preserve a message like:

```text
This profile is based on simulated training rows, so treat it as coaching rehearsal rather than evidence of live trading performance.
```

### Sentiment Fallback

Sentiment and market coverage fallback should only be used when profile/setup context is unavailable or when the user explicitly asks about sentiment. A future setup question containing words like `bullish` or `bearish` should not fall into sparse sentiment coverage if setup history exists.

## 7. Backend Endpoints Used By Frontend

Base URL is controlled by:

```text
VITE_API_URL
```

Default frontend API base:

```text
http://localhost:8000
```

### `GET /api/search`

- Used by: symbol search controls.
- Input query params: `q`, optional `limit`.
- Output: symbol search results from backend market data.

### `GET /api/assets`

- Used by: asset/symbol lists.
- Input query params: optional `type`.
- Output: available assets, optionally filtered by asset type.

### `GET /api/history`

- Used by: chart and symbol history consumers.
- Input query params: `symbol`, optional `period`, optional `interval`.
- Output: OHLCV records.

### `GET /api/quote`

- Used by: quote displays and context lookups.
- Input query params: `symbol`.
- Output: current price, change percent, currency, name/metadata where available.

### `POST /api/backtest`

- Used by: `useBacktest.js`, `SymbolBacktest.jsx`, `BeginnerBacktest.jsx`.
- Input JSON:

```json
{
  "symbol": "NIFTY",
  "strategy": "sma_cross",
  "period": "1y",
  "interval": "1d",
  "initial_capital": 100000,
  "commission": 0.001,
  "slippage": 0.0005,
  "sentiment_score": 50
}
```

- Valid strategies: `sma_cross`, `rsi`, `macd`, `bollinger`, `sentiment_sma`.
- Output: backtest result with `metrics`, `trades`, equity data, and strategy-specific details.

### `POST /run-strategy`

- Used by: `StrategyBuilder.jsx` legacy CSV upload mode.
- Input: `multipart/form-data`.
- Fields:
  - `file`: CSV upload.
  - `strategy_type`: `moving_average`, `rsi`, `breakout`; `pine_script` is rejected by backend.
  - `parameters_json`: JSON string.
  - `pine_script`: legacy field, do not rely on this.
- Output:
  - `candles`
  - `signals`
  - `overlays`
  - `setups`
  - `trades`
  - `metrics`
  - `strategy`

### `POST /api/intelligence/analyze`

- Used by: `Intelligence.jsx`.
- Input JSON:

```json
{
  "trades": []
}
```

- `trades` should be normalized journal entries.
- Output: complete journal analysis, including `basic_stats`, `by_symbol`, `by_type`, `streaks`, `context_summary`, `trader_profile`, RAG availability, and model metadata.

### `POST /api/intelligence/ask`

- Used by: Ask Your Data in `Intelligence.jsx`.
- Input JSON:

```json
{
  "trades": [],
  "question": "Analyze this future trade: Symbol: NIFTY Side: BUY Setup: Streak Pullback Confirmation"
}
```

- Output:
  - `answer`
  - `sources`
  - `method`
  - `trades_searched`
  - `trader_profile`

### `POST /api/intelligence/trade-analysis`

- Used by: future trade analysis flows.
- Input JSON:

```json
{
  "trades": [],
  "trade": {
    "symbol": "NIFTY",
    "type": "LONG",
    "setup_tag": "Streak Pullback Confirmation",
    "confidence_score": 4,
    "notes": "weak confirmation after high volatility"
  }
}
```

- Output:
  - `risk_score`
  - `confidence_score`
  - `behavioral_warning`
  - `setup_quality_assessment`
  - `explanation`
  - `matched_history`
  - `profile_status`
  - `reasoning_priority`
  - `data_origin`
  - `educational_only`
  - `disclaimer`

### `POST /api/datasets/trade-export`

- Used by: Dataset Readiness in `Intelligence.jsx`, ML export from Journal.
- Input JSON:

```json
{
  "trades": [],
  "include_edgar": false
}
```

- Output: dataset rows, summary, quality gate metadata, warnings, readiness status.

### `GET /api/ml/training-report`

- Used by: Training Report Viewer in `Intelligence.jsx`.
- Input: none.
- Output:
  - `available`
  - `dev_only`
  - `synthetic_warning`
  - `report`

No training is triggered by this endpoint.

### `GET /api/edgar/context/{ticker}`

- Used by: EDGAR context panel.
- Input path param: `ticker`.
- Output: company/filing context where available, or a safe unavailable response.

### `POST /api/sentiment`

- Used by: `Sentiment.jsx`.
- Input JSON:

```json
{
  "stock": "RELIANCE"
}
```

- Output: sentiment label, score, headline distribution, headlines, timestamp.

### `GET /api/watchlist`

- Used by: watchlist/sentiment pages.
- Input: none.
- Output: list of sentiment results for configured watchlist symbols.

### `GET /api/ticker`

- Used by: ticker tape / home market strip.
- Input: none.
- Output:
  - `data`: list of symbols with price/change/currency.
  - `count`
  - `timestamp`

### `GET /api/market-overview`

- Used by: market overview UI.
- Input: none.
- Output:
  - `categories`: grouped market assets.
  - `timestamp`

### Legacy `POST /run-backtest`

- Backend route exists for CSV strategy testing.
- Not the primary frontend backtesting path.
- Input: file upload.
- Output: candles, setups, trades.

## 8. Frontend Pages And Components

Important frontend files:

- `trading-ui/src/pages/Journal.jsx`
  - Journal CRUD.
  - CSV/XLSX import.
  - Generated dataset import.
  - Real-only export.
  - Dataset export bridge.

- `trading-ui/src/pages/Intelligence.jsx`
  - Journal analysis.
  - Trader profile.
  - Ask Your Data.
  - Dataset readiness.
  - Training report viewer.
  - EDGAR and market context panels.

- `trading-ui/src/pages/StrategyBuilder.jsx`
  - Symbol Engine / Legacy CSV Upload switch.
  - Legacy `/run-strategy` upload workflow.
  - Displays strategy setups, chart, metrics, and trades.

- `trading-ui/src/components/SymbolBacktest.jsx`
  - Expert symbol backtest controls.
  - Calls `/api/backtest`.

- `trading-ui/src/components/backtest/BeginnerBacktest.jsx`
  - Beginner backtest UI.
  - Calls `/api/backtest`.
  - Stores recent backtest results.

- `trading-ui/src/components/PerformanceMetrics.jsx`
  - Displays strategy/backtest metrics.

- `trading-ui/src/hooks/useBacktest.js`
  - Shared hook for symbol backtesting.
  - Persists backtest history.

- `trading-ui/src/services/api.js`
  - Central JSON API wrapper.
  - Use this for new JSON backend calls.

- `trading-ui/src/services/storage.js`
  - Central localStorage key registry and read/write helpers.

- `trading-ui/src/lib/api.js`
  - Legacy base URL helper used by `StrategyBuilder.jsx`.

## 9. LocalStorage Keys

Defined in `trading-ui/src/services/storage.js`:

```js
export const STORAGE_KEYS = {
  journal: "bullcast_journal_v1",
  traderProfile: "bullcast_trader_profile_v1",
  analysisHistory: "bullcast_analysis_history_v1",
  backtestResults: "bullcast_backtest_results_v1",
}
```

### `bullcast_journal_v1`

Stores journal entries, including imported generated rows. Generated/imported data is not stored under a separate key. It enters the app as journal rows with synthetic/dev flags and simulation notes.

### `bullcast_trader_profile_v1`

Stores the latest trader profile returned by Intelligence analysis or Ask Your Data.

### `bullcast_analysis_history_v1`

Stores recent Intelligence analysis / Q&A history.

### `bullcast_backtest_results_v1`

Stores recent backtest outputs from symbol backtesting and legacy CSV strategy runs.

## 10. UI Redesign Rules

Do:

- Keep API request and response field names stable.
- Preserve `setup_tag`, `mistake_tag`, `confidence_score`, `synthetic_flag`, and `source_type`.
- Keep generated/simulated-data disclaimers visible.
- Clearly distinguish real/paper journal rows from simulated/dev rows.
- Use backend-provided risk/confidence/history outputs instead of inventing frontend-only scores.
- Keep all analysis educational and decision-support only.

Do not:

- Rename API fields casually.
- Remove simulated/dev warnings.
- Present synthetic metrics as live or real trading performance.
- Add broker connection, real-money trading, order placement, or account execution.
- Claim future performance, guaranteed outcomes, or buy/sell recommendations.
- Turn the offline Streak Pullback converter into a frontend trading signal.

## 11. Suggested Frontend Sections

A polished frontend can safely reorganize the experience around these sections:

- Dashboard
  - Journal summary
  - Latest profile status
  - Backtest snapshots
  - Dataset readiness summary

- Journal Import
  - CSV/XLSX upload
  - Generated CSV import
  - Import validation and synthetic/dev labeling

- Strategy Intelligence
  - Ask Your Data
  - Future trade analysis
  - Setup and symbol matching evidence

- Trader Profile
  - Risk score
  - Confidence score
  - Repeated mistakes
  - Best/worst symbols and setups
  - Data-origin badge

- Backtest Results
  - Metrics
  - Equity curve
  - Execution log
  - Beginner/Expert modes

- Dataset Readiness
  - Quality gate
  - Coverage fields
  - Real-only export controls

- Model Training Status
  - Read-only training report
  - Synthetic/dev warnings
  - Real-data collection guidance

- Risk / Behavior Insights
  - Repeated mistake warnings
  - Weak confirmation flags
  - Overconfidence and revenge-trade indicators

## 12. Copywriting Guidance

Use clear, professional language.

Good phrasing:

- "This is journal-based decision support, not a trade recommendation."
- "Simulated rows are useful for coaching rehearsal and pipeline validation."
- "Historical setup performance in your journal shows..."
- "Risk score increased because similar rows had weak confirmation and repeated revenge-trade tags."

Avoid:

- "This setup will win."
- "Buy now."
- "The model predicts profit."
- "Synthetic results prove the strategy works."
- "Guaranteed edge."

When showing generated rows, use labels like:

- `SIMULATED DATA`
- `Generated from OHLC pattern alert data`
- `Not real trading history`
- `For education and research only`

## 13. Testing Checklist

Before shipping frontend redesign work:

1. Start backend:

```powershell
python -m uvicorn backend.server:app --reload --host 127.0.0.1 --port 8000
```

2. Start frontend:

```powershell
cd trading-ui
npm run dev
```

3. Import generated CSV:

```text
trading-ui/public/generated-journal-trades.csv
```

4. Verify imported trade count is approximately `1781` for the base generated dataset.

5. Optionally import latest generated CSV:

```text
trading-ui/public/generated-journal-trades-latest.csv
```

Latest generated trade count is approximately `2560`.

6. Verify setup history includes:

```text
Streak Pullback Confirmation
```

7. Ask Intelligence:

```text
Analyze this future trade: Symbol: NIFTY Side: BUY Setup: Streak Pullback Confirmation Notes: weak confirmation after high volatility
```

8. Expected Intelligence behavior:

- References `Streak Pullback Confirmation`.
- Uses matched setup history.
- Includes NIFTY symbol history when available.
- Includes risk score.
- Includes confidence score.
- Includes repeated mistake behavior if present.
- Does not fall back to sparse sentiment coverage when setup history exists.
- Keeps simulated-data disclaimer.

9. Verify backtesting:

- `/backtest` loads.
- Beginner/Expert switch works.
- Backtest completes or shows a visible error.
- Metrics render without layout breakage.

10. Verify dataset readiness:

- `/intelligence` loads.
- Dataset preview runs.
- Training report handles no-report and dev-only states.
- Data-origin warnings remain visible.

11. Run build:

```powershell
cd trading-ui
npm run build
```

12. If backend changed, run:

```powershell
python -m pytest tests -q
```

## 14. Final Handoff Summary

Safe to redesign:

- Layout, spacing, visual hierarchy, responsive behavior.
- Navigation structure.
- Dashboard composition.
- Cards, tables, charts, tabs, empty states, and loading states.
- Copy clarity, as long as disclaimers remain accurate.
- How existing API results are presented.

Must stay unchanged unless backend is updated in sync:

- API endpoint paths.
- Request payload field names.
- Response field expectations.
- Journal normalized schema.
- `setup_tag` canonical handling.
- Synthetic/dev flags and data-origin warnings.
- Future trade parsing semantics for explicit `Setup:`.
- Real-only export rules.
- No broker execution.
- No financial advice, signal, or prediction claims.

The frontend can be polished aggressively, but Bullcast's product promise must remain: research workflow, journal intelligence, simulated training support, and educational decision support only.
