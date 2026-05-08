# Base image
FROM python:3.10-slim

# Set working directory
WORKDIR /app

# Copy backend requirements
COPY backend/requirements.txt ./requirements.txt

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend + core backtest code
COPY backend/ ./backend
COPY bot/ ./bot

# Expose port (FastAPI default)
EXPOSE 8000

# Run FastAPI via uvicorn on the hosting platform's assigned port.
CMD ["sh", "-c", "python -m uvicorn backend.server:app --host 0.0.0.0 --port ${PORT:-8000}"]
