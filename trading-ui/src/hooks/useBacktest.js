import { useState } from "react"
import { runBacktest } from "../services/api"
import { STORAGE_KEYS, appendStorageItem } from "../services/storage"

/**
 * Backtest runner hook.
 * @returns {{ result, loading, error, execute }}
 */
export function useBacktest() {
  const [result,  setResult]  = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  const execute = async (params) => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const data = await runBacktest(params)
      setResult(data)
      appendStorageItem(STORAGE_KEYS.backtestResults, {
        timestamp: new Date().toISOString(),
        request: params,
        metrics: data?.metrics || {},
        trade_count: Array.isArray(data?.trades) ? data.trades.length : 0,
        result: data,
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return { result, loading, error, execute }
}
