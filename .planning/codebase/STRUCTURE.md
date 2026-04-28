# Codebase Structure

**Date:** 2026-04-28
**Focus:** Directory layout, key locations, naming conventions.

## Directory Layout

### `/` (Root)
- `docker-compose.yml`: Container orchestration.
- `README.md`: High-level documentation and quick start.
- `backtest_runner.py`: CLI script for running backtests locally.

### `/backend`
Core Python API server and backtest engine.
- `server.py`: FastAPI application and HTTP route definitions.
- `data_loader.py`: CSV parsing and data ingestion.
- `gap_handling.py`: Core locked trading strategy engine.
- `strategy_lab.py`: Flexible strategy execution module.
- `requirements.txt`: Python dependencies for the backend.

### `/trading-ui`
Frontend React application.
- `package.json`, `vite.config.js`: Node.js and Vite configuration.
- `tailwind.config.js`, `postcss.config.js`: Styling configuration.
- `/src`: React components, views, and state management.
- `/public`: Static assets.

### `/bot`
Alternative or legacy trading bot implementation.
- `strategy_engine.py`, `locked_strategy.py`, `backtest.py`: Additional strategy components.

### `/AlgoTradeX`
Appears to be another instance or iteration of the trading system, containing its own `backend`, `frontend`, and `bot` directories. This may be a transitionary folder or a submodule.

### `/data`, `/output`, `/tests`
- `/data`: Default directory for storing CSV inputs.
- `/output`: Default directory for backtest outputs (`trades.csv`, `metrics.json`).
- `/tests`: Python test suite.

## Naming Conventions
- **Python**: `snake_case` for variables, functions, and files (`data_loader.py`). `PascalCase` for classes and Exceptions (`StrategyLabError`).
- **JavaScript/React**: `kebab-case` for configuration files. `PascalCase` likely used for React components. `camelCase` for variables and functions.
