.PHONY: install test build dev-backend dev-frontend ci

install:
	python -m pip install -r requirements.txt
	cd trading-ui && npm ci

test:
	python -m pytest tests -q

build:
	cd trading-ui && npm run build

dev-backend:
	python -m uvicorn backend.server:app --reload --host 0.0.0.0 --port 8000

dev-frontend:
	cd trading-ui && npm run dev

ci: test build
