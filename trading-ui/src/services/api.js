/**
 * Central API service for Bullcast.
 * ALL backend communication goes through here.
 */

const BASE = import.meta.env.VITE_API_URL || "http://localhost:8000"
const REQUEST_TIMEOUT_MS = 25000

async function _request(path, options = {}) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
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

/** Get all available strategies (local fallback - backend route not yet built) */
export const getStrategies = async () => ({
  strategies: {
    sma_cross: {
      name: "SMA Crossover",
      description: "Buy when 10-day MA crosses above 30-day MA. Sell when it crosses below.",
      best_for: "Trending markets",
      difficulty: "Beginner",
      params: { short: 10, long: 30 }
    },
    rsi: {
      name: "RSI Reversal",
      description: "Buy when RSI drops below 30 (oversold) and recovers. Sell when RSI rises above 70.",
      best_for: "Range-bound markets",
      difficulty: "Beginner",
      params: { period: 14, oversold: 30, overbought: 70 }
    },
    macd: {
      name: "MACD Momentum",
      description: "Buy when MACD line crosses above signal line. Sell when it crosses below.",
      best_for: "Momentum markets",
      difficulty: "Intermediate",
      params: { fast: 12, slow: 26, signal: 9 }
    },
    bollinger: {
      name: "Bollinger Bounce",
      description: "Buy when price bounces off lower band. Sell when price touches upper band.",
      best_for: "Mean-reversion markets",
      difficulty: "Intermediate",
      params: { period: 20, std: 2 }
    },
    sentiment_sma: {
      name: "Sentiment + SMA",
      description: "SMA crossover filtered by live news sentiment. Only buys when market mood is positive.",
      best_for: "News-driven markets",
      difficulty: "Advanced",
      params: { short: 10, long: 30, min_sentiment: 60 }
    }
  }
})

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

export const exportTradeDataset = (trades, options = {}) =>
  _request('/api/datasets/trade-export', {
    method: 'POST',
    body: JSON.stringify({
      trades,
      include_edgar: options?.include_edgar ?? false
    })
  })

export const getTrainingReport = () =>
  _request('/api/ml/training-report')

export const getEdgarContext = (ticker) =>
  _request(`/api/edgar/context/${encodeURIComponent(ticker)}`)
