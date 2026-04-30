import { useState, useEffect } from "react"
import { getSentiment } from "../services/api"

/**
 * Sentiment fetcher hook.
 * Only fetches when stock is non-null.
 * @param {string|null} stock
 */
export function useSentiment(stock) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    if (!stock) return
    setLoading(true)
    setError(null)
    setData(null)
    
    getSentiment(stock)
      .then(d  => setData(d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [stock])

  return { data, loading, error }
}
