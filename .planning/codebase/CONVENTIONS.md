# Coding Conventions

**Date:** 2026-04-28
**Focus:** Code style, naming, patterns, error handling.

## Backend (Python)

### Style & Formatting
- Code relies on standard Python type hints (e.g., `list[dict]`, `str | None`).
- Use of `Final` from `typing` for constants (e.g., `_INVALID_FILENAME_MSG: Final[str]`).
- Internal helper methods are prefixed with an underscore (`_load_uploaded_candles`).

### Error Handling
- Custom exceptions are used to encapsulate business logic errors (e.g., `CandleCSVError`, `StrategyLabError`).
- FastAPI `exception_handler` decorators map internal exceptions and validation errors to standard JSON HTTP responses (`HTTPException`, `RequestValidationError`).
- Try-except blocks commonly catch specific custom exceptions and re-raise them as HTTP 400 or 500.

## Frontend (React/JavaScript)

### Style & Patterns
- Standard functional React components using hooks.
- Uses Vite's strict mode config by default.
- Uses Tailwind CSS utility classes instead of separate CSS files for component styling.

## Repo-Level Conventions
- Docker is preferred for local testing and dependency management, wrapping both the UI and backend into a single `docker-compose up` workflow.
