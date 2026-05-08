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

export function isSupabasePersistenceConfigured() {
  return Boolean(supabaseUrl && supabaseAnonKey)
}

export function getInitialStorageMode() {
  return isSupabasePersistenceConfigured() ? STORAGE_MODES.supabase : STORAGE_MODES.local
}

export function formatStorageMode(mode) {
  return mode === STORAGE_MODES.supabase ? 'Supabase' : 'Local'
}

export function getSupabasePersistenceDebugInfo() {
  return {
    supabaseConfigured: isSupabasePersistenceConfigured(),
    hasSupabaseUrl: Boolean(supabaseUrl),
    hasSupabaseAnonKey: Boolean(supabaseAnonKey),
  }
}

export function getInitialStorageStatus() {
  const mode = getInitialStorageMode()
  return {
    ...getSupabasePersistenceDebugInfo(),
    mode,
    lastSaveTarget: formatStorageMode(mode),
    lastSaveErrorMessage: null,
    action: 'initial',
    rowsAttempted: 0,
    rowsSaved: 0,
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

function createStorageResult({ mode, ok = true, error = null, action, rowsAttempted = 0, rowsSaved = 0, history = null, trades = null }) {
  const status = {
    ...getSupabasePersistenceDebugInfo(),
    mode,
    ok,
    error,
    errorMessage: safeErrorMessage(error),
    lastSaveTarget: formatStorageMode(mode),
    lastSaveErrorMessage: safeErrorMessage(error),
    action,
    rowsAttempted,
    rowsSaved,
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
  const localTrades = safeArray(readStorage(STORAGE_KEYS.journal, []))
  const client = getSupabaseClient()
  if (!client) {
    return createStorageResult({
      mode: STORAGE_MODES.local,
      action: 'load journal_trades',
      rowsSaved: localTrades.length,
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
    writeStorage(STORAGE_KEYS.journal, trades)
    return createStorageResult({
      mode: STORAGE_MODES.supabase,
      action: 'load journal_trades',
      rowsSaved: trades.length,
      trades,
    })
  } catch (error) {
    return createStorageResult({
      mode: STORAGE_MODES.local,
      error,
      action: 'load journal_trades fallback',
      rowsSaved: localTrades.length,
      trades: localTrades,
    })
  }
}

export async function saveJournalTradesToStorage(trades) {
  const safeTrades = safeArray(trades)
  const localSaved = writeStorage(STORAGE_KEYS.journal, safeTrades)
  const client = getSupabaseClient()
  if (!client) {
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
