from __future__ import annotations

from typing import Any

from backend.market_data import fetch_quote
from backend.sentiment_api import fetch_sentiment_for_stock


STOCK_KEYWORDS = ("stock", "share", "equity", "company")
FOREX_KEYWORDS = ("forex", "currency", "pair")
EQUITY_TICKERS = {
    "RELIANCE", "TATASTEEL", "INFY", "TCS", "HDFCBANK",
    "ICICIBANK", "SBIN", "WIPRO", "BAJFINANCE", "AXISBANK",
    "KOTAKBANK", "HINDUNILVR", "TATAMOTORS", "MARUTI",
    "SUNPHARMA", "ONGC", "NTPC", "POWERGRID", "ULTRACEMCO",
    "TITAN", "ADANIENT",
}


def normalize_symbol(symbol: str) -> str:
    return str(symbol or "").strip().upper()


def infer_asset_type(symbol: str) -> str:
    raw = normalize_symbol(symbol)
    base = raw.split(".", 1)[0]
    if raw.endswith((".NS", ".BO")) or base in EQUITY_TICKERS:
        return "stock"
    if "." not in raw and len(raw) == 6 and raw.isalpha() and raw == raw.upper():
        return "forex"
    return "unknown"


def filter_symbols_by_question(question: str, by_symbol: list[dict]) -> list[dict]:
    question_lower = str(question or "").lower()
    if any(word in question_lower for word in STOCK_KEYWORDS):
        return [
            row for row in by_symbol
            if infer_asset_type(row.get("symbol")) == "stock"
        ]
    if any(word in question_lower for word in FOREX_KEYWORDS):
        return [
            row for row in by_symbol
            if infer_asset_type(row.get("symbol")) == "forex"
        ]
    return by_symbol


def get_market_context_for_trade(trade: dict) -> dict:
    symbol = normalize_symbol(trade.get("symbol", ""))
    asset_type = infer_asset_type(symbol)
    context = _empty_context(symbol=symbol, asset_type=asset_type)
    errors = []

    if asset_type == "stock":
        try:
            sentiment = fetch_sentiment_for_stock(symbol)
            context["sentiment_available"] = True
            context["sentiment_label"] = sentiment.get("sentiment")
            context["sentiment_score"] = sentiment.get("score")
        except Exception as exc:
            errors.append(f"sentiment unavailable: {exc}")

    try:
        quote = _fetch_quote_for_context(symbol=symbol, asset_type=asset_type)
        if quote:
            context["market_available"] = True
            context["last_price"] = _to_float(
                quote.get("current_price") or quote.get("price")
            )
            context["price_change_pct"] = _to_float(quote.get("change_pct"))
            context["volatility_proxy"] = _volatility_proxy(quote)
    except Exception as exc:
        errors.append(f"market unavailable: {exc}")

    context["error"] = "; ".join(errors) if errors else None
    return context


def build_trade_context(trades: list[dict]) -> dict:
    symbol_cache: dict[str, dict] = {}
    trade_contexts = []

    for trade in trades or []:
        symbol = normalize_symbol(trade.get("symbol", ""))
        if symbol not in symbol_cache:
            symbol_cache[symbol] = get_market_context_for_trade(trade)
        trade_contexts.append(dict(symbol_cache[symbol]))

    return {
        "trades": trade_contexts,
        "by_symbol": symbol_cache,
        "summary": _context_summary(trade_contexts),
    }


def _empty_context(symbol: str, asset_type: str) -> dict:
    return {
        "symbol": symbol,
        "asset_type": asset_type,
        "sentiment_available": False,
        "sentiment_label": None,
        "sentiment_score": None,
        "market_available": False,
        "last_price": None,
        "price_change_pct": None,
        "volatility_proxy": None,
        "error": None,
    }


def _fetch_quote_for_context(symbol: str, asset_type: str) -> dict | None:
    for candidate in _quote_candidates(symbol, asset_type):
        try:
            return fetch_quote(candidate)
        except Exception:
            continue
    return None


def _quote_candidates(symbol: str, asset_type: str) -> list[str]:
    candidates = [symbol]
    if asset_type == "stock" and "." not in symbol:
        candidates.extend([f"{symbol}.NS", f"{symbol}.BO"])
    if asset_type == "forex" and not symbol.endswith("=X"):
        candidates.append(f"{symbol}=X")
    return list(dict.fromkeys(candidates))


def _volatility_proxy(quote: dict[str, Any]) -> float | None:
    high = _to_float(quote.get("high"))
    low = _to_float(quote.get("low"))
    price = _to_float(quote.get("current_price") or quote.get("price"))
    if high is None or low is None or not price:
        return None
    return round(abs(high - low) / price * 100, 2)


def _to_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _context_summary(contexts: list[dict]) -> dict:
    total = len(contexts)
    asset_mix = {"stock": 0, "forex": 0, "unknown": 0}

    sentiment_count = 0
    market_count = 0
    context_count = 0

    for item in contexts:
        asset_type = item.get("asset_type")
        if asset_type not in asset_mix:
            asset_type = "unknown"
        asset_mix[asset_type] += 1

        has_sentiment = bool(item.get("sentiment_available"))
        has_market = bool(item.get("market_available"))
        sentiment_count += 1 if has_sentiment else 0
        market_count += 1 if has_market else 0
        context_count += 1 if has_sentiment or has_market else 0

    return {
        "trades_with_context": context_count,
        "sentiment_coverage": _coverage(sentiment_count, total),
        "market_coverage": _coverage(market_count, total),
        "asset_mix": asset_mix,
    }


def _coverage(count: int, total: int) -> float:
    if total <= 0:
        return 0
    return round(count / total * 100, 1)
