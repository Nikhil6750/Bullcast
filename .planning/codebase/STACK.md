# Codebase Stack

**Date:** 2026-04-28
**Focus:** Technology stack, languages, frameworks, and dependencies.

## Overview
This is a web-based trading bot and backtesting application with a Python backend and a React/Vite frontend.

## Languages
- **Python**: Primary language for the backend, strategy execution, and backtesting.
- **JavaScript (ES Modules)**: Primary language for the frontend UI.
- **HTML/CSS**: Styling managed via TailwindCSS.

## Frameworks & Runtimes
- **Backend Runtime**: Python (version unspecified, likely 3.10+ based on syntax)
- **Frontend Runtime**: Node.js / Browser
- **Backend Framework**: [FastAPI](https://fastapi.tiangolo.com/) with Uvicorn server.
- **Frontend Framework**: [React 18](https://react.dev/) via [Vite](https://vitejs.dev/).

## Key Dependencies

### Backend (`backend/requirements.txt`)
- `fastapi` & `uvicorn`: API server and routing.
- `pydantic`: Data validation.
- `python-multipart`: File upload handling.
- `numpy`, `pandas`: Data processing for trading strategies and backtesting.
- `pytest`: Testing framework.

### Frontend (`trading-ui/package.json`)
- `react`, `react-dom`, `react-router-dom`: UI rendering and routing.
- `tailwindcss`, `autoprefixer`, `postcss`: Styling.
- `axios`: HTTP client for backend communication.
- `lightweight-charts`, `recharts`: Data visualization and chart rendering.
- `lucide-react`: Icons.
- `react-markdown`, `remark-gfm`: Markdown rendering.

## Configuration & Tooling
- **Docker**: `docker-compose.yml` provides a containerized setup for both backend and frontend.
- **Vite**: Frontend build tool (`vite.config.js`).
- **ESLint**: Frontend linting (`eslint.config.js`).
- **Environment Variables**: `.env` used for configuration (e.g., `DATA_DIR`, `OUTPUT_DIR`).
