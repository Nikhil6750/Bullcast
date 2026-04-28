# Concerns & Technical Debt

**Date:** 2026-04-28
**Focus:** Tech debt, bugs, security, performance, fragile areas.

## Duplicated Codebase Structure
- **AlgoTradeX Directory**: There is an `AlgoTradeX` directory inside the root which duplicates many directories (`backend/`, `frontend/`, `bot/`). This strongly implies either a nested repository, a migration in progress, or uncleaned legacy code. This could lead to confusion over the "source of truth."

## Lack of Frontend Tests
- There are no prominent testing frameworks (like Vitest, Jest, or Cypress) configured in the frontend `package.json`, making the UI prone to regressions.

## File Parsing Security
- The backend parses uploaded CSV files directly into Pandas DataFrames or dictionaries (`data_loader.py`). Without strict size limits and content validation, this endpoint (`/run-backtest`) could be vulnerable to large payload attacks (DoS) or malicious CSV injections.

## Error Handling Depth
- The backend catches general `Exception` objects and returns HTTP 500s (`except Exception as exc: raise HTTPException(500, str(exc)) from exc`). This can leak internal stack details to the client in production and makes debugging harder without a dedicated logging framework (e.g., `logging` module).

## Missing CI/CD
- There are no visible GitHub Actions or CI/CD pipelines configured to run tests automatically on commit.
