/**
 * Central API service for Bullcast.
 * ALL backend communication goes through here.
 */

const BASE = import.meta.env.VITE_API_URL || "http://localhost:8000"

async function _request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || err.error || `Request failed: ${res.status}`)
  }
  return res.json()
}

/** Search symbols by query string */
export const searchSymbols = (q, limit = 8) =>
  _request(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`)

/** Get current price and info for a symbol */
export const getQuote = (symbol) =>
  _request(`/api/quote?symbol=${encodeURIComponent(symbol)}`)

/** Get historical OHLCV data */
export const getHistory = (symbol, period = "1y", interval = "1d") =>
  _request(`/api/history?symbol=${encodeURIComponent(symbol)}&period=${period}&interval=${interval}`)

/** Get all available symbols, optionally by type */
export const getAssets = (type = "all") =>
  _request(`/api/assets${type !== 'all' ? `?type=${type}` : ''}`)

/** Get sentiment for a stock */
export const getSentiment = (stock) =>
  _request("/api/sentiment", {
    method: "POST",
    body: JSON.stringify({ stock })
  })

/** Get watchlist sentiment for all 20 stocks */
export const getWatchlist = () =>
  _request("/api/watchlist")

/** Run a backtest */
export const runBacktest = (params) =>
  _request("/api/backtest", {
    method: "POST",
    body: JSON.stringify(params)
  })

/** Get all available strategies */
export const getStrategies = () =>
  _request("/api/strategies")
