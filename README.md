# Bullcast

Bullcast is a full-stack market research, backtesting, and trading-journal intelligence prototype. It combines a React trading dashboard with a FastAPI backend for market data, historical strategy simulation, journal dataset export, ML-readiness checks, training-report review, and journal-grounded AI analysis.

Bullcast is educational decision-support software. It does not provide financial advice, live trading automation, brokerage integration, order execution, production model inference, or buy/sell signals.

## What Bullcast Does

- Stores a local trading journal with add/edit workflows and CSV/XLSX import.
- Exports journal data, including a real-only export path that excludes synthetic/dev rows.
- Converts real journal rows into model-ready dataset JSON through the backend exporter.
- Builds a trader behavior profile from real journal history.
- Uses journal history to support AI/RAG-style questions about performance patterns.
- Runs historical symbol backtests in Beginner and Expert modes.
- Shows dataset readiness, training-report metadata, data-origin safety, and market-context panels.
- Labels synthetic/dev data so pipeline validation is not confused with real performance.

## System Architecture

```text
trading-ui/ React + Vite
  Journal.jsx
    localStorage journal persistence
    CSV/XLSX import
    real-only export and dataset export

  Intelligence.jsx
    local journal read
    /api/intelligence/analyze
    /api/intelligence/ask
    dataset readiness and report panels

  StrategyBuilder / SymbolBacktest
    /api/backtest
    /run-strategy legacy CSV strategy lab
    localStorage backtest result history

backend/ FastAPI
  server.py
    API routes and request models

  journal/models.py
    canonical JournalTrade model and normalization

  intelligence/
    analyzer.py        journal stats and pattern analysis
    training.py        human trade training engine and behavior profile
    coach.py           RAG, fallback answers, future-trade behavior assessment
    prompts.py         grounded prompt/fallback response construction

  backtesting/
    engine.py          symbol backtest execution
    metrics.py         consistent metric contract

  datasets/trade_dataset.py
    model-ready dataset export and quality gates
```

## Persistence

Bullcast uses browser `localStorage` for prototype persistence:

- `bullcast_journal_v1`: journal entries.
- `bullcast_trader_profile_v1`: latest trader behavior profile.
- `bullcast_analysis_history_v1`: journal analysis and question history summaries.
- `bullcast_backtest_results_v1`: recent symbol and CSV strategy backtest results.

There is no production database or account system yet.

## Journal Training Flow

1. Journal rows are collected in the UI and persisted locally.
2. The backend validates and normalizes rows through `JournalTrade`.
3. Synthetic/dev rows are excluded from human behavior profiling when any of these are true:
   - `synthetic_flag === true`
   - `source_type === "synthetic_dev"`
   - `id` starts with `SYN-`
4. `HumanTradeTrainingEngine` reads real journal trades and calculates:
   - total trades, wins, losses
   - win rate and loss rate
   - net PnL and profit factor
   - average R:R from planned risk/reward when available, otherwise realized win/loss size
   - average confidence
   - rule-following rate
   - repeated mistakes
   - best-performing symbols and setups
5. The engine returns a behavior profile with:
   - risk score
   - confidence score
   - behavioral warning
   - explanation grounded in journal history

This is not model training. It is deterministic journal analysis for coaching context.

## AI Analysis Flow

The main endpoints are:

- `POST /api/intelligence/analyze`
  - Input: `{ "trades": [...] }`
  - Output: performance stats, patterns, context summary, and `trader_profile`.

- `POST /api/intelligence/ask`
  - Input: `{ "trades": [...], "question": "..." }`
  - Output: a grounded answer, sources, method, and latest `trader_profile`.
  - Uses Anthropic only when an API key is already configured; otherwise uses the local template/RAG fallback.

- `POST /api/intelligence/trade-analysis`
  - Input: `{ "trades": [...], "trade": {...} }`
  - Output: future-trade behavior assessment with `risk_score`, `confidence_score`, `behavioral_warning`, and journal-history explanation.
  - This is decision-support context only and never a buy/sell signal.

RAG and market-context panels are informational. Answers must stay grounded in the supplied journal data and avoid predictions.

## Backtesting Flow

Bullcast has two backtesting paths:

- Symbol backtesting through `POST /api/backtest`
  - Fetches historical OHLCV data.
  - Applies a selected strategy.
  - Returns trades, signals, chart data, equity curve, and metrics.

- Legacy CSV strategy lab through `POST /run-strategy`
  - Accepts uploaded candle CSV files.
  - Evaluates backend strategy logic.
  - Returns candles, signals, setups, trades, and metrics.

Backtesting metrics now expose a consistent core set:

- total trades
- win rate
- net PnL / total PnL
- max drawdown
- profit factor
- average R:R

Backtests are historical simulations. They do not imply future performance and do not place trades.

## Dataset Export And ML Readiness

Real-only dataset export excludes synthetic/dev rows before sending data to:

```http
POST /api/datasets/trade-export
```

Payload:

```json
{
  "trades": [],
  "include_edgar": false
}
```

The backend returns model-ready rows, summary metadata, and quality-gate checks. The UI does not train models. Baseline training reports are review artifacts only and must be interpreted with data-origin metadata.

## Run Locally

### Backend

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r backend\requirements.txt
python -m uvicorn backend.server:app --reload --host 127.0.0.1 --port 8000
```

Health check:

```powershell
curl http://127.0.0.1:8000/health
```

### Frontend

```powershell
cd trading-ui
npm install
$env:VITE_API_URL="http://127.0.0.1:8000"
npm run dev
```

Production build check:

```powershell
cd trading-ui
npm run build
```

## QA Checklist

Use [docs/QA_CHECKLIST.md](docs/QA_CHECKLIST.md) before committing UI or API changes.

Key checks:

- `/journal` loads.
- Journal import/export controls are visible.
- Add Trade works.
- `/backtest` loads.
- Beginner/Expert switch works.
- Backtest completes or shows a visible error and never stays stuck on `RUNNING`.
- `/intelligence` loads with readable panels.
- Training Report Viewer handles the no-report state.
- Data Origin warnings appear for synthetic/dev data.
- Backend `/health`, `/api/ml/training-report`, `/api/datasets/trade-export`, `/api/intelligence/analyze`, `/api/intelligence/ask`, `/api/intelligence/trade-analysis`, and `/api/backtest` return JSON or visible errors.

If `backend/server.py` changes, run:

```powershell
python -m py_compile backend/server.py
```

Recommended backend checks:

```powershell
pytest
```

## Repository Guardrails

Do not commit:

- `backend/models/`
- `journal_trades.json`
- `dev_data/`
- `.env`

Do not run model training during UI-only fixes. Do not commit generated artifacts.

## Limitations And Disclaimer

- Prototype persistence is browser-local unless data is exported.
- There is no production authentication, user account, or database-backed journal storage.
- There is no live trading, brokerage integration, order execution, or buy/sell inference.
- Backtest results depend on historical data availability, fees, slippage assumptions, and strategy assumptions.
- Trader behavior profiles are deterministic journal summaries, not predictive models.
- ML reports are review artifacts and must be interpreted with data-origin and quality-gate context.
- Synthetic/dev datasets are only valid for pipeline validation.
- RAG and market intelligence panels are informational and depend on available journal and backend context.
- Nothing in Bullcast is financial advice.

## Future Roadmap

- Database-backed journal storage and account support.
- Stronger import validation and field-mapping tools.
- Real-data collection progress tracking across asset classes.
- Expanded dataset quality gates and model governance reporting.
- Historical report archive with data-origin lineage.
- More robust retrieval over journal notes, filings, market context, and trade outcomes.
- Automated QA smoke tests for the main demo routes.
- Deployment-ready configuration, environment management, and CI checks.
- Broader backtest strategy coverage with clearer benchmark comparisons.
