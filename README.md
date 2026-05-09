# Bullcast

[![CI](https://github.com/Nikhil6750/Bullcast/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Nikhil6750/Bullcast/actions/workflows/ci.yml)

[Live demo](https://bullcast-ruddy.vercel.app)

Bullcast is a trading research and journal platform focused on rule-based trade intelligence first, with optional Gemini-powered journal summarization second. Deterministic journal analytics remain the source of truth; Gemini is used only for educational summaries when configured on the backend.

The project combines a React frontend, a FastAPI backend, Supabase-backed journal persistence, local browser fallback storage, deterministic journal analytics, backtesting, and GitHub Actions CI. It demonstrates product engineering around trading-data workflows, not trading automation or financial advice.

## Architecture

- React/Vite frontend in `trading-ui/`, deployed on Vercel.
- FastAPI backend centered on `backend/server.py`.
- Supabase journal persistence for trades, analysis history, and trader profiles when configured.
- Browser `localStorage` fallback when Supabase environment variables are missing or Supabase requests fail.
- Gemini journal summary endpoint: `POST /api/intelligence/journal-summary`.
- Deterministic intelligence modules in `backend/intelligence/` and canonical journal models in `backend/journal/`.
- GitHub Actions CI runs backend tests and frontend production builds on `main`.

## Current Status

Implemented:

- Supabase journal persistence.
- Vercel frontend deployment: https://bullcast-ruddy.vercel.app
- GitHub Actions CI.
- Gemini journal summary endpoint with deterministic fallback behavior.
- Rule-based journal analytics, repeated mistake detection, setup-aware matching, and trader profile generation.
- Backtesting and generated-data research pipelines.

Pending:

- Supabase Auth + user-scoped RLS before storing real user data.
- Backend production hardening and validation before production user workflows.
- Deeper RAG/ML layer beyond the current deterministic analytics and optional Gemini summary.
- More complete real paper-trade collection and account-level journal workflows.

## Key Features

- Trade journal import for CSV/XLSX files.
- Journal CRUD, import/export, and analysis workflows.
- Supabase-backed persistence with browser `localStorage` fallback.
- Trader profile generation from journal history.
- Setup-aware and symbol-aware historical matching.
- Heuristic risk, confidence, and repeated-mistake scoring.
- Optional Gemini-powered journal summarization for educational review.
- Streak Pullback Confirmation offline pattern engine.
- Simulated journal trade generation from OHLC candle data.
- Backtesting metrics for historical strategy simulations.
- Dataset readiness checks for future data-quality and ML work.
- Synthetic/dev data labeling to prevent simulated rows from being mistaken for real performance.

## Setup

Backend:

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn backend.server:app --reload --host 127.0.0.1 --port 8000
```

Frontend:

```powershell
cd trading-ui
npm install
npm run dev
```

Health check:

```powershell
curl http://127.0.0.1:8000/health
```

## Environment Variables

Create local env files from `.env.example` and `trading-ui/.env.example`. Do not commit real values.

Backend/server-side:

```text
GEMINI_API_KEY=
ANTHROPIC_API_KEY=
```

Frontend/public Vite variables:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_API_URL=
```

Notes:

- `GEMINI_API_KEY` powers optional journal summaries; `ANTHROPIC_API_KEY` powers the existing coaching/Q&A path if configured.
- Gemini keys must not be exposed through frontend `VITE_*` variables.
- The frontend uses only Supabase URL and anon/publishable key values.
- Supabase service-role keys must never be committed or exposed to the browser.
- If Supabase variables are missing, Bullcast keeps using browser `localStorage`.

## Testing

Run backend tests:

```powershell
python -m pytest tests -q
```

Build the frontend:

```powershell
cd trading-ui
npm run build
```

CI runs the same backend test suite and frontend build through GitHub Actions.

## Security / Limitations

### Important Disclaimer

Bullcast is not financial advice.

- It does not connect to brokers.
- It does not execute trades.
- It does not support real-money trading automation.
- It does not generate buy/sell signals or guaranteed outcomes.
- Risk and confidence scores are heuristic, profile-driven summaries, not probabilities or market predictions.
- Gemini summaries are educational journal reviews, not trade recommendations or market predictions.
- Model/report metrics and simulated-trade metrics are not real trading performance.

### Current Limitations

- Real journal data is needed for meaningful real trader profiling.
- Synthetic/generated trades are for development, research, and coaching simulation only.
- Supabase Auth and user-scoped RLS are pending before real user data should be stored.
- Current Supabase policies are development-only until auth-scoped access is implemented.
- Backtesting depends on historical data quality and modeling assumptions.
- Gemini summarization is optional and depends on backend `GEMINI_API_KEY`; deterministic journal analytics still work without it.
- The system is not production financial infrastructure.

## Roadmap

- Add Supabase Auth and production user-scoped RLS.
- Harden backend deployment and environment handling for production workflows.
- Expand real paper-trade journal collection.
- Add account-level journal separation.
- Build a deeper RAG/ML layer with clear evaluation gates and deterministic fallbacks.
- Improve setup-history and behavior analytics visualizations.
- Add richer generated-dataset comparison views.
- Improve import field mapping and validation.
- Archive historical training reports for reproducibility.
