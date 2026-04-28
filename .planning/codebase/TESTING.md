# Testing

**Date:** 2026-04-28
**Focus:** Framework, structure, mocking, coverage.

## Framework
- **Backend**: Uses `pytest`. (Noted by `pytest` in `requirements.txt` and `.pytest_cache`).
- **Frontend**: Standard Vitest or Jest setup does not appear explicitly in `package.json` dependencies, suggesting backend testing is currently prioritized.

## Structure
- Tests reside in the top-level `/tests` directory.
- `AlgoTradeX/tests` and other specific test files (e.g., `AlgoTradeX/test_pd.py`, `AlgoTradeX/test_sentiment.py`) indicate testing of data manipulation and specific business logic.
- `backend/test_engine.py` suggests testing strategy engine logic locally.

## Practices
- Currently, tests appear to focus on unit testing core logic (pandas data frames, CSV parsing, strategy engines) rather than end-to-end testing.
- Manual integration testing is supported by `backtest_runner.py` which runs a full pipeline against a CSV file and dumps output to `/output`.
