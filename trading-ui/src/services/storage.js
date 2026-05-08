export const STORAGE_KEYS = {
  journal: "bullcast_journal_v1",
  traderProfile: "bullcast_trader_profile_v1",
  analysisHistory: "bullcast_analysis_history_v1",
  backtestResults: "bullcast_backtest_results_v1",
}

export function readStorage(key, fallback) {
  if (typeof window === "undefined" || !window.localStorage) return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function writeStorage(key, value) {
  if (typeof window === "undefined" || !window.localStorage) return false
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function appendStorageItem(key, item, limit = 25) {
  const current = readStorage(key, [])
  const list = Array.isArray(current) ? current : []
  const next = [item, ...list].slice(0, limit)
  writeStorage(key, next)
  return next
}
