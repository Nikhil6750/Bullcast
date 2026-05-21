/**
 * Central API service for Bullcast.
 * ALL backend communication goes through here.
 */

export const API_BASE_URL = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/+$/, "")
const REQUEST_TIMEOUT_MS = 25000

async function _request(path, options = {}) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      signal: controller.signal
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || err.error || `Request failed: ${res.status}`)
    }
    return res.json()
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Backend request timed out. Check that Bullcast backend is running and responsive.")
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
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

/** Get news and sentiment for a stock */
export const getNews = (stock) =>
  _request("/api/news", {
    method: "POST",
    body: JSON.stringify({ stock })
  })

/** Get watchlist sentiment for all 20 stocks */
export const getWatchlist = () =>
  _request("/api/watchlist")

/** Ticker tape live prices */
export const getTickerData = () => _request('/api/ticker')

/** Market overview - categorized live prices */
export const getMarketOverview = () => _request('/api/market-overview')

// Trade Intelligence Engine
export const analyzeJournal = (trades) =>
  _request('/api/intelligence/analyze', {
    method: 'POST',
    body: JSON.stringify({ trades })
  })

export const askIntelligence = (trades, question) =>
  _request('/api/intelligence/ask', {
    method: 'POST',
    body: JSON.stringify({ trades, question })
  })

export const summarizeJournalMistakes = (trades, limit = 100) =>
  _request('/api/intelligence/mistake-summary', {
    method: 'POST',
    body: JSON.stringify({ trades, limit })
  })

export const getJournalInsights = (authToken) =>
  _request('/api/intelligence/copilot', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`
    }
  })

export const analyzeFutureTrade = (trades, trade) =>
  _request('/api/intelligence/trade-analysis', {
    method: 'POST',
    body: JSON.stringify({ trades, trade })
  })

export const exportTradeDataset = (trades, options = {}) =>
  _request('/api/datasets/trade-export', {
    method: 'POST',
    body: JSON.stringify({
      trades,
      include_edgar: options?.include_edgar ?? false
    })
  })

export const parseJournalTrades = ({ text, timezone, default_date, authToken }) =>
  _request('/api/journal/parse-trades', {
    method: 'POST',
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
    body: JSON.stringify({ text, timezone, default_date })
  })

export async function importTradesFromFile(file, authToken) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const formData = new FormData()
  formData.append("file", file)

  try {
    const res = await fetch(`${API_BASE_URL}/api/journal/import-file`, {
      method: "POST",
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      body: formData,
      signal: controller.signal
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || err.error || `Request failed: ${res.status}`)
    }
    return res.json()
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Backend request timed out. Check that Bullcast backend is running and responsive.")
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
}

export const getEdgarContext = (ticker) =>
  _request(`/api/edgar/context/${encodeURIComponent(ticker)}`)

export const runBacktest = (pair, date) => {
  const params = new URLSearchParams({ pair })
  if (date) params.set("date", date)
  return _request(`/api/backtest/run?${params.toString()}`)
}

export const getAlertsLog = () =>
  _request('/api/alerts-log')

export const getLiveScan = (pair) =>
  _request(`/api/live-scan?pair=${encodeURIComponent(pair)}`)

export const runMultiBacktest = (pairs, date) =>
  _request('/api/backtest/run-multi', {
    method: 'POST',
    body: JSON.stringify({ pairs, date })
  })

export const getBacktestPairs = () =>
  _request('/api/backtest/pairs')

export const getBacktestCandles = (pair) =>
  _request(`/api/backtest/candles?pair=${encodeURIComponent(pair)}`)

export async function runBacktestFromCSV(pair, date, file) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const formData = new FormData()
  formData.append("pair", pair)
  formData.append("date", date)
  formData.append("file", file)

  try {
    const res = await fetch(`${API_BASE_URL}/api/backtest/run-from-csv`, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || err.error || `Request failed: ${res.status}`)
    }
    return res.json()
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Request timed out.")
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
}
