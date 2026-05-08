import { createClient } from '@supabase/supabase-js'
import { STORAGE_KEYS, appendStorageItem, readStorage, writeStorage } from './storage'

export const STORAGE_MODES = {
  local: 'local',
  supabase: 'supabase',
}

const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim()
const supabaseAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

let supabaseClient = null
let lastStorageDiagnostic = null

export function isSupabasePersistenceConfigured() {
  return Boolean(supabaseUrl && supabaseAnonKey)
}

export function getInitialStorageMode() {
  return isSupabasePersistenceConfigured() ? STORAGE_MODES.supabase : STORAGE_MODES.local
}

export function formatStorageMode(mode) {
  return mode === STORAGE_MODES.supabase ? 'Supabase' : 'Local'
}

function baseDiagnostic() {
  return {
    supabaseConfigured: isSupabasePersistenceConfigured(),
    hasUrl: Boolean(supabaseUrl),
    hasAnonKey: Boolean(supabaseAnonKey),
  }
}

export function getSupabasePersistenceDiagnostic() {
  return {
    ...baseDiagnostic(),
    lastSaveTarget: lastStorageDiagnostic?.lastSaveTarget ?? null,
    lastSaveErrorMessage: null,
    lastLoadTarget: lastStorageDiagnostic?.lastLoadTarget ?? null,
    loadedRowCount: lastStorageDiagnostic?.loadedRowCount ?? 0,
    ...lastStorageDiagnostic,
  }
}

export function getSupabasePersistenceDebugInfo() {
  return getSupabasePersistenceDiagnostic()
}

export function getInitialStorageStatus(overrides = {}) {
  return {
    ...baseDiagnostic(),
    mode: getInitialStorageMode(),
    lastSaveTarget: null,
    lastSaveErrorMessage: null,
    lastLoadTarget: null,
    loadedRowCount: 0,
    action: 'initial',
    rowsAttempted: 0,
    rowsSaved: 0,
    ...overrides,
  }
}

function getSupabaseClient() {
  if (!isSupabasePersistenceConfigured()) return null
  if (!supabaseClient) {
    supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }
  return supabaseClient
}

function safeErrorMessage(error) {
  if (!error) return null
  const parts = [
    error.message,
    error.details,
    error.hint,
    error.code ? `code: ${error.code}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : String(error)
}

function logPersistenceStatus(status) {
  if (typeof console === 'undefined') return
  const payload = {
    supabaseConfigured: status.supabaseConfigured,
    lastSaveTarget: status.lastSaveTarget,
    lastSaveErrorMessage: status.lastSaveErrorMessage,
    lastLoadTarget: status.lastLoadTarget,
    loadedRowCount: status.loadedRowCount,
    action: status.action,
    rowsAttempted: status.rowsAttempted,
    rowsSaved: status.rowsSaved,
  }
  if (status.lastSaveErrorMessage) {
    console.warn('Bullcast persistence status', payload)
  } else {
    console.info('Bullcast persistence status', payload)
  }
}

function createStorageResult({
  mode,
  ok = true,
  error = null,
  action,
  rowsAttempted = 0,
  rowsSaved = 0,
  loadedRowCount = null,
  history = null,
  trades = null,
}) {
  const errorMessage = safeErrorMessage(error)
  const isLoad = String(action || '').startsWith('load')
  const isSave = /save|delete|clear/.test(String(action || ''))
  const isClear = String(action || '').startsWith('clear')
  const status = {
    ...baseDiagnostic(),
    mode,
    ok,
    error,
    errorMessage,
    lastSaveTarget: isSave ? mode : lastStorageDiagnostic?.lastSaveTarget ?? null,
    lastSaveErrorMessage: isSave ? errorMessage : lastStorageDiagnostic?.lastSaveErrorMessage ?? null,
    lastLoadTarget: isLoad ? mode : lastStorageDiagnostic?.lastLoadTarget ?? null,
    loadedRowCount: isLoad || isClear ? loadedRowCount ?? trades?.length ?? rowsSaved : lastStorageDiagnostic?.loadedRowCount ?? 0,
    action,
    rowsAttempted,
    rowsSaved,
  }
  lastStorageDiagnostic = {
    lastSaveTarget: status.lastSaveTarget,
    lastSaveErrorMessage: status.lastSaveErrorMessage,
    lastLoadTarget: status.lastLoadTarget,
    loadedRowCount: status.loadedRowCount,
  }
  logPersistenceStatus(status)
  return {
    ...status,
    history,
    trades,
  }
}

function stableUuid(seed) {
  const text = String(seed || 'bullcast-trade')
  const bases = [2166136261, 2166136261 ^ 0x9e3779b9, 2166136261 ^ 0x85ebca6b, 2166136261 ^ 0xc2b2ae35]
  const hashes = bases.map((base, offset) => {
    let hash = base >>> 0
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i) + offset
      hash = Math.imul(hash, 16777619) >>> 0
    }
    return hash.toString(16).padStart(8, '0')
  })
  const raw = hashes.join('').slice(0, 32).padEnd(32, '0')
  const versioned = `${raw.slice(0, 12)}5${raw.slice(13, 16)}${((parseInt(raw[16], 16) & 0x3) | 0x8).toString(16)}${raw.slice(17)}`
  return `${versioned.slice(0, 8)}-${versioned.slice(8, 12)}-${versioned.slice(12, 16)}-${versioned.slice(16, 20)}-${versioned.slice(20, 32)}`
}

export function createJournalTradeId(seed = '') {
  const text = String(seed || '').trim()
  if (text && uuidPattern.test(text)) return text.toLowerCase()
  if (text) return stableUuid(text)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return stableUuid(`${Date.now()}-${Math.random()}`)
}

function safeArray(value) {
  return Array.isArray(value) ? value : []
}

function readLocalJournalTrades() {
  return safeArray(readStorage(STORAGE_KEYS.journal, []))
}

export function clearLocalJournalStorage() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return createStorageResult({
      mode: STORAGE_MODES.local,
      ok: false,
      error: new Error('localStorage is not available.'),
      action: 'clear local journal',
    })
  }

  try {
    window.localStorage.removeItem(STORAGE_KEYS.journal)
    window.localStorage.removeItem(STORAGE_KEYS.traderProfile)
    window.localStorage.removeItem(STORAGE_KEYS.analysisHistory)
    return createStorageResult({
      mode: STORAGE_MODES.local,
      action: 'clear local journal',
      rowsAttempted: 1,
      rowsSaved: 1,
      loadedRowCount: 0,
      trades: [],
    })
  } catch (error) {
    return createStorageResult({
      mode: STORAGE_MODES.local,
      ok: false,
      error,
      action: 'clear local journal',
    })
  }
}

function optionalNumber(value) {
  if (value === '' || value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function optionalInteger(value) {
  const n = optionalNumber(value)
  return Number.isInteger(n) ? n : null
}

function normalizeSide(value) {
  return String(value || 'LONG').trim().toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG'
}

function normalizeBoolean(value) {
  if (value === true || value === false) return value
  const normalized = String(value ?? '').trim().toLowerCase()
  if (['true', 'yes', 'y', '1'].includes(normalized)) return true
  if (['false', 'no', 'n', '0'].includes(normalized)) return false
  return false
}

function journalTradeSeed(trade) {
  return [
    trade?.date,
    trade?.symbol,
    trade?.type ?? trade?.side,
    trade?.entry_price ?? trade?.entry,
    trade?.exit_price ?? trade?.exit,
    trade?.quantity,
  ].filter((value) => value !== null && value !== undefined && value !== '').join('|')
}

function journalTradeId(trade) {
  const existingId = String(trade?.id || '').trim()
  return createJournalTradeId(existingId || journalTradeSeed(trade))
}

function toJournalTradeRow(trade) {
  const side = normalizeSide(trade?.type ?? trade?.side)
  const setupTag = String(trade?.setup_tag ?? trade?.setupTag ?? '').trim()
  const mistakeTag = String(trade?.mistake_tag ?? trade?.mistakeTag ?? '').trim()
  const confidenceScore = optionalInteger(trade?.confidence_score ?? trade?.confidenceScore ?? trade?.confidence)

  return {
    id: journalTradeId(trade),
    user_id: trade?.user_id ?? null,
    date: String(trade?.date || new Date().toISOString().slice(0, 10)),
    symbol: String(trade?.symbol || '').trim().toUpperCase(),
    side,
    entry: optionalNumber(trade?.entry_price ?? trade?.entryPrice ?? trade?.entry),
    exit: optionalNumber(trade?.exit_price ?? trade?.exitPrice ?? trade?.exit),
    quantity: optionalNumber(trade?.quantity ?? trade?.qty),
    setup: String((trade?.setup ?? trade?.setupName ?? setupTag) || '').trim(),
    setup_tag: setupTag,
    confidence: optionalInteger(trade?.confidence ?? confidenceScore),
    confidence_score: confidenceScore,
    mistake: String((trade?.mistake ?? mistakeTag) || '').trim(),
    mistake_tag: mistakeTag || 'none',
    notes: String(trade?.notes ?? trade?.note ?? ''),
    data_origin: String(trade?.data_origin ?? trade?.source_type ?? trade?.sourceType ?? '').trim(),
    is_synthetic: normalizeBoolean(trade?.is_synthetic ?? trade?.synthetic_flag ?? trade?.syntheticFlag),
  }
}

function fromJournalTradeRow(row) {
  return {
    id: String(row?.id || ''),
    user_id: row?.user_id ?? null,
    date: String(row?.date || new Date().toISOString().slice(0, 10)),
    symbol: String(row?.symbol || '').trim().toUpperCase(),
    type: normalizeSide(row?.side),
    side: normalizeSide(row?.side),
    entry_price: optionalNumber(row?.entry),
    entry: optionalNumber(row?.entry),
    exit_price: optionalNumber(row?.exit),
    exit: optionalNumber(row?.exit),
    quantity: optionalNumber(row?.quantity),
    notes: String(row?.notes || ''),
    setup: String(row?.setup || ''),
    setup_tag: String(row?.setup_tag || row?.setup || ''),
    confidence: optionalInteger(row?.confidence),
    confidence_score: optionalInteger(row?.confidence_score ?? row?.confidence),
    mistake: String(row?.mistake || ''),
    mistake_tag: String(row?.mistake_tag || row?.mistake || 'none'),
    source_type: String(row?.data_origin || ''),
    data_origin: String(row?.data_origin || ''),
    synthetic_flag: row?.is_synthetic === true,
    is_synthetic: row?.is_synthetic === true,
    created_at: row?.created_at,
  }
}

export async function loadJournalTradesFromStorage() {
  const client = getSupabaseClient()
  if (!client) {
    const localTrades = readLocalJournalTrades()
    return createStorageResult({
      mode: STORAGE_MODES.local,
      action: 'load journal_trades',
      loadedRowCount: localTrades.length,
      trades: localTrades,
    })
  }

  try {
    const { data, error } = await client
      .from('journal_trades')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error

    const trades = safeArray(data).map(fromJournalTradeRow)
    return createStorageResult({
      mode: STORAGE_MODES.supabase,
      action: 'load journal_trades',
      loadedRowCount: trades.length,
      trades,
    })
  } catch (error) {
    const localTrades = readLocalJournalTrades()
    return createStorageResult({
      mode: STORAGE_MODES.local,
      error,
      action: 'load journal_trades fallback',
      loadedRowCount: localTrades.length,
      trades: localTrades,
    })
  }
}

export async function saveJournalTradesToStorage(trades, options = {}) {
  const safeTrades = safeArray(trades)
  const client = getSupabaseClient()
  if (!client) {
    const localSaved = writeStorage(STORAGE_KEYS.journal, safeTrades)
    return createStorageResult({
      mode: STORAGE_MODES.local,
      ok: localSaved,
      action: 'save journal_trades',
      rowsAttempted: safeTrades.length,
      rowsSaved: localSaved ? safeTrades.length : 0,
    })
  }

  try {
    const rows = safeTrades.map(toJournalTradeRow)
    if (rows.length > 0) {
      const { error } = await client
        .from('journal_trades')
        .upsert(rows, { onConflict: 'id' })
      if (error) throw error
    }

    return createStorageResult({
      mode: STORAGE_MODES.supabase,
      action: 'save journal_trades',
      rowsAttempted: rows.length,
      rowsSaved: rows.length,
    })
  } catch (error) {
    const localSaved = options.fallbackToLocal === false
      ? false
      : writeStorage(STORAGE_KEYS.journal, safeTrades)
    return createStorageResult({
      mode: STORAGE_MODES.local,
      ok: localSaved,
      error,
      action: 'save journal_trades fallback',
      rowsAttempted: safeTrades.length,
      rowsSaved: localSaved ? safeTrades.length : 0,
    })
  }
}

export async function clearSupabaseJournalTrades() {
  const client = getSupabaseClient()
  if (!client) {
    return createStorageResult({
      mode: STORAGE_MODES.local,
      ok: false,
      error: new Error('Supabase is not configured.'),
      action: 'clear journal_trades fallback',
    })
  }

  try {
    const { count, error } = await client
      .from('journal_trades')
      .delete({ count: 'exact' })
      .neq('id', '00000000-0000-0000-0000-000000000000')
    if (error) throw error

    return createStorageResult({
      mode: STORAGE_MODES.supabase,
      action: 'clear journal_trades',
      rowsAttempted: count ?? 0,
      rowsSaved: count ?? 0,
      loadedRowCount: 0,
      trades: [],
    })
  } catch (error) {
    return createStorageResult({
      mode: STORAGE_MODES.local,
      ok: false,
      error,
      action: 'clear journal_trades fallback',
    })
  }
}

export async function deleteJournalTradeFromStorage(id) {
  const client = getSupabaseClient()
  if (!client) {
    return createStorageResult({
      mode: STORAGE_MODES.local,
      action: 'delete journal_trade',
      rowsAttempted: 1,
      rowsSaved: 1,
    })
  }

  try {
    const { error } = await client
      .from('journal_trades')
      .delete()
      .eq('id', createJournalTradeId(id))
    if (error) throw error
    return createStorageResult({
      mode: STORAGE_MODES.supabase,
      action: 'delete journal_trade',
      rowsAttempted: 1,
      rowsSaved: 1,
    })
  } catch (error) {
    return createStorageResult({
      mode: STORAGE_MODES.local,
      ok: false,
      error,
      action: 'delete journal_trade fallback',
      rowsAttempted: 1,
    })
  }
}

export async function saveTraderProfileToStorage(profile) {
  const localSaved = writeStorage(STORAGE_KEYS.traderProfile, profile)
  const client = getSupabaseClient()
  if (!client || !profile) {
    return createStorageResult({
      mode: STORAGE_MODES.local,
      ok: localSaved,
      action: 'save trader_profile',
      rowsAttempted: profile ? 1 : 0,
      rowsSaved: localSaved && profile ? 1 : 0,
    })
  }

  try {
    const { error } = await client
      .from('trader_profiles')
      .insert({ user_id: null, profile })
    if (error) throw error
    return createStorageResult({
      mode: STORAGE_MODES.supabase,
      action: 'save trader_profile',
      rowsAttempted: 1,
      rowsSaved: 1,
    })
  } catch (error) {
    return createStorageResult({
      mode: STORAGE_MODES.local,
      ok: localSaved,
      error,
      action: 'save trader_profile fallback',
      rowsAttempted: 1,
      rowsSaved: localSaved ? 1 : 0,
    })
  }
}

export async function appendAnalysisHistoryToStorage(entry, limit = 25) {
  const localHistory = appendStorageItem(STORAGE_KEYS.analysisHistory, entry, limit)
  const client = getSupabaseClient()
  if (!client) {
    return createStorageResult({
      mode: STORAGE_MODES.local,
      action: 'save analysis_history',
      rowsAttempted: 1,
      rowsSaved: 1,
      history: localHistory,
    })
  }

  try {
    const prompt = String(entry?.question || entry?.type || 'journal_analysis')
    const { error } = await client
      .from('analysis_history')
      .insert({ user_id: null, prompt, response: entry })
    if (error) throw error
    return createStorageResult({
      mode: STORAGE_MODES.supabase,
      action: 'save analysis_history',
      rowsAttempted: 1,
      rowsSaved: 1,
      history: localHistory,
    })
  } catch (error) {
    return createStorageResult({
      mode: STORAGE_MODES.local,
      error,
      action: 'save analysis_history fallback',
      rowsAttempted: 1,
      rowsSaved: 1,
      history: localHistory,
    })
  }
}
