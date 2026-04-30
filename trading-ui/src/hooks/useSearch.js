import { useState, useEffect, useRef } from "react"
import { searchSymbols } from "../services/api"

/**
 * Debounced symbol search hook.
 * @param {string} query - Search query
 * @returns {{ results, loading, error }}
 */
export function useSearch(query) {
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const timerRef = useRef(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    
    if (!query || query.trim().length < 1) {
      setResults([])
      setLoading(false)
      return
    }

    setLoading(true)
    timerRef.current = setTimeout(async () => {
      try {
        const data = await searchSymbols(query)
        setResults(data.results || data || [])
        setError(null)
      } catch (e) {
        setError(e.message)
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => clearTimeout(timerRef.current)
  }, [query])

  return { results, loading, error }
}
