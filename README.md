# Bullcast

Bullcast is a full-stack market research and trading-journal intelligence prototype. It combines a React trading dashboard, journal import/export workflows, symbol backtesting, ML dataset readiness checks, training-report visibility, and RAG-style market context panels.

The project is designed to demonstrate practical product engineering around trading data workflows. It does not provide financial advice, live trading automation, buy/sell signals, or production model inference.

## Core Features

- **Trading journal** with add/edit trade workflows and local persistence.
- **CSV/XLSX journal import** for onboarding historical journal data.
- **Real-only JSON export** that excludes synthetic/dev rows before external review.
- **ML dataset export bridge** that sends real-only journal trades through the backend dataset exporter.
- **Backtest module** with Beginner and Expert modes.
- **Intelligence page** with dataset readiness, training report review, data origin safety, real-data collection guidance, and market context panels.
- **Synthetic-data safety labeling** so dev pipeline validation is not confused with real model performance.
- **Backend API** for health checks, market data, backtesting, dataset export, ML report retrieval, and intelligence context.

## ML Readiness Pipeline

Bullcast separates journal collection, dataset readiness, and model training review.

1. Journal trades are collected in the UI using the `bullcast_journal_v1` localStorage key.
2. Synthetic/dev rows are detected using:
   - `synthetic_flag === true`
   - `source_type === "synthetic_dev"`
   - IDs starting with `SYN-`
3. Real-only journal rows can be exported directly as JSON.
4. Real-only journal rows can also be sent to `POST /api/datasets/trade-export` with:

   ```json
   {
     "trades": [],
     "include_edgar": false
   }
   ```

5. The backend dataset exporter returns quality-gate metadata such as readiness level, training readiness, and score.
6. The Training Report Viewer displays existing baseline training reports and clearly labels whether the report contains synthetic/dev data.

The UI does not train models. Training remains an explicit backend workflow and should only be run with appropriate real or paper-trading journal data.

## RAG / Market Intelligence

Bullcast includes market intelligence panels intended for context and research, not prediction.

- Journal-aware insight sections summarize local trading patterns when data is available.
- RAG-style context panels explain how journal notes, trade history, market data, and optional EDGAR context can support review workflows.
- Empty states are shown when journal data or training reports are unavailable, so the UI does not present blank or misleading panels.
- Intelligence features are informational only and do not generate buy/sell recommendations.

## Journal Import / Export

The Journal page supports:

- Importing `.csv` and `.xlsx` files.
- Parsing the first sheet from XLSX workbooks.
- Normalizing journal fields such as symbol, asset type, trade direction, result, numeric values, booleans, and ML-ready metadata.
- Calculating missing `pnl`, `pnl_pct`, and `result` when enough entry/exit data exists.
- Merging imported rows into existing localStorage trades by ID.
- Exporting all journal data where existing export controls are available.
- Exporting real-only journal trades for model-readiness review.

Supported ML-related fields include:

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

## Real-Only Dataset Export

The real-only export workflow prevents synthetic/dev rows from being mixed into real training datasets.

Rows are excluded from real-only exports when:

- `synthetic_flag` is true
- `source_type` equals `synthetic_dev`
- `id` starts with `SYN-`

The Journal page includes:

- **Export Real Trades JSON** for downloading real-only journal trades.
- **Export ML Dataset JSON** for sending real-only trades through the backend dataset exporter and downloading the resulting dataset JSON.

If no real trades are available, the UI shows a visible message and does not download a file or call the backend exporter.

## Backtest Module

Bullcast includes a symbol backtesting workflow with two display modes:

- **Beginner mode** presents a simplified interface with clearer labels and reduced technical detail.
- **Expert mode** exposes the full backtest controls, including asset type, symbol search, strategy, period, interval, initial capital, commission, slippage, sentiment controls where applicable, metrics, equity curve, and execution log.

Backtesting is a historical simulation tool. It does not imply production readiness and does not place trades.

## Synthetic-Data Safety

Synthetic/dev data is useful for validating the pipeline, but it must not be treated as real model performance.

Training reports can include:

```json
{
  "data_origin": {
    "synthetic_rows": 0,
    "real_rows": 0,
    "synthetic_ratio": 0,
    "contains_synthetic_data": false,
    "dev_only": false
  }
}
```

When synthetic/dev data is present, the UI keeps warnings visible:

- Synthetic/dev metrics are for pipeline validation only.
- Dev-only reports are labeled clearly.
- Reports with zero real rows show a real-data-required guard.
- Missing data-origin metadata is treated as experimental.

## Tech Stack

**Frontend**

- React
- Vite
- Tailwind CSS
- Recharts
- lightweight-charts
- xlsx
- Browser localStorage for prototype journal persistence

**Backend**

- FastAPI
- Pydantic
- pandas
- NumPy
- yfinance
- scikit-learn
- joblib

**Data / Workflows**

- JSON journal data
- CSV/XLSX imports
- Real-only dataset export
- Baseline ML training reports
- QA checklist in `docs/QA_CHECKLIST.md`

## Setup

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
npm run dev
```

If needed, point the UI at the backend:

```powershell
$env:VITE_API_URL="http://127.0.0.1:8000"
```

Build before committing frontend work:

```powershell
cd trading-ui
npm run build
```

## QA Checklist

Use [docs/QA_CHECKLIST.md](docs/QA_CHECKLIST.md) before committing UI or API changes.

Key checks include:

- `/journal` loads.
- Journal import/export controls are visible.
- Add Trade works.
- `/backtest` loads.
- Beginner/Expert switch works.
- Backtest completes or shows a visible error and never stays stuck on `RUNNING`.
- `/intelligence` loads with readable panels.
- Training Report Viewer handles the no-report state.
- Data Origin warnings appear for synthetic/dev data.
- Backend `/health`, `/api/ml/training-report`, `/api/datasets/trade-export`, and `/api/backtest` return JSON or visible errors.

If `backend/server.py` changes, run:

```powershell
python -m py_compile backend/server.py
```

## Repository Guardrails

Do not commit:

- `backend/models/`
- `journal_trades.json`
- `dev_data/`
- `.env`

Do not run model training during UI-only fixes. Do not commit generated artifacts.

## Current Limitations

- Prototype persistence is browser-local unless data is exported.
- No production authentication, user accounts, or database-backed journal storage.
- No live trading, brokerage integration, order execution, or buy/sell inference.
- Backtest results depend on available historical market data and strategy assumptions.
- ML reports are review artifacts and must be interpreted with data-origin and quality-gate context.
- Synthetic/dev datasets are only valid for pipeline validation.
- RAG and market intelligence panels are informational and depend on available local journal data and backend context.

## Future Roadmap

- Database-backed journal storage and account support.
- Stronger import validation and field-mapping tools.
- Real-data collection progress tracking across asset classes.
- Expanded dataset quality gates and model governance reporting.
- Historical report archive with data-origin lineage.
- More robust RAG retrieval over journal notes, filings, market context, and trade outcomes.
- Automated QA smoke tests for the main demo routes.
- Deployment-ready configuration, environment management, and CI checks.
- Broader backtest strategy coverage with clearer benchmark comparisons.
