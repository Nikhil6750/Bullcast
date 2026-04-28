# Integrations

**Date:** 2026-04-28
**Focus:** External APIs, databases, auth providers, webhooks.

## External APIs
- Currently, the system does not appear to heavily rely on real-time external APIs for trading. It processes user-uploaded CSV files (e.g., historical candle data) directly through the backend endpoints.
- No third-party OAuth or authentication providers are configured.

## Databases & Storage
- **File System / CSV**: The primary mechanism for data ingestion is CSV uploads. `backend/data_loader.py` handles parsing of uploaded CSVs containing market data.
- **RAG DB**: There is a `rag_db` directory present in the root, suggesting possible retrieval-augmented generation or vector database storage, though not explicitly wired into the primary backtesting flow shown in the backend server.
- **Local Output**: Results and metrics are written directly to the file system (e.g., `output/trades.csv`, `output/metrics.json`).

## Internal Communication
- The frontend (`trading-ui`) communicates with the backend (`backend`) over HTTP REST using Axios.
- Docker Compose sets up a `trading-net` bridge network for the frontend and backend to communicate.
