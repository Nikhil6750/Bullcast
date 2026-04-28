# Architecture

**Date:** 2026-04-28
**Focus:** System design, patterns, layers, data flow, abstractions.

## High-Level Architecture
The project follows a standard Client-Server architecture separated into a React Single Page Application (SPA) and a FastAPI REST backend.

### 1. Presentation Layer (Frontend)
- **Framework**: React via Vite (`trading-ui/`).
- **Responsibilities**: Provide UI for uploading market data CSVs, selecting strategies, and visualizing backtest results and charts.
- **Data Flow**: Fetches/posts data to the backend via HTTP REST endpoints using `axios`. Renders charts using `lightweight-charts` and `recharts`.

### 2. API / Routing Layer (Backend)
- **Framework**: FastAPI (`backend/server.py`).
- **Responsibilities**: Accept file uploads, parse basic parameters, validate inputs, and route requests to the appropriate strategy execution engine.
- **Endpoints**:
  - `GET /health`: System health check.
  - `POST /run-backtest`: Runs the standard gap-handling locked strategy.
  - `POST /run-strategy`: Runs custom or varied strategies via `strategy_lab.py`.

### 3. Execution & Strategy Layer (Backend Core)
- **Responsibilities**: Process parsed candle data, apply trading rules, and generate trades/setups.
- **Components**:
  - `data_loader.py`: Parses CSV inputs into structured data (likely pandas DataFrames or list of dicts).
  - `gap_handling.py`: Implements trade generation and setup rules with specific logic for market gaps.
  - `strategy_lab.py`: Advanced environment for testing different strategies or PineScript translations.
  - `bot/` & `AlgoTradeX/`: Alternative execution engines and runners (e.g., `backtest_runner.py`).

## Data Flow
1. User uploads a `.csv` file via the UI.
2. The UI sends a `multipart/form-data` request to `POST /run-backtest` or `POST /run-strategy`.
3. The FastAPI backend saves the file to a temporary directory and delegates parsing to `load_candles_from_csv_path()`.
4. Parsed candles are passed to the strategy engine (e.g., `generate_trades_and_setups_with_gap_resets()`).
5. The engine executes the backtest and returns `trades` and `setups`.
6. The backend returns a JSON payload containing `candles`, `setups`, and `trades`.
7. The frontend visualizes the results on a chart.
