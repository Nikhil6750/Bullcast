# Bullcast

Bullcast is an AI-assisted trading research and journal intelligence platform. It converts market data and journal entries into structured insights for educational decision-support.

The project combines a React frontend, a Python backend, an offline OHLC pattern-conversion pipeline, journal analytics, backtesting, dataset readiness checks, and trader-behavior intelligence. It is designed to demonstrate practical product engineering around trading-data workflows, not to provide trading instructions.

## Important Disclaimer

Bullcast is not financial advice.

- It does not connect to brokers.
- It does not execute trades.
- It does not support real-money trading automation.
- It does not generate buy/sell signals or guaranteed outcomes.
- Synthetic/generated trades are for development, research, and coaching simulation only.
- Model and simulated-trade metrics are not real trading performance.

All analysis is educational decision-support based on supplied journal data and historical simulations.

## Key Features

- Trade journal import for CSV/XLSX files.
- OHLC dataset converter for market candle files.
- Streak Pullback Confirmation pattern engine.
- Simulated journal trade generation from OHLC candles.
- Trader profile generation from journal history.
- Setup-aware Intelligence analysis.
- Symbol-aware historical matching.
- Risk score and confidence score generation.
- Repeated mistake detection.
- Backtesting metrics for historical strategy simulations.
- Local browser persistence for prototype workflows.
- Dataset readiness checks for ML/data quality review.
- Synthetic/dev data labeling to prevent simulated rows from being mistaken for real performance.

## How The System Works

```text
OHLC datasets
  -> Streak Pullback Confirmation converter
  -> generated journal trades
  -> Journal import
  -> normalized journal model
  -> trader profile
  -> Intelligence analysis
  -> risk / confidence / repeated-mistake insights
```

The offline converter reads OHLC CSV files and produces simulated Bullcast journal entries. The frontend can import those rows into the Journal. The backend then normalizes journal rows, builds a trader profile, and uses that profile to answer future-trade and performance questions.

When a future trade prompt includes a setup such as:

```text
Analyze this future trade: Symbol: NIFTY Side: BUY Setup: Streak Pullback Confirmation
```

Bullcast prioritizes explicit setup history and symbol history before falling back to generic sentiment or market-context messaging.

## Architecture Overview

### Frontend

The frontend is a React + Vite application in `trading-ui/`.

Core responsibilities:

- Journal entry management and import/export.
- Intelligence dashboard and Q&A workflows.
- Dataset readiness and training report panels.
- Symbol backtesting in Beginner and Expert modes.
- Local persistence through `localStorage`.

### Backend

The backend is a Python API centered around `backend/server.py`.

Core responsibilities:

- Journal model validation and normalization.
- Intelligence analysis and trader-profile generation.
- Future-trade behavior assessment.
- Dataset export and readiness metadata.
- Historical backtesting.
- Market data and sentiment context endpoints.

### Data Artifacts

Bullcast produces CSV and JSON artifacts for generated simulated trades:

- Generated journal CSV files.
- Generation summary JSON files.
- Generation statistics JSON files.
- Old-vs-latest dataset comparison reports.

These artifacts make the pipeline inspectable and reproducible during development.

## Strategy Engine

The main offline strategy engine is the Streak Pullback Confirmation converter in:

```text
backend/datasets/pattern_alert_journal.py
```

At a high level, it looks for:

1. A candle streak of 4 or more candles in one direction.
2. A pullback of at most 2 candles.
3. Retracement validation against the final streak candle.
4. Midpoint target logic to determine the structural break level.
5. A breaking candle that crosses the target.
6. A confirmation candle that aligns with the original streak direction.
7. A simulated trade outcome using stop loss, target, max hold, and R:R rules.

Each generated trade includes:

- Entry and exit.
- Side.
- Simulated quantity.
- Confidence score.
- Mistake tag.
- Notes explaining setup quality and outcome.
- A clear simulated-data disclaimer.

This engine is an offline research/data-generation pipeline. It is not a live trading strategy selector.

## Intelligence Engine

The Intelligence layer is built around:

```text
backend/intelligence/
backend/journal/
```

It supports:

- Explicit setup parsing from user prompts.
- Setup-aware matching against journal history.
- Symbol-aware matching against journal history.
- Confidence distribution summaries.
- Repeated mistake pattern detection.
- Educational risk scoring.
- Educational confidence scoring.
- Simulated-data disclaimers when generated rows are used.

The engine is deterministic and journal-grounded. It does not predict market direction. It explains how a proposed future trade compares to historical journal patterns.

Example behaviors:

- Reduce confidence when similar setups historically underperformed.
- Raise behavior risk when repeated mistake tags appear.
- Highlight weak confirmation, revenge-trade, overconfidence, or high-volatility context when present.
- Avoid sparse sentiment fallback when matching setup history exists.

## Generated Data

Important generated files:

```text
trading-ui/public/generated-journal-trades.csv
trading-ui/public/generated-journal-trades-summary.json
trading-ui/public/generated-journal-trades-statistics.json
```

Latest generated dataset files:

```text
trading-ui/public/generated-journal-trades-latest.csv
trading-ui/public/generated-journal-trades-latest-summary.json
trading-ui/public/generated-journal-trades-latest-statistics.json
trading-ui/public/generated-journal-trades-comparison.json
```

Current base generated dataset summary:

- Simulated trades generated: `1,781`
- Setups detected: `46,079`
- Win rate: `29.53%`
- Average R:R: `-0.1244`
- Most common non-empty mistake: `revenge trade`

Latest generated dataset summary:

- Simulated trades generated: `2,560`
- Setups detected: `66,185`
- Win rate: `30.55%`
- Average R:R: `-0.0923`

All generated rows are synthetic/dev research data and must be labeled as such.

## Tech Stack

### Frontend

- React
- Vite
- JavaScript
- Recharts / charting components
- Browser `localStorage`

### Backend

- Python
- FastAPI-style API structure
- Pydantic models
- pytest

### Data

- CSV
- JSON
- OHLC candle datasets
- Generated journal artifacts

### Storage

- Browser `localStorage` for prototype persistence.
- No production database yet.

## Project Structure

```text
backend/
  datasets/
    pattern_alert_journal.py          # Streak Pullback converter
    compare_generated_journals.py     # Old-vs-latest generated dataset report
    trade_dataset.py                  # Dataset export and readiness checks

  intelligence/
    analyzer.py                       # Journal statistics and pattern analysis
    coach.py                          # Intelligence orchestration
    prompts.py                        # Prompt/fallback response logic
    training.py                       # Trader profile engine

  journal/
    models.py                         # Canonical journal data model

  backtesting/
    engine.py                         # Backtest execution
    metrics.py                        # Metric calculations

trading-ui/
  src/pages/
    Journal.jsx                       # Journal CRUD/import/export
    Intelligence.jsx                  # Intelligence dashboard and Q&A
    StrategyBuilder.jsx               # Strategy lab/backtest workspace

  src/components/
    SymbolBacktest.jsx
    PerformanceMetrics.jsx

  src/hooks/
    useBacktest.js

  src/services/
    api.js                            # Frontend API wrapper
    storage.js                        # localStorage keys/helpers

tests/
  test_pattern_alert_converter.py
  test_trader_training.py
  test_generated_journal_comparison.py
  ...
```

## Run Locally

### Backend Setup

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

### Frontend Setup

```powershell
cd trading-ui
npm install
npm run dev
```

If needed, point the frontend to the backend:

```powershell
$env:VITE_API_URL="http://127.0.0.1:8000"
```

### Run Tests

```powershell
python -m pytest tests -q
```

### Build Frontend

```powershell
cd trading-ui
npm run build
```

## Testing Status

Latest local verification:

- `python -m pytest tests -q` passed.
- `npm run build` passed.
- Existing Vite/Browserslist warnings are non-blocking maintenance warnings.

The build currently warns about stale browser metadata and a large chunk. These are not functional failures.

## Example Intelligence Output

Synthetic/dev training example:

```text
Streak Pullback Confirmation has 1781 historical training trades,
29.5% win rate, average R:R -0.14.
NIFTY symbol history is included when available.
Repeated revenge_trade behavior appears 168 times.
```

This example is based on generated simulated training rows. It is not real trading performance and should not be interpreted as a prediction or trading recommendation.

## Current Limitations

- Real journal data is needed for meaningful real trader profiling.
- Synthetic metrics are not real performance.
- No live broker integration or order execution.
- No real-money trading workflow.
- Persistence is local-first through browser `localStorage`.
- No production authentication or account system yet.
- No production database yet.
- Backtesting depends on historical data quality and assumptions.
- Intelligence outputs are educational and journal-grounded, not predictive.
- The system is not production financial infrastructure.

## Future Improvements

- Real paper-trade journal collection workflows.
- Supabase/Postgres persistence.
- User authentication and account-level journals.
- Improved model training with stronger validation and governance.
- Better visual analytics for setup history and behavior patterns.
- Deployment-ready configuration.
- Richer generated-dataset comparison views.
- Historical training report archive.
- Stronger import field-mapping tools.
- Expanded real-data collection progress tracking.

## Recruiter Notes

Bullcast demonstrates:

- Full-stack product engineering with React and Python.
- Data normalization across messy CSV/import workflows.
- Offline data-generation pipelines.
- Deterministic analytics and profile generation.
- Backtesting metric design.
- Local persistence and API integration.
- Test coverage for converter, profile, and matching behavior.
- Careful handling of synthetic data and domain-specific disclaimers.

The project intentionally avoids claims of profitability or production trading readiness. Its focus is engineering rigor around trading-research workflows, data quality, and explainable journal intelligence.
