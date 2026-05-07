# Bullcast QA Checklist

Run this before UI-related commits.

## Manual UI Checks

- `/journal` loads.
- `Import CSV/XLSX` button is visible.
- `Export Real Trades JSON` button is visible.
- Add Trade opens, saves, and the new trade renders.
- `/backtest` loads.
- Beginner / Expert switch is visible and clickable.
- Run Backtest completes with results or shows a visible error. It must never stay stuck on `RUNNING...`.
- `/intelligence` loads.
- Intelligence panels show readable text, not blank cards.
- Training Report Viewer handles the no-report state: `No training report found. Run baseline training first.`
- Data Origin warnings appear when synthetic/dev data is present.

## Backend Smoke Checks

- `GET /health` returns `200`.
- `GET /api/ml/training-report` returns JSON.
- `POST /api/datasets/trade-export` returns JSON.
- `POST /api/backtest` returns JSON or the frontend shows a visible error.

## Commit Guardrails

- Never commit `backend/models/`.
- Never commit `journal_trades.json`.
- Never commit `dev_data/`.
- Do not run model training during UI fixes.
- Run `npm run build` before every commit.
- Run `python -m py_compile backend/server.py` if `backend/server.py` changes.
