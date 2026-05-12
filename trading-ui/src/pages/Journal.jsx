import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { exportTradeDataset, importTradesFromFile, parseJournalTrades } from "../services/api";
import StorageStatus from "../components/StorageStatus";
import { STORAGE_KEYS, readStorage } from "../services/storage";
import { DEMO_ENTRY_KEY } from "../services/entryState";
import {
  LAST_SAVED_TRADE_ID_KEY,
  authenticatedModePrefersSupabase,
  findTradeIndexById,
  getTradePageForId,
  reconcileVerifiedRowAfterReload,
  tradeDateSortValue,
} from "../services/journalPersistenceGuards";
import {
  clearLocalJournalStorage,
  clearSupabaseJournalTrades,
  createJournalTradeId,
  deleteJournalTradeFromStorage,
  formatStorageMode,
  getCurrentSupabaseSession,
  getInitialStorageMode,
  getInitialStorageStatus,
  getSupabasePersistenceDiagnostic,
  isSupabasePersistenceConfigured,
  loadJournalTradeByIdFromSupabase,
  loadJournalTradesFromStorage,
  saveJournalTradeToStorage,
  onSupabaseAuthStateChange,
  saveJournalTradesToStorage,
} from "../services/supabaseStorage";

const STORAGE_KEY = STORAGE_KEYS.journal;
const LARGE_LOCAL_DATASET_THRESHOLD = 1000;
const JOURNAL_PAGE_SIZE = 100;
const APP_VERSION = String(import.meta.env.VITE_APP_VERSION || import.meta.env.VITE_BUILD_TIMESTAMP || import.meta.env.MODE || "unknown");
const EMPTY_FILTER_VALUES = {
  search: "",
  assetType: "all",
  result: "all",
  dateFrom: "",
  dateTo: "",
};

const ASSET_TYPES = ["stock", "forex", "crypto", "index", "unknown"];
const SETUP_TAGS = [
  "breakout",
  "pullback",
  "reversal",
  "trend_continuation",
  "momentum",
  "mean_reversion",
  "news_reaction",
  "news_event",
  "earnings",
  "support_resistance",
  "range_trade",
  "other",
];
const GENERATED_SETUP_LABELS = {
  pattern_alert: "Pattern Alert",
  streak_pullback_confirmation: "Streak Pullback Confirmation",
};
const MISTAKE_TAGS = [
  "none",
  "late_entry",
  "early_exit",
  "revenge_trade",
  "oversized_position",
  "traded_against_sentiment",
  "no_plan",
  "ignored_stop",
  "poor_risk_reward",
  "bad_risk_reward",
  "other",
];
const EQUITY_LIKE_TICKERS = new Set(["RELIANCE", "TATASTEEL", "INFY", "TCS"]);

function inferAssetType(symbol) {
  const s = String(symbol || "").trim().toUpperCase();
  if (!s) return "unknown";
  if (s.includes("BTC") || s.includes("ETH") || s.includes("USDT") || s.endsWith("-USD")) return "crypto";
  if (s.startsWith("^") || s.includes("NIFTY") || s.includes("SENSEX") || s.includes("SPX") || s.includes("NASDAQ")) return "index";
  if (/^[A-Z]{6}$/.test(s) && !s.includes(".")) return "forex";
  if (s.endsWith(".NS") || s.endsWith(".BO") || EQUITY_LIKE_TICKERS.has(s.replace(/\.(NS|BO)$/i, ""))) return "stock";
  return "unknown";
}

function parseOptionalNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const cleaned = typeof value === "string" ? value.replace(/[₹$,%]/g, "").replace(/,/g, "").trim() : value;
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseConfidence(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

function normalizeBoolean(value) {
  if (value === true || value === false) return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(normalized)) return true;
  if (["false", "no", "n", "0"].includes(normalized)) return false;
  return null;
}

function dateStamp() {
  return new Date().toISOString().split("T")[0];
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[%&/()]/g, "")
    .replace(/[\s-]+/g, "_");
}

function normalizeSetupTag(value) {
  const raw = String(value || "").trim();
  const key = normalizeKey(raw);
  if (!key) return "";
  if (SETUP_TAGS.includes(key)) return key;
  return GENERATED_SETUP_LABELS[key] || raw;
}

const IMPORT_COLUMN_ALIASES = {
  assettype: "asset_type",
  asset_type: "asset_type",
  confidence: "confidence_score",
  confidence_score: "confidence_score",
  direction: "type",
  entry: "entry_price",
  entry_price: "entry_price",
  entry_reason: "entry_reason",
  exit: "exit_price",
  exit_price: "exit_price",
  exit_reason: "exit_reason",
  id: "id",
  mistake: "mistake_tag",
  mistake_tag: "mistake_tag",
  notes: "notes",
  pl: "pnl",
  pl_: "pnl_pct",
  planned_reward: "planned_reward",
  planned_risk: "planned_risk",
  pnl: "pnl",
  pnl_pct: "pnl_pct",
  quantity: "quantity",
  qty: "quantity",
  result: "result",
  rule_followed: "rule_followed",
  scenario_context: "scenario_context",
  setup: "setup_tag",
  setup_tag: "setup_tag",
  side: "type",
  source_type: "source_type",
  symbol: "symbol",
  synthetic_flag: "synthetic_flag",
  trade_id: "id",
  type: "type",
};

const SUPPORTED_IMPORT_COLUMNS = new Set([
  "id",
  "date",
  "symbol",
  "asset_type",
  "type",
  "entry_price",
  "exit_price",
  "quantity",
  "notes",
  "pnl",
  "pnl_pct",
  "result",
  "setup_tag",
  "mistake_tag",
  "confidence_score",
  "planned_risk",
  "planned_reward",
  "rule_followed",
  "entry_reason",
  "exit_reason",
  "scenario_context",
  "synthetic_flag",
  "source_type",
]);

function formatTag(value) {
  if (!value) return "";
  return String(value).replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function normalizeResult(value) {
  const text = String(value ?? "").trim().toUpperCase();
  if (text === "WIN" || text === "PROFIT" || text === "W") return "WIN";
  if (text === "LOSS" || text === "LOSE" || text === "L") return "LOSS";
  return null;
}

function normalizeTrade(trade, index = null) {
  const symbol = String(trade?.symbol || "").trim().toUpperCase();
  const type = String(trade?.type || "LONG").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
  const entry = parseOptionalNumber(trade?.entry_price);
  const exit = parseOptionalNumber(trade?.exit_price);
  const quantity = parseOptionalNumber(trade?.quantity);
  const pnl = parseOptionalNumber(trade?.pnl);
  const pnlPct = parseOptionalNumber(trade?.pnl_pct);
  const computed = calcPnl(type, entry, exit, quantity);
  const assetType = ASSET_TYPES.includes(trade?.asset_type) ? trade.asset_type : inferAssetType(symbol);
  const setupTag = normalizeSetupTag(trade?.setup_tag ?? trade?.setupTag ?? trade?.setup ?? trade?.setupName ?? trade?.strategy);
  const mistakeTag = MISTAKE_TAGS.includes(trade?.mistake_tag) ? trade.mistake_tag : "none";
  const result = normalizeResult(trade?.result) || computed.result || (pnl > 0 ? "WIN" : pnl < 0 ? "LOSS" : null);

  const normalized = {
    id: String(trade?.id || `${symbol || "TRADE"}-${trade?.date || Date.now()}-${index ?? Date.now()}`),
    user_id: trade?.user_id ?? null,
    created_at: trade?.created_at || null,
    date: String(trade?.date || new Date().toISOString().split("T")[0]),
    symbol,
    asset_type: assetType,
    type,
    entry_price: entry,
    exit_price: exit,
    quantity,
    notes: String(trade?.notes || ""),
    pnl: pnl ?? computed.pnl,
    pnl_pct: pnlPct ?? computed.pnl_pct,
    result,
    setup_tag: setupTag,
    mistake_tag: mistakeTag,
    confidence_score: parseConfidence(trade?.confidence_score),
    planned_risk: parseOptionalNumber(trade?.planned_risk),
    planned_reward: parseOptionalNumber(trade?.planned_reward),
    rule_followed: normalizeBoolean(trade?.rule_followed),
    entry_reason: String(trade?.entry_reason || ""),
    exit_reason: String(trade?.exit_reason || ""),
  };

  if (trade?.scenario_context !== undefined) normalized.scenario_context = String(trade.scenario_context || "");
  if (trade?.synthetic_flag !== undefined) normalized.synthetic_flag = normalizeBoolean(trade.synthetic_flag);
  if (trade?.source_type !== undefined) normalized.source_type = String(trade.source_type || "").trim().toLowerCase();

  return normalized;
}

function createdAtValue(trade) {
  const value = Date.parse(trade?.created_at || "");
  return Number.isFinite(value) ? value : 0;
}

function mergeVerifiedTradeAtTop(existingTrades, verifiedTrade, previousId = null) {
  const normalizedVerified = normalizeTrade(verifiedTrade);
  const verifiedId = String(normalizedVerified.id);
  const oldId = previousId ? String(previousId) : null;
  const rest = existingTrades
    .map((trade, index) => normalizeTrade(trade, index))
    .filter(trade => String(trade.id) !== verifiedId && (!oldId || String(trade.id) !== oldId));
  return [normalizedVerified, ...rest].sort((a, b) => (
    (createdAtValue(b) - createdAtValue(a)) ||
    b.date.localeCompare(a.date) ||
    a.symbol.localeCompare(b.symbol)
  ));
}

function sortJournalTrades(rows, sortField = "created_at", sortDirection = "desc") {
  const arr = [...(Array.isArray(rows) ? rows : [])];
  const dir = sortDirection === "asc" ? 1 : -1;
  arr.sort((a, b) => {
    switch (sortField) {
      case "created_at":
        return (
          (createdAtValue(a) - createdAtValue(b)) ||
          String(a?.date || "").localeCompare(String(b?.date || "")) ||
          String(a?.symbol || "").localeCompare(String(b?.symbol || ""))
        ) * dir;
      case "date":
        return (
          (tradeDateSortValue(a?.date) - tradeDateSortValue(b?.date)) ||
          String(a?.date || "").localeCompare(String(b?.date || "")) ||
          (createdAtValue(a) - createdAtValue(b)) ||
          String(a?.symbol || "").localeCompare(String(b?.symbol || ""))
        ) * dir;
      case "symbol":
        return String(a?.symbol || "").localeCompare(String(b?.symbol || "")) * dir;
      case "pnl":
        return ((Number(a?.pnl) || 0) - (Number(b?.pnl) || 0)) * dir;
      case "result":
        return String(a?.result || "").localeCompare(String(b?.result || "")) * dir;
      default:
        return 0;
    }
  });
  return arr;
}

function readDemoFlag() {
  if (typeof window === "undefined" || !window.localStorage) return null;
  return window.localStorage.getItem(DEMO_ENTRY_KEY);
}

function readLastSavedTradeId() {
  if (typeof window === "undefined" || !window.localStorage) return "";
  return String(window.localStorage.getItem(LAST_SAVED_TRADE_ID_KEY) || "").trim();
}

function persistLastSavedTradeId(id) {
  const value = String(id || "").trim();
  if (!value || typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.setItem(LAST_SAVED_TRADE_ID_KEY, value);
}

function summarizeDebugRows(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, 5).map((row) => ({
    id: row?.id || null,
    symbol: row?.symbol || null,
    created_at: row?.created_at || null,
    date: row?.date || null,
  }));
}

function buildJournalDebugReport({
  status,
  authEmail,
  storageMode,
  trades,
  visibleTrades,
  sortedTrades,
  page,
  sortCol,
  sortDir,
  lastSavedTradeId,
}) {
  const saveTradeId = status?.saveTradeId || lastSavedTradeId || "";
  const loadedRows = Array.isArray(trades) ? trades : [];
  const visibleRows = Array.isArray(visibleTrades) ? visibleTrades : [];
  const latestRows = sortJournalTrades(loadedRows, "created_at", "desc");
  return {
    appVersion: APP_VERSION,
    currentURL: typeof window !== "undefined" ? window.location.href : "",
    isAuthenticated: status?.isAuthenticated === true || status?.signedIn === true,
    currentUserId: status?.currentUserId || null,
    currentUserEmail: authEmail || status?.currentUserEmail || null,
    storageMode: storageMode || status?.storageMode || status?.mode || "local",
    bullcast_demo_entered: readDemoFlag(),
    supabaseConfigured: status?.supabaseConfigured === true,
    loadedRowCount: loadedRows.length,
    visibleRowCount: visibleRows.length,
    currentPage: page + 1,
    pageSize: JOURNAL_PAGE_SIZE,
    sortField: sortCol,
    sortDirection: sortDir,
    activeFilters: { ...EMPTY_FILTER_VALUES },
    filtersActive: false,
    lastLoadTarget: status?.lastLoadTarget || null,
    lastLoadErrorMessage: status?.lastLoadErrorMessage || null,
    lastSaveAction: status?.lastSaveAction || null,
    lastSaveTarget: status?.lastSaveTarget || null,
    lastSaveErrorMessage: status?.lastSaveErrorMessage || null,
    lastInsertedRowCount: status?.lastInsertedRowCount ?? 0,
    lastReturnedRowIds: Array.isArray(status?.lastReturnedRowIds) ? status.lastReturnedRowIds : [],
    saveStartedAt: status?.saveStartedAt || null,
    saveTradeId: saveTradeId || null,
    saveSymbol: status?.saveSymbol || null,
    saveStep: status?.saveStep || "idle",
    supabaseInsertStatus: status?.supabaseInsertStatus ?? null,
    verifySelectStatus: status?.verifySelectStatus ?? null,
    verifiedRowFound: status?.verifiedRowFound === true,
    verifiedRowUserIdMatches: status?.verifiedRowUserIdMatches === true,
    postSaveVisibleInTable: status?.postSaveVisibleInTable === true,
    lastReloadAfterSaveCount: status?.lastReloadAfterSaveCount ?? 0,
    first5VisibleRows: summarizeDebugRows(visibleRows),
    latest5LoadedRows: summarizeDebugRows(latestRows),
    saveTradeIdExistsInLoadedRows: findTradeIndexById(loadedRows, saveTradeId) >= 0,
    saveTradeIdExistsInVisibleRows: findTradeIndexById(visibleRows, saveTradeId) >= 0,
    lastSavedTradeId: lastSavedTradeId || null,
    lastSavedTradeIdExistsInLoadedRows: findTradeIndexById(loadedRows, lastSavedTradeId) >= 0,
    lastSavedTradeIdExistsInVisibleRows: findTradeIndexById(visibleRows, lastSavedTradeId) >= 0,
    sortedRowCount: Array.isArray(sortedTrades) ? sortedTrades.length : 0,
  };
}

function parsedTradeIssues(trade) {
  const issues = [];
  const missing = Array.isArray(trade?.missing_fields) ? trade.missing_fields : [];
  if (!String(trade?.symbol || "").trim() || missing.includes("symbol")) issues.push("Missing symbol");
  if (!["LONG", "SHORT"].includes(String(trade?.side || "").toUpperCase()) || missing.includes("side")) issues.push("Missing side");
  if (parseOptionalNumber(trade?.entry) === null && parseOptionalNumber(trade?.exit) === null) {
    issues.push("Missing entry or exit price");
  } else if (parseOptionalNumber(trade?.entry) === null || missing.includes("entry")) {
    issues.push("Missing entry price");
  } else if (parseOptionalNumber(trade?.exit) === null || missing.includes("exit")) {
    issues.push("Missing exit price");
  }
  if (parseOptionalNumber(trade?.quantity) === null || missing.includes("quantity")) issues.push("Missing quantity");
  return Array.from(new Set(issues));
}

function parsedTradeCanSave(trade) {
  const issues = parsedTradeIssues(trade);
  return !issues.some(issue => ["Missing symbol", "Missing side", "Missing entry or exit price"].includes(issue));
}

function parsedTradeNeedsReview(trade) {
  return trade?.needs_review === true || parsedTradeIssues(trade).length > 0;
}

function buildColumnMappingMessages(columnMapping = {}) {
  const entries = Object.entries(columnMapping || {});
  if (entries.length === 0) return [];
  return entries.map(([source, target]) => `${source} -> ${target || "unmapped"}`);
}

function parsedTradeToJournalTrade(trade) {
  const entry = parseOptionalNumber(trade?.entry);
  const exit = parseOptionalNumber(trade?.exit);
  const quantity = parseOptionalNumber(trade?.quantity);
  const type = String(trade?.side || "LONG").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
  const { pnl, pnl_pct, result } = calcPnl(type, entry, exit, quantity);
  const notes = [
    String(trade?.notes || "").trim(),
    parsedTradeIssues(trade).includes("Missing quantity") ? "AI parse warning: missing quantity." : "",
  ].filter(Boolean).join(" ");

  const sourceType = String(trade?.data_origin || trade?.source_type || "gemini_text_parse").trim().toLowerCase();

  return normalizeTrade({
    id: createJournalTradeId(),
    date: String(trade?.date || dateStamp()),
    symbol: String(trade?.symbol || "").trim().toUpperCase(),
    asset_type: inferAssetType(trade?.symbol),
    type,
    entry_price: entry,
    exit_price: exit,
    quantity,
    notes,
    pnl,
    pnl_pct,
    result,
    setup_tag: normalizeSetupTag(trade?.setup_tag || trade?.setup),
    mistake_tag: MISTAKE_TAGS.includes(String(trade?.mistake_tag || "").trim()) ? trade.mistake_tag : "none",
    confidence_score: parseConfidence(trade?.confidence_score),
    planned_risk: parseOptionalNumber(trade?.planned_risk),
    planned_reward: parseOptionalNumber(trade?.planned_reward),
    rule_followed: normalizeBoolean(trade?.rule_followed),
    entry_reason: String(trade?.entry_reason || "").trim(),
    exit_reason: String(trade?.exit_reason || "").trim(),
    synthetic_flag: false,
    source_type: sourceType || "gemini_text_parse",
  });
}

function readLocalJournalRows() {
  try {
    const parsed = readStorage(STORAGE_KEY, []);
    return Array.isArray(parsed) ? parsed.filter(trade => trade && typeof trade === "object") : [];
  } catch {
    return [];
  }
}

function loadRawStoredTrades() {
  return readLocalJournalRows();
}

function getInitialJournalState() {
  const localRows = readLocalJournalRows();
  const localRowCount = localRows.length;
  const useLocalRowsImmediately = !isSupabasePersistenceConfigured();

  return {
    trades: useLocalRowsImmediately ? localRows.map((trade, index) => normalizeTrade(trade, index)) : [],
    localRowCount,
    largeLocalDataset: localRowCount > LARGE_LOCAL_DATASET_THRESHOLD,
  };
}

function calcPnl(type, entry, exit, qty) {
  const entryValue = Number(entry);
  const exitValue = Number(exit);
  const quantityValue = Number(qty);
  if (!Number.isFinite(entryValue) || !Number.isFinite(exitValue) || !Number.isFinite(quantityValue) || entryValue <= 0 || quantityValue <= 0) {
    return { pnl: null, pnl_pct: null, result: null };
  }
  const pnl = type === "LONG"
    ? (exitValue - entryValue) * quantityValue
    : (entryValue - exitValue) * quantityValue;
  const cost = entryValue * quantityValue;
  const pnl_pct = cost > 0 ? (pnl / cost) * 100 : 0;
  return { pnl, pnl_pct, result: pnl > 0 ? "WIN" : pnl < 0 ? "LOSS" : null };
}

function formatCurrency(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "₹0.00";
  const sign = n > 0 ? "+" : "";
  return sign + "₹" + Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatNumber(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "-";
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCSV(trades) {
  const headers = [
    "Date", "Symbol", "Asset Type", "Type", "Entry Price", "Exit Price", "Quantity",
    "P&L", "P&L %", "Result", "Setup Tag", "Mistake Tag", "Confidence Score",
    "Planned Risk", "Planned Reward", "Rule Followed", "Entry Reason", "Exit Reason", "Notes"
  ];
  const rows = trades.map(t => [
    t.date, t.symbol, t.asset_type, t.type,
    t.entry_price, t.exit_price, t.quantity,
    parseOptionalNumber(t.pnl)?.toFixed(2) ?? "", parseOptionalNumber(t.pnl_pct)?.toFixed(2) ?? "",
    t.result, t.setup_tag || "", t.mistake_tag || "none", t.confidence_score ?? "",
    t.planned_risk ?? "", t.planned_reward ?? "",
    t.rule_followed === null || t.rule_followed === undefined ? "" : t.rule_followed,
    t.entry_reason || "",
    t.exit_reason || "",
    t.notes || ""
  ]);
  const csv = [headers.map(csvCell).join(","), ...rows.map(r => r.map(csvCell).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const today = new Date().toISOString().split("T")[0];
  a.href = url;
  a.download = `bullcast-journal-${today}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadJSON(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function isSyntheticTrade(trade) {
  const syntheticFlag = trade?.synthetic_flag === true || String(trade?.synthetic_flag || "").trim().toLowerCase() === "true";
  const syntheticSource = String(trade?.source_type || "").trim().toLowerCase() === "synthetic_dev";
  const syntheticId = String(trade?.id || "").trim().toUpperCase().startsWith("SYN-");
  return syntheticFlag || syntheticSource || syntheticId;
}

function splitRealAndSyntheticTrades(trades) {
  const realTrades = [];
  const syntheticTrades = [];

  trades.forEach(trade => {
    if (isSyntheticTrade(trade)) syntheticTrades.push(trade);
    else realTrades.push(trade);
  });

  return { realTrades, syntheticTrades };
}

function canonicalImportRow(row) {
  const normalized = {};
  Object.entries(row || {}).forEach(([rawKey, value]) => {
    const key = normalizeKey(rawKey);
    const canonical = IMPORT_COLUMN_ALIASES[key] || key;
    if (SUPPORTED_IMPORT_COLUMNS.has(canonical)) {
      normalized[canonical] = value;
    }
  });
  return normalized;
}

function isBlankImportRow(row) {
  return !Object.values(row || {}).some(value => String(value ?? "").trim() !== "");
}

async function parseJournalImportFile(file) {
  const filename = String(file?.name || "").toLowerCase();
  if (!filename.endsWith(".csv") && !filename.endsWith(".xlsx")) {
    throw new Error("Unsupported file type. Upload a .csv or .xlsx file.");
  }

  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const firstSheetName = workbook.SheetNames?.[0];
  if (!firstSheetName) {
    throw new Error("Import file has no readable sheets.");
  }

  return XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { defval: "", raw: false });
}

function normalizeImportedTrade(row, index) {
  const data = canonicalImportRow(row);
  if (isBlankImportRow(data)) {
    return { trade: null, error: null };
  }

  const symbol = String(data.symbol || "").trim().toUpperCase();
  if (!symbol) {
    return { trade: null, error: `Row ${index + 2}: missing symbol.` };
  }

  const rawSide = String(data.type || "LONG").trim().toUpperCase();
  const type = rawSide === "SHORT" || rawSide === "SELL" ? "SHORT" : "LONG";
  const importDate = String(data.date || dateStamp()).trim();
  const entry = parseOptionalNumber(data.entry_price);
  const exit = parseOptionalNumber(data.exit_price);
  const quantity = parseOptionalNumber(data.quantity);
  const computed = calcPnl(type, entry, exit, quantity);
  const importedPnl = parseOptionalNumber(data.pnl);
  const pnl = importedPnl ?? computed.pnl;
  const result = normalizeResult(data.result) || computed.result || (pnl > 0 ? "WIN" : pnl < 0 ? "LOSS" : null);
  const assetType = String(data.asset_type || "").trim().toLowerCase();
  const setupTag = normalizeKey(data.setup_tag);
  const mistakeTag = normalizeKey(data.mistake_tag);
  const notes = String(data.notes || "").trim();
  const simulatedImport = /simulated data|generated from ohlc pattern alert data/i.test(notes);

  return {
    trade: normalizeTrade({
      id: createJournalTradeId(String(data.id || "").trim() || `${simulatedImport ? "SYN-PATTERN" : "IMPORT"}-${importDate}-${index + 1}-${symbol}-${type}-${entry}-${exit}-${quantity}`),
      date: importDate,
      symbol,
      asset_type: ASSET_TYPES.includes(assetType) ? assetType : inferAssetType(symbol),
      type,
      entry_price: entry,
      exit_price: exit,
      quantity,
      notes,
      pnl,
      pnl_pct: parseOptionalNumber(data.pnl_pct) ?? computed.pnl_pct,
      result,
      setup_tag: normalizeSetupTag(data.setup_tag),
      mistake_tag: MISTAKE_TAGS.includes(mistakeTag) ? mistakeTag : "none",
      confidence_score: parseConfidence(data.confidence_score),
      planned_risk: parseOptionalNumber(data.planned_risk),
      planned_reward: parseOptionalNumber(data.planned_reward),
      rule_followed: normalizeBoolean(data.rule_followed),
      entry_reason: String(data.entry_reason || "").trim(),
      exit_reason: String(data.exit_reason || "").trim(),
      scenario_context: String(data.scenario_context || "").trim(),
      synthetic_flag: simulatedImport ? true : normalizeBoolean(data.synthetic_flag),
      source_type: simulatedImport ? "synthetic_dev" : String(data.source_type || "").trim().toLowerCase(),
    }),
    error: null,
  };
}

function mergeImportedTrades(existingTrades, importedTrades) {
  const byId = new Map(existingTrades.map((trade, index) => [trade.id, { trade, index }]));
  const merged = [...existingTrades];
  let updatedCount = 0;

  importedTrades.forEach(trade => {
    const existing = byId.get(trade.id);
    if (existing) {
      merged[existing.index] = trade;
      updatedCount += 1;
    } else {
      byId.set(trade.id, { trade, index: merged.length });
      merged.push(trade);
    }
  });

  return { merged, updatedCount };
}

// --- Modal Component ---
function AddTradeModal({ onClose, onSave, initialTrade = null }) {
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({
    date: initialTrade?.date || today,
    symbol: initialTrade?.symbol || "",
    asset_type: initialTrade?.asset_type || inferAssetType(initialTrade?.symbol),
    type: initialTrade?.type || "LONG",
    entry_price: initialTrade?.entry_price ?? "",
    exit_price: initialTrade?.exit_price ?? "",
    quantity: initialTrade?.quantity ?? "",
    notes: initialTrade?.notes || "",
    setup_tag: initialTrade?.setup_tag || "",
    mistake_tag: initialTrade?.mistake_tag || "none",
    confidence_score: initialTrade?.confidence_score ?? "",
    planned_risk: initialTrade?.planned_risk ?? "",
    planned_reward: initialTrade?.planned_reward ?? "",
    rule_followed: initialTrade?.rule_followed === true ? "true" : initialTrade?.rule_followed === false ? "false" : "",
    entry_reason: initialTrade?.entry_reason || "",
    exit_reason: initialTrade?.exit_reason || "",
  });
  const [errors, setErrors] = useState({});
  const isEditing = Boolean(initialTrade);

  const update = (k, v) => {
    setForm(prev => ({ ...prev, [k]: v }));
    setErrors(prev => ({ ...prev, [k]: false }));
  };

  const updateSymbol = (value) => {
    const symbol = value.toUpperCase();
    setForm(prev => ({ ...prev, symbol, asset_type: inferAssetType(symbol) }));
    setErrors(prev => ({ ...prev, symbol: false }));
  };

  const entry = parseFloat(form.entry_price);
  const exit = parseFloat(form.exit_price);
  const qty = parseFloat(form.quantity);
  const hasPreview = Number.isFinite(entry) && Number.isFinite(exit) && Number.isFinite(qty) && entry > 0 && qty > 0;
  const preview = hasPreview ? calcPnl(form.type, entry, exit, qty) : null;

  const handleSave = () => {
    const errs = {};
    if (!form.date) errs.date = true;
    if (!form.symbol.trim()) errs.symbol = true;
    if (!Number.isFinite(entry) || entry <= 0) errs.entry_price = true;
    if (!Number.isFinite(exit) || exit <= 0) errs.exit_price = true;
    if (!Number.isFinite(qty) || qty <= 0) errs.quantity = true;
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    const { pnl, pnl_pct, result } = calcPnl(form.type, entry, exit, qty);
    const symbol = form.symbol.trim().toUpperCase();
    onSave({
      id: initialTrade?.id || createJournalTradeId(),
      date: form.date,
      symbol,
      asset_type: ASSET_TYPES.includes(form.asset_type) ? form.asset_type : inferAssetType(symbol),
      type: form.type,
      entry_price: entry,
      exit_price: exit,
      quantity: qty,
      notes: form.notes.trim(),
      pnl, pnl_pct, result,
      setup_tag: SETUP_TAGS.includes(form.setup_tag) ? form.setup_tag : "",
      mistake_tag: MISTAKE_TAGS.includes(form.mistake_tag) ? form.mistake_tag : "none",
      confidence_score: parseConfidence(form.confidence_score),
      planned_risk: parseOptionalNumber(form.planned_risk),
      planned_reward: parseOptionalNumber(form.planned_reward),
      rule_followed: normalizeBoolean(form.rule_followed),
      entry_reason: form.entry_reason.trim(),
      exit_reason: form.exit_reason.trim(),
    });
  };

  const errBorder = "1px solid rgba(255,59,59,0.5)";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.75)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="glass-panel"
        style={{
          width: "100%", maxWidth: 480, maxHeight: "90vh",
          overflowY: "auto", padding: 24, position: "relative",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.4rem", color: "#C8F135", letterSpacing: "0.08em" }}>
            {isEditing ? "EDIT TRADE" : "ADD TRADE"}
          </div>
          <button onClick={onClose} style={{ color: "#555566", fontSize: "1.4rem", background: "none", border: "none", cursor: "pointer", lineHeight: 1 }}>&times;</button>
        </div>

        {/* Date */}
        <label style={{ display: "block", marginBottom: 14 }}>
          <div style={labelStyle}>DATE</div>
          <input type="date" className="terminal-input" value={form.date} onChange={e => update("date", e.target.value)}
            style={{ width: "100%", ...(errors.date ? { border: errBorder } : {}) }} />
        </label>

        {/* Symbol */}
        <label style={{ display: "block", marginBottom: 14 }}>
          <div style={labelStyle}>SYMBOL</div>
          <input type="text" className="terminal-input" placeholder="RELIANCE.NS, USDINR=X, GC=F..."
            value={form.symbol} onChange={e => updateSymbol(e.target.value)}
            style={{ width: "100%", ...(errors.symbol ? { border: errBorder } : {}) }} />
        </label>

        {/* Asset Type */}
        <label style={{ display: "block", marginBottom: 14 }}>
          <div style={labelStyle}>ASSET TYPE</div>
          <select className="terminal-input" value={form.asset_type} onChange={e => update("asset_type", e.target.value)}
            style={{ width: "100%" }}>
            {ASSET_TYPES.map(type => (
              <option key={type} value={type}>{formatTag(type)}</option>
            ))}
          </select>
        </label>

        {/* Trade Type Toggle */}
        <div style={{ marginBottom: 14 }}>
          <div style={labelStyle}>TYPE</div>
          <div style={{ display: "flex", gap: 8 }}>
            {["LONG", "SHORT"].map(t => (
              <button key={t} onClick={() => update("type", t)}
                style={{
                  flex: 1, padding: "8px 0", borderRadius: 4, cursor: "pointer",
                  fontFamily: "'JetBrains Mono', monospace", fontSize: "0.8rem", fontWeight: 700,
                  letterSpacing: "0.1em", transition: "all 0.15s",
                  border: `1px solid ${form.type === t ? (t === "LONG" ? "#C8F135" : "#FF3B3B") : "rgba(255,255,255,0.06)"}`,
                  background: form.type === t ? (t === "LONG" ? "rgba(200,241,53,0.08)" : "rgba(255,59,59,0.08)") : "transparent",
                  color: form.type === t ? (t === "LONG" ? "#C8F135" : "#FF3B3B") : "#555566",
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Entry / Exit / Qty */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <label>
            <div style={labelStyle}>ENTRY PRICE (₹)</div>
            <input type="number" step="0.01" className="terminal-input" value={form.entry_price}
              onChange={e => update("entry_price", e.target.value)}
              style={{ width: "100%", ...(errors.entry_price ? { border: errBorder } : {}) }} />
          </label>
          <label>
            <div style={labelStyle}>EXIT PRICE (₹)</div>
            <input type="number" step="0.01" className="terminal-input" value={form.exit_price}
              onChange={e => update("exit_price", e.target.value)}
              style={{ width: "100%", ...(errors.exit_price ? { border: errBorder } : {}) }} />
          </label>
        </div>
        <label style={{ display: "block", marginBottom: 14 }}>
          <div style={labelStyle}>QUANTITY</div>
          <input type="number" min="1" className="terminal-input" value={form.quantity}
            onChange={e => update("quantity", e.target.value)}
            style={{ width: "100%", ...(errors.quantity ? { border: errBorder } : {}) }} />
        </label>

        {/* Notes */}
        <label style={{ display: "block", marginBottom: 14 }}>
          <div style={labelStyle}>NOTES (OPTIONAL)</div>
          <textarea rows={3} className="terminal-input" value={form.notes}
            onChange={e => update("notes", e.target.value)}
            style={{ width: "100%", resize: "vertical" }} />
        </label>

        {/* Training Fields */}
        <details style={{
          marginBottom: 16,
          background: "#0c0c14",
          border: "1px solid rgba(200,241,53,0.08)",
          borderRadius: 4,
          padding: "12px 14px",
        }}>
          <summary style={{
            cursor: "pointer",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.68rem",
            color: "#C8F135",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}>
            Training Fields
          </summary>

          <div style={{ marginTop: 14 }}>
            <div style={{
              marginBottom: 14,
              padding: "9px 10px",
              border: "1px solid rgba(200,241,53,0.08)",
              borderRadius: 4,
              background: "rgba(200,241,53,0.03)",
              color: "#888899",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.68rem",
              lineHeight: 1.5,
            }}>
              Better labels improve future risk model readiness. Setup tag, planned risk, planned reward, and rule followed are recommended.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              <label>
                <RecommendedLabel>SETUP TAG RECOMMENDED</RecommendedLabel>
                <select className="terminal-input" value={form.setup_tag} onChange={e => update("setup_tag", e.target.value)}
                  style={{ width: "100%" }}>
                  <option value="">Optional</option>
                  {SETUP_TAGS.map(tag => (
                    <option key={tag} value={tag}>{formatTag(tag)}</option>
                  ))}
                </select>
              </label>
              <label>
                <div style={labelStyle}>MISTAKE TAG</div>
                <select className="terminal-input" value={form.mistake_tag} onChange={e => update("mistake_tag", e.target.value)}
                  style={{ width: "100%" }}>
                  {MISTAKE_TAGS.map(tag => (
                    <option key={tag} value={tag}>{formatTag(tag)}</option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              <label>
                <div style={labelStyle}>CONFIDENCE (1-5)</div>
                <select className="terminal-input" value={form.confidence_score} onChange={e => update("confidence_score", e.target.value)}
                  style={{ width: "100%" }}>
                  <option value="">Optional</option>
                  {[1, 2, 3, 4, 5].map(score => (
                    <option key={score} value={score}>{score}</option>
                  ))}
                </select>
              </label>
              <label>
                <RecommendedLabel>RULE FOLLOWED RECOMMENDED</RecommendedLabel>
                <select className="terminal-input" value={form.rule_followed} onChange={e => update("rule_followed", e.target.value)}
                  style={{ width: "100%" }}>
                  <option value="">Optional</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              <label>
                <RecommendedLabel>PLANNED RISK RECOMMENDED</RecommendedLabel>
                <input type="number" step="0.01" min="0" className="terminal-input" value={form.planned_risk}
                  onChange={e => update("planned_risk", e.target.value)}
                  style={{ width: "100%" }} />
              </label>
              <label>
                <RecommendedLabel>PLANNED REWARD RECOMMENDED</RecommendedLabel>
                <input type="number" step="0.01" min="0" className="terminal-input" value={form.planned_reward}
                  onChange={e => update("planned_reward", e.target.value)}
                  style={{ width: "100%" }} />
              </label>
            </div>

            <label style={{ display: "block", marginBottom: 14 }}>
              <div style={labelStyle}>ENTRY REASON</div>
              <input type="text" maxLength={180} className="terminal-input" value={form.entry_reason}
                onChange={e => update("entry_reason", e.target.value)}
                style={{ width: "100%" }} />
            </label>

            <label style={{ display: "block" }}>
              <div style={labelStyle}>EXIT REASON</div>
              <input type="text" maxLength={180} className="terminal-input" value={form.exit_reason}
                onChange={e => update("exit_reason", e.target.value)}
                style={{ width: "100%" }} />
            </label>
          </div>
        </details>

        {/* P&L Preview */}
        {preview && (
          <div style={{
            padding: "10px 14px", borderRadius: 4, marginBottom: 16,
            background: preview.pnl >= 0 ? "rgba(0,255,135,0.06)" : "rgba(255,59,59,0.06)",
            border: `1px solid ${preview.pnl >= 0 ? "rgba(0,255,135,0.2)" : "rgba(255,59,59,0.2)"}`,
            fontFamily: "'JetBrains Mono', monospace", fontSize: "0.82rem",
            color: preview.pnl >= 0 ? "#00FF87" : "#FF3B3B",
          }}>
            P&L Preview: {formatCurrency(preview.pnl)} ({preview.pnl_pct.toFixed(2)}%)
          </div>
        )}

        {/* Save Button */}
        <button onClick={handleSave} className="terminal-button" style={{ width: "100%" }}>
          {isEditing ? "Update Trade" : "Save Trade"}
        </button>
      </div>
    </div>
  );
}

const labelStyle = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: "0.65rem", color: "#C8F135",
  letterSpacing: "0.16em", textTransform: "uppercase",
  marginBottom: 6,
};

const recommendedStyle = {
  color: "#888899",
  fontSize: "0.55rem",
  letterSpacing: "0.08em",
};

function RecommendedLabel({ children }) {
  return (
    <div style={{ ...labelStyle, ...recommendedStyle }}>
      {children}
    </div>
  );
}

// --- Main Journal Page ---
export default function Journal() {
  const navigate = useNavigate();
  const initialJournalRef = useRef(null);
  if (!initialJournalRef.current) initialJournalRef.current = getInitialJournalState();

  const [trades, setTrades] = useState(() => initialJournalRef.current.trades);
  const [storageMode, setStorageMode] = useState(() => getInitialStorageMode());
  const [authEmail, setAuthEmail] = useState(null);
  const [storageStatus, setStorageStatus] = useState(() => getInitialStorageStatus({
    lastLoadTarget: "local",
    loadedRowCount: initialJournalRef.current.localRowCount,
  }));
  const [largeLocalDatasetCount, setLargeLocalDatasetCount] = useState(() => (
    initialJournalRef.current.largeLocalDataset ? initialJournalRef.current.localRowCount : 0
  ));
  const [showModal, setShowModal] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [editingTrade, setEditingTrade] = useState(null);
  const [sortCol, setSortCol] = useState("created_at");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(0);
  const [importing, setImporting] = useState(false);
  const [loadingJournal, setLoadingJournal] = useState(() => isSupabasePersistenceConfigured());
  const [clearingDataset, setClearingDataset] = useState(false);
  const [savingTrade, setSavingTrade] = useState(false);
  const [saveNotice, setSaveNotice] = useState(null);
  const [lastSavedTradeId, setLastSavedTradeId] = useState(() => readLastSavedTradeId());
  const [debugReportText, setDebugReportText] = useState("");
  const [debugCopyMessage, setDebugCopyMessage] = useState("");
  const [aiTradeText, setAiTradeText] = useState("");
  const [aiParsing, setAiParsing] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiParseSummary, setAiParseSummary] = useState(null);
  const [aiParsedTrades, setAiParsedTrades] = useState([]);
  const [smartImporting, setSmartImporting] = useState(false);
  const [smartImportSaving, setSmartImportSaving] = useState(false);
  const [smartImportSummary, setSmartImportSummary] = useState(null);
  const [smartImportRows, setSmartImportRows] = useState([]);
  const [smartImportMapping, setSmartImportMapping] = useState({});
  const [importSummary, setImportSummary] = useState(null);
  const [clearSummary, setClearSummary] = useState(null);
  const [realExportSummary, setRealExportSummary] = useState(null);
  const [mlDatasetExporting, setMlDatasetExporting] = useState(false);
  const [mlDatasetExportSummary, setMlDatasetExportSummary] = useState(null);
  const importInputRef = useRef(null);
  const smartImportInputRef = useRef(null);
  const tradesRef = useRef(initialJournalRef.current.trades);
  const storageHydratedRef = useRef(!isSupabasePersistenceConfigured());
  const firstAutoSaveRef = useRef(true);
  const suppressNextSaveRef = useRef(false);

  useEffect(() => {
    tradesRef.current = trades;
  }, [trades]);

  useEffect(() => {
    if (!isSupabasePersistenceConfigured()) return undefined;

    let active = true;
    let hydrateRun = 0;

    const hydrateJournal = async (session) => {
      const runId = hydrateRun + 1;
      hydrateRun = runId;
      setAuthEmail(session?.user?.email || null);
      setLoadingJournal(true);

      try {
        const result = await loadJournalTradesFromStorage();
        if (!active || runId !== hydrateRun) return;

        let nextResult = result;
        let nextTrades = (result.trades || []).map((trade, index) => normalizeTrade(trade, index));
        const signedIn = Boolean(session?.user?.id);
        const supabaseWins = authenticatedModePrefersSupabase({
          isAuthenticated: signedIn,
          supabaseConfigured: result.supabaseConfigured === true,
        });
        let targetPage = 0;
        let targetSortField = sortCol;
        let targetSortDirection = sortDir;
        let rememberedTradeId = "";

        if (supabaseWins && result.mode !== "supabase") {
          nextTrades = [];
          nextResult = {
            ...result,
            mode: "supabase",
            storageMode: "supabase",
            localDemoMode: false,
            loadedRowCount: 0,
            trades: [],
          };
        }

        if (signedIn && nextResult.mode === "supabase") {
          rememberedTradeId = readLastSavedTradeId();
          if (rememberedTradeId) {
            setLastSavedTradeId(rememberedTradeId);
            const sortedByCreatedAt = sortJournalTrades(nextTrades, "created_at", "desc");
            const foundPage = getTradePageForId(sortedByCreatedAt, rememberedTradeId, JOURNAL_PAGE_SIZE);

            targetSortField = "created_at";
            targetSortDirection = "desc";
            setSortCol("created_at");
            setSortDir("desc");

            if (foundPage.index >= 0) {
              targetPage = foundPage.pageIndex;
              setSaveNotice({
                type: "success",
                message: targetPage > 0 ? `Saved trade found on page ${targetPage + 1}.` : "Latest saved trade is visible.",
              });
            } else if (nextResult.ok !== false) {
              const exactResult = await loadJournalTradeByIdFromSupabase(rememberedTradeId);
              if (!active || runId !== hydrateRun) return;
              const exactTrade = exactResult.trades?.[0] ? normalizeTrade(exactResult.trades[0]) : null;
              const reconciled = reconcileVerifiedRowAfterReload({
                loadedRows: nextTrades,
                verifiedRowId: rememberedTradeId,
                exactRow: exactTrade,
              });

              if (reconciled.mergedExactRow) {
                nextTrades = mergeVerifiedTradeAtTop(nextTrades, exactTrade);
                targetPage = 0;
                nextResult = {
                  ...nextResult,
                  loadedRowCount: nextTrades.length,
                  verifiedRowFound: true,
                  verifiedRowUserIdMatches: true,
                  postSaveVisibleInTable: true,
                };
                setSaveNotice({
                  type: "success",
                  message: "Saved to Supabase and verified. Exact lookup restored it after refresh.",
                });
              } else {
                setSaveNotice({
                  type: "warning",
                  message: "Latest saved trade was not found after refresh. Supabase exact lookup did not return that id for this user.",
                });
              }
            }
          }
        }

        setStorageMode(nextResult.mode);
        const finalSortedForStatus = sortJournalTrades(nextTrades, targetSortField, targetSortDirection);
        const finalVisibleForStatus = finalSortedForStatus.slice(targetPage * JOURNAL_PAGE_SIZE, (targetPage + 1) * JOURNAL_PAGE_SIZE);
        setStorageStatus({
          ...nextResult,
          loadedRowCount: nextTrades.length,
          currentPage: targetPage + 1,
          sortField: targetSortField,
          sortDirection: targetSortDirection,
          postSaveVisibleInTable: rememberedTradeId
            ? findTradeIndexById(finalVisibleForStatus, rememberedTradeId) >= 0
            : nextResult.postSaveVisibleInTable,
        });
        if (nextResult.mode === "local" && (nextResult.loadedRowCount ?? 0) > LARGE_LOCAL_DATASET_THRESHOLD) {
          setLargeLocalDatasetCount(nextResult.loadedRowCount);
        } else if (nextResult.mode === "supabase") {
          setLargeLocalDatasetCount(0);
        }
        suppressNextSaveRef.current = true;
        setTrades(nextTrades);
        setPage(targetPage);
        storageHydratedRef.current = true;
      } catch (error) {
        if (!active || runId !== hydrateRun) return;
        const signedIn = Boolean(session?.user?.id);
        const localRows = signedIn ? [] : readLocalJournalRows().map((trade, index) => normalizeTrade(trade, index));
        const fallbackStatus = getInitialStorageStatus({
          mode: signedIn ? "supabase" : getInitialStorageMode(),
          storageMode: signedIn ? "supabase" : getInitialStorageMode(),
          lastLoadTarget: signedIn ? "supabase" : "local",
          loadedRowCount: localRows.length,
          lastLoadErrorMessage: error?.message || String(error),
          action: signedIn ? "load journal_trades" : "load journal_trades fallback",
          localDemoMode: !signedIn,
          signedIn,
          isAuthenticated: signedIn,
          currentUserId: session?.user?.id || null,
          currentUserEmail: session?.user?.email || null,
        });
        setStorageMode(fallbackStatus.mode);
        setStorageStatus(fallbackStatus);
        suppressNextSaveRef.current = true;
        setTrades(localRows);
        storageHydratedRef.current = true;
      } finally {
        if (active && runId === hydrateRun) setLoadingJournal(false);
      }
    };

    getCurrentSupabaseSession().then((session) => {
      if (active) hydrateJournal(session);
    });
    const unsubscribe = onSupabaseAuthStateChange((_event, session) => {
      if (active) hydrateJournal(session);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!storageHydratedRef.current) return undefined;
    if (firstAutoSaveRef.current) {
      firstAutoSaveRef.current = false;
      suppressNextSaveRef.current = false;
      return undefined;
    }
    if (suppressNextSaveRef.current) {
      suppressNextSaveRef.current = false;
      return undefined;
    }

    let active = true;
    const signedInAutoSave = storageMode === "supabase" || storageStatus?.signedIn === true || storageStatus?.isAuthenticated === true;
    saveJournalTradesToStorage(trades, { fallbackToLocal: !signedInAutoSave }).then((result) => {
      if (!active) return;
      setStorageMode(result.mode);
      setStorageStatus(result);
      if (result.mode === "supabase" && Array.isArray(result.trades) && result.trades.length === trades.length) {
        const savedTrades = result.trades.map((trade, index) => normalizeTrade(trade, index));
        const idsChanged = savedTrades.some((trade, index) => (
          trade.id !== trades[index]?.id || trade.user_id !== trades[index]?.user_id
        ));
        if (idsChanged) {
          suppressNextSaveRef.current = true;
          setTrades(savedTrades);
        }
      }
    });

    return () => { active = false; };
  }, [trades]);

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(trades.length / JOURNAL_PAGE_SIZE) - 1);
    if (page > maxPage) setPage(maxPage);
  }, [page, trades.length]);

  const saveTrade = useCallback(async (trade) => {
    const normalized = normalizeTrade(trade);
    const isEditing = Boolean(editingTrade);
    const signedInSave = storageMode === "supabase" || storageStatus?.signedIn === true || storageStatus?.isAuthenticated === true;
    const currentTrades = tradesRef.current.map((current, index) => normalizeTrade(current, index));
    const nextTrades = isEditing
      ? currentTrades.map(t => t.id === normalized.id ? normalized : t)
      : [normalized, ...currentTrades];

    if (!signedInSave) {
      suppressNextSaveRef.current = true;
      tradesRef.current = nextTrades;
      setTrades(nextTrades);
    }
    setShowModal(false);
    setEditingTrade(null);
    setSaveNotice(null);

    setSavingTrade(true);
    const saveStartedAt = new Date().toISOString();
    setStorageStatus(prev => ({
      ...(prev || getSupabasePersistenceDiagnostic()),
      saveStartedAt,
      saveTradeId: normalized.id,
      saveSymbol: normalized.symbol,
      saveMode: signedInSave ? "supabase" : "local",
      saveStep: "inserting",
      supabaseInsertStatus: null,
      verifySelectStatus: null,
      verifiedRowFound: false,
      verifiedRowUserIdMatches: false,
      postSaveVisibleInTable: false,
      lastSaveErrorMessage: null,
      currentPage: page + 1,
      sortField: sortCol,
      sortDirection: sortDir,
    }));
    try {
      const saveResult = await saveJournalTradeToStorage(normalized, {
        action: isEditing ? "update_trade" : "add_trade",
        localTrades: nextTrades,
        fallbackToLocal: !signedInSave,
      });
      setStorageMode(saveResult.mode);
      setStorageStatus(saveResult);

      if (saveResult.mode === "supabase") {
        const verifiedTrade = normalizeTrade(saveResult.trades?.[0] || normalized);
        const previousId = isEditing ? editingTrade?.id : normalized.id;
        const verifiedTradeId = String(verifiedTrade.id || saveResult.saveTradeId || "");
        persistLastSavedTradeId(verifiedTradeId);
        setLastSavedTradeId(verifiedTradeId);

        const reloadResult = await loadJournalTradesFromStorage();
        const reloadedTrades = (reloadResult.trades || []).map((row, index) => normalizeTrade(row, index));
        let exactLookupResult = null;
        let exactTrade = null;
        let finalTrades = reloadedTrades;

        if (findTradeIndexById(reloadedTrades, verifiedTradeId) < 0) {
          exactLookupResult = await loadJournalTradeByIdFromSupabase(verifiedTradeId);
          exactTrade = exactLookupResult.trades?.[0] ? normalizeTrade(exactLookupResult.trades[0]) : null;
        }

        const reconciled = reconcileVerifiedRowAfterReload({
          loadedRows: reloadedTrades,
          verifiedRowId: verifiedTradeId,
          exactRow: exactTrade,
        });

        if (reconciled.missingAfterExactLookup) {
          suppressNextSaveRef.current = true;
          tradesRef.current = reloadedTrades;
          setTrades(reloadedTrades);
          setSortCol("created_at");
          setSortDir("desc");
          setPage(0);
          setStorageStatus({
            ...saveResult,
            lastLoadTarget: exactLookupResult?.lastLoadTarget || reloadResult.lastLoadTarget,
            lastLoadErrorMessage: exactLookupResult?.lastLoadErrorMessage || reloadResult.lastLoadErrorMessage,
            loadedRowCount: reloadedTrades.length,
            lastReloadAfterSaveCount: reloadedTrades.length,
            saveTradeId: verifiedTradeId,
            saveSymbol: verifiedTrade.symbol,
            saveStep: "failed",
            verifiedRowFound: false,
            verifiedRowUserIdMatches: false,
            postSaveVisibleInTable: false,
            currentPage: 1,
            sortField: "created_at",
            sortDirection: "desc",
          });
          setSaveNotice({
            type: "error",
            message: "Save verification failed after reload.",
          });
          return;
        }

        finalTrades = reconciled.mergedExactRow
          ? mergeVerifiedTradeAtTop(reloadedTrades, exactTrade || verifiedTrade, previousId)
          : reloadedTrades;

        if (findTradeIndexById(finalTrades, verifiedTradeId) < 0) {
          finalTrades = mergeVerifiedTradeAtTop(finalTrades, verifiedTrade, previousId);
        }

        const finalSorted = sortJournalTrades(finalTrades, "created_at", "desc");
        const foundPage = getTradePageForId(finalSorted, verifiedTradeId, JOURNAL_PAGE_SIZE);
        const targetPage = foundPage.pageIndex >= 0 ? foundPage.pageIndex : 0;
        const postSaveVisibleInTable = findTradeIndexById(
          finalSorted.slice(targetPage * JOURNAL_PAGE_SIZE, (targetPage + 1) * JOURNAL_PAGE_SIZE),
          verifiedTradeId
        ) >= 0;
        suppressNextSaveRef.current = true;
        tradesRef.current = finalTrades;
        setTrades(finalTrades);
        setSortCol("created_at");
        setSortDir("desc");
        setPage(targetPage);
        setStorageStatus({
          ...saveResult,
          lastLoadTarget: exactLookupResult?.lastLoadTarget || reloadResult.lastLoadTarget,
          lastLoadErrorMessage: exactLookupResult?.lastLoadErrorMessage || reloadResult.lastLoadErrorMessage,
          lastSaveTarget: saveResult.lastSaveTarget,
          lastSaveAction: saveResult.lastSaveAction,
          lastSaveErrorMessage: saveResult.lastSaveErrorMessage,
          lastInsertedRowCount: saveResult.lastInsertedRowCount,
          returnedRowCount: saveResult.returnedRowCount,
          lastReturnedRowIds: saveResult.lastReturnedRowIds,
          loadedRowCount: finalTrades.length,
          lastReloadAfterSaveCount: reloadedTrades.length,
          saveTradeId: verifiedTradeId,
          saveSymbol: verifiedTrade.symbol,
          saveStep: postSaveVisibleInTable ? "success" : "failed",
          verifiedRowFound: saveResult.verifiedRowFound === true,
          verifiedRowUserIdMatches: saveResult.verifiedRowUserIdMatches === true,
          postSaveVisibleInTable,
          currentPage: targetPage + 1,
          sortField: "created_at",
          sortDirection: "desc",
        });
        setSaveNotice({
          type: postSaveVisibleInTable ? "success" : "error",
          message: postSaveVisibleInTable
            ? (targetPage > 0 ? `Saved to Supabase and verified. Saved trade found on page ${targetPage + 1}.` : "Saved to Supabase and verified.")
            : "Save failed. Trade was not verified in Supabase.",
        });
      } else if (saveResult.lastSaveErrorMessage) {
        if (!signedInSave) {
          suppressNextSaveRef.current = true;
          tradesRef.current = nextTrades;
          setTrades(nextTrades);
        }
        setSaveNotice({
          type: "error",
          message: `Save failed. Trade was not verified in Supabase. ${saveResult.lastSaveErrorMessage}`,
        });
      }
    } catch (error) {
      const message = error?.message || String(error);
      setStorageStatus(prev => ({
        ...(prev || getSupabasePersistenceDiagnostic()),
        ok: false,
        lastSaveTarget: storageMode,
        lastSaveAction: isEditing ? "update_trade" : "add_trade",
        lastSaveErrorMessage: message,
        saveStartedAt,
        saveTradeId: normalized.id,
        saveSymbol: normalized.symbol,
        saveMode: signedInSave ? "supabase" : "local",
        saveStep: "failed",
        verifiedRowFound: false,
        verifiedRowUserIdMatches: false,
        postSaveVisibleInTable: false,
        currentPage: page + 1,
        sortField: sortCol,
        sortDirection: sortDir,
      }));
      setSaveNotice({
        type: "error",
        message: `Save failed. Trade was not verified in Supabase. ${message}`,
      });
    } finally {
      setSavingTrade(false);
    }
  }, [editingTrade, page, sortCol, sortDir, storageMode, storageStatus]);

  const parseAiTradeEntry = useCallback(async () => {
    const text = aiTradeText.trim();
    setAiParseSummary(null);
    if (!text) {
      setAiParseSummary({
        tone: "warning",
        title: "AI Trade Entry",
        messages: ["Enter a trade description before parsing."],
      });
      return;
    }

    setAiParsing(true);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
      const result = await parseJournalTrades({
        text,
        timezone,
        default_date: dateStamp(),
      });
      const parsedRows = Array.isArray(result?.trades) ? result.trades : [];
      const previewRows = parsedRows.map((trade, index) => ({
        ...trade,
        client_id: `${Date.now()}-${index}`,
        selected: parsedTradeCanSave(trade),
        needs_review: parsedTradeNeedsReview(trade),
      }));
      setAiParsedTrades(previewRows);
      setAiParseSummary({
        tone: previewRows.length > 0 ? "success" : "warning",
        title: previewRows.length > 0 ? "Parsed Successfully" : "No Trades Parsed",
        metrics: [
          ["Parsed Rows", previewRows.length],
          ["Needs Review", previewRows.filter(parsedTradeNeedsReview).length],
          ["Gemini Enabled", String(result?.llm_enabled === true)],
        ],
        messages: [
          ...(result?.llm_enabled === false ? ["Gemini parsing is unavailable. No frontend API key was used."] : []),
          ...((result?.warnings || []).map(String)),
          ...previewRows.flatMap(row => parsedTradeIssues(row)).slice(0, 5),
        ],
      });
    } catch (error) {
      setAiParseSummary({
        tone: "error",
        title: "AI Parse Failed",
        messages: [String(error?.message || error || "Could not parse trade description.")],
      });
    } finally {
      setAiParsing(false);
    }
  }, [aiTradeText]);

  const updateAiParsedTrade = useCallback((clientId, field, value) => {
    setAiParsedTrades(prev => prev.map(row => {
      if (row.client_id !== clientId) return row;
      const next = { ...row, [field]: value };
      next.needs_review = parsedTradeNeedsReview(next);
      if (field === "selected") next.selected = value;
      return next;
    }));
  }, []);

  const saveSelectedAiTrades = useCallback(async () => {
    const selectedRows = aiParsedTrades.filter(row => row.selected);
    const validRows = selectedRows.filter(parsedTradeCanSave);
    const blockedRows = selectedRows.length - validRows.length;

    if (validRows.length === 0) {
      setAiParseSummary({
        tone: "warning",
        title: "Needs Review",
        messages: ["Select at least one parsed trade with symbol, side, and an entry or exit price before saving."],
      });
      return;
    }

    setAiSaving(true);
    try {
      for (const row of validRows) {
        await saveTrade(parsedTradeToJournalTrade(row));
      }
      setAiParsedTrades(prev => prev.map(row => (
        validRows.some(saved => saved.client_id === row.client_id)
          ? { ...row, selected: false, saved: true }
          : row
      )));
      setAiParseSummary({
        tone: blockedRows > 0 ? "warning" : "success",
        title: "AI Trades Saved",
        metrics: [
          ["Saved", validRows.length],
          ["Still Needs Review", blockedRows],
        ],
        messages: [
          storageMode === "supabase" || storageStatus?.signedIn === true
            ? "Saved to Supabase and verified."
            : "Saved to localStorage.",
          ...(blockedRows > 0 ? ["Some selected rows still need required fields before saving."] : []),
        ],
      });
    } finally {
      setAiSaving(false);
    }
  }, [aiParsedTrades, saveTrade, storageMode, storageStatus]);

  const handleSmartImportFile = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setSmartImporting(true);
    setSmartImportSummary(null);
    setSmartImportRows([]);
    setSmartImportMapping({});

    try {
      const result = await importTradesFromFile(file);
      const parsedRows = Array.isArray(result?.trades) ? result.trades : [];
      const mapping = result?.column_mapping || {};
      const hasUsableData = parsedRows.length > 0 && Object.keys(mapping).length > 0;

      if (!hasUsableData) {
        setSmartImportSummary({
          tone: "error",
          title: "Smart Import Failed",
          messages: [
            "Import failed. No trades could be extracted from this file.",
            ...((result?.warnings || []).map(String)),
          ],
        });
        return;
      }

      const previewRows = parsedRows.map((trade, index) => ({
        ...trade,
        client_id: `smart-${Date.now()}-${index}`,
        selected: parsedTradeCanSave(trade),
        needs_review: parsedTradeNeedsReview(trade),
      }));
      setSmartImportRows(previewRows);
      setSmartImportMapping(mapping);
      const fallbackNotice = result?.llm_enabled === false
        ? ["Column mapping was produced by deterministic fallback — Gemini was unavailable. Review mapped columns before saving."]
        : [];
      setSmartImportSummary({
        tone: result?.llm_enabled === false ? "warning" : "success",
        title: result?.llm_enabled === false ? "Deterministic Fallback Used" : "Smart Import Parsed",
        metrics: [
          ["Preview Rows", previewRows.length],
          ["Needs Review", previewRows.filter(parsedTradeNeedsReview).length],
          ["Gemini Enabled", String(result?.llm_enabled === true)],
        ],
        messages: [
          ...fallbackNotice,
          ...buildColumnMappingMessages(mapping),
          ...((result?.warnings || []).map(String)),
          ...previewRows.flatMap(row => parsedTradeIssues(row)).slice(0, 5),
        ],
      });
    } catch (error) {
      setSmartImportSummary({
        tone: "error",
        title: "Smart Import Failed",
        messages: [String(error?.message || error || "Could not import this file.")],
      });
    } finally {
      setSmartImporting(false);
      if (smartImportInputRef.current) smartImportInputRef.current.value = "";
    }
  }, []);

  const updateSmartImportRow = useCallback((clientId, field, value) => {
    setSmartImportRows(prev => prev.map(row => {
      if (row.client_id !== clientId) return row;
      const next = { ...row, [field]: value };
      next.needs_review = parsedTradeNeedsReview(next);
      if (field === "selected") next.selected = value;
      return next;
    }));
  }, []);

  const saveSelectedSmartImportRows = useCallback(async () => {
    const selectedRows = smartImportRows.filter(row => row.selected);
    const validRows = selectedRows.filter(parsedTradeCanSave);
    const blockedRows = selectedRows.length - validRows.length;

    if (validRows.length === 0) {
      setSmartImportSummary({
        tone: "warning",
        title: "Needs Review",
        messages: ["Select at least one imported trade with symbol, side, and an entry or exit price before saving."],
      });
      return;
    }

    setSmartImportSaving(true);
    try {
      for (const row of validRows) {
        await saveTrade(parsedTradeToJournalTrade(row));
      }
      setSmartImportRows(prev => prev.map(row => (
        validRows.some(saved => saved.client_id === row.client_id)
          ? { ...row, selected: false, saved: true }
          : row
      )));
      setSmartImportSummary({
        tone: blockedRows > 0 ? "warning" : "success",
        title: "Smart Import Saved",
        metrics: [
          ["Saved", validRows.length],
          ["Still Needs Review", blockedRows],
        ],
        messages: [
          storageMode === "supabase" || storageStatus?.signedIn === true
            ? "Saved to Supabase and verified."
            : "Saved to localStorage.",
          ...(blockedRows > 0 ? ["Some selected rows still need required fields before saving."] : []),
        ],
      });
    } catch (error) {
      setSmartImportSummary({
        tone: "error",
        title: "Smart Import Save Failed",
        messages: [String(error?.message || error || "Could not save selected imported trades.")],
      });
    } finally {
      setSmartImportSaving(false);
    }
  }, [saveTrade, smartImportRows, storageMode, storageStatus]);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setEditingTrade(null);
  }, []);

  const openEdit = useCallback((trade) => {
    setEditingTrade(trade);
    setShowModal(true);
  }, []);

  const deleteTrade = useCallback((id) => {
    setTrades(prev => prev.filter(t => t.id !== id));
    deleteJournalTradeFromStorage(id).then((result) => {
      setStorageMode(result.mode);
      setStorageStatus(result);
    });
  }, []);

  const handleImportFile = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportSummary(null);
    setClearSummary(null);

    try {
      const rows = await parseJournalImportFile(file);
      const importedTrades = [];
      const validationErrors = [];
      let skippedCount = 0;

      rows.forEach((row, index) => {
        const { trade, error } = normalizeImportedTrade(row, index);
        if (error) {
          validationErrors.push(error);
          skippedCount += 1;
        } else if (trade) {
          importedTrades.push(trade);
        } else {
          skippedCount += 1;
        }
      });

      const existing = trades.map((trade, index) => normalizeTrade(trade, index));
      const { merged, updatedCount } = mergeImportedTrades(existing, importedTrades);
      const syntheticImported = importedTrades.some(isSyntheticTrade);
      let saveWarning = "";

      if (importedTrades.length > 0) {
        const saveResult = await saveJournalTradesToStorage(merged);
        setStorageMode(saveResult.mode);
        setStorageStatus(saveResult);
        if (saveResult.lastSaveErrorMessage) {
          saveWarning = `Supabase save failed: ${saveResult.lastSaveErrorMessage}. Saved to localStorage instead.`;
          suppressNextSaveRef.current = true;
          setTrades(merged);
          setPage(0);
        } else if (saveResult.mode === "supabase") {
          const loadResult = await loadJournalTradesFromStorage();
          setStorageMode(loadResult.mode);
          setStorageStatus(loadResult);
          suppressNextSaveRef.current = true;
          setTrades((loadResult.trades || []).map((trade, index) => normalizeTrade(trade, index)));
          setPage(0);
        } else {
          suppressNextSaveRef.current = true;
          setTrades(merged);
          setPage(0);
        }
      }

      setImportSummary({
        importedCount: importedTrades.length,
        updatedCount,
        skippedCount,
        loadedCount: getSupabasePersistenceDiagnostic().loadedRowCount ?? (importedTrades.length > 0 ? merged.length : trades.length),
        validationErrors,
        syntheticImported,
        saveWarning,
        error: "",
      });
    } catch (error) {
      setImportSummary({
        importedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        validationErrors: [String(error?.message || error || "Import failed.")],
        syntheticImported: false,
        error: "Import failed.",
      });
    } finally {
      setImporting(false);
      if (event.target) event.target.value = "";
    }
  }, [trades]);

  const clearLocalDataset = useCallback(() => {
    const result = clearLocalJournalStorage();
    setStorageMode(result.mode);
    setStorageStatus(result);
    suppressNextSaveRef.current = true;
    setTrades([]);
    setPage(0);
    setLargeLocalDatasetCount(0);
    setShowClearModal(false);
    setClearSummary({
      tone: result.lastSaveErrorMessage ? "error" : "success",
      title: result.lastSaveErrorMessage ? "Clear Local Dataset Failed" : "Local Dataset Cleared",
      messages: result.lastSaveErrorMessage ? [result.lastSaveErrorMessage] : ["Local journal, trader profile, and analysis history data were removed from this browser."],
    });
  }, []);

  const clearLocalAndSupabaseDataset = useCallback(async () => {
    setClearingDataset(true);
    setClearSummary(null);

    try {
      const supabaseResult = await clearSupabaseJournalTrades();
      setStorageMode(supabaseResult.mode);
      setStorageStatus(supabaseResult);

      if (supabaseResult.lastSaveErrorMessage) {
        setClearSummary({
          tone: "error",
          title: "Clear Supabase Dataset Failed",
          messages: [supabaseResult.lastSaveErrorMessage, "No local data was cleared."],
        });
        return;
      }

      const localResult = clearLocalJournalStorage();
      setStorageStatus({ ...localResult, lastLoadTarget: supabaseResult.lastLoadTarget ?? "supabase", loadedRowCount: 0 });
      suppressNextSaveRef.current = true;
      setTrades([]);
      setPage(0);
      setLargeLocalDatasetCount(0);
      setShowClearModal(false);
      setClearSummary({
        tone: localResult.lastSaveErrorMessage ? "warning" : "success",
        title: localResult.lastSaveErrorMessage ? "Supabase Cleared, Local Clear Failed" : "Local And Supabase Dataset Cleared",
        messages: localResult.lastSaveErrorMessage
          ? [localResult.lastSaveErrorMessage]
          : ["Supabase journal_trades and local browser journal data were cleared."],
      });
    } finally {
      setClearingDataset(false);
    }
  }, []);

  const exportRealTradesJSON = useCallback(() => {
    const localTrades = loadRawStoredTrades();
    const { realTrades, syntheticTrades } = splitRealAndSyntheticTrades(localTrades);

    setRealExportSummary({
      totalLocalTrades: localTrades.length,
      realTradesExported: realTrades.length,
      syntheticTradesExcluded: syntheticTrades.length,
      downloaded: realTrades.length > 0,
    });

    if (realTrades.length === 0) return;

    downloadJSON(realTrades, `bullcast_real_journal_trades_${dateStamp()}.json`);
  }, []);

  const exportMlDatasetJSON = useCallback(async () => {
    const localTrades = loadRawStoredTrades();
    const { realTrades, syntheticTrades } = splitRealAndSyntheticTrades(localTrades);

    setMlDatasetExportSummary(null);

    if (realTrades.length === 0) {
      setMlDatasetExportSummary({
        totalLocalTrades: localTrades.length,
        realTradesSent: 0,
        syntheticTradesExcluded: syntheticTrades.length,
        readinessLevel: "-",
        readyForTraining: "-",
        score: "-",
        downloaded: false,
        error: "",
        messages: ["No real trades found. ML dataset export requires real/paper journal trades."],
      });
      return;
    }

    setMlDatasetExporting(true);

    try {
      const dataset = await exportTradeDataset(realTrades, { include_edgar: false });
      const qualityGate = dataset?.quality_gate && typeof dataset.quality_gate === "object" ? dataset.quality_gate : {};
      const readinessLevel = String(qualityGate.readiness_level || "-");
      const readyForTraining = qualityGate.ready_for_training === true;
      const readyForReview = ["baseline_ready", "strong_ready"].includes(readinessLevel);

      downloadJSON(
        dataset,
        `bullcast_real_ml_dataset_${dateStamp()}.json`
      );

      setMlDatasetExportSummary({
        totalLocalTrades: localTrades.length,
        realTradesSent: realTrades.length,
        syntheticTradesExcluded: syntheticTrades.length,
        readinessLevel,
        readyForTraining,
        score: qualityGate.score ?? "-",
        downloaded: true,
        error: "",
        messages: [
          readyForReview
            ? "Dataset is ready for cautious baseline training review."
            : "Dataset exported, but training should remain blocked until the quality gate passes.",
          "This exports a dataset for ML readiness review only. It does not train a model.",
        ],
      });
    } catch (error) {
      setMlDatasetExportSummary({
        totalLocalTrades: localTrades.length,
        realTradesSent: realTrades.length,
        syntheticTradesExcluded: syntheticTrades.length,
        readinessLevel: "-",
        readyForTraining: "-",
        score: "-",
        downloaded: false,
        error: String(error?.message || error || "ML dataset export failed."),
        messages: [
          String(error?.message || error || "ML dataset export failed."),
          "This exports a dataset for ML readiness review only. It does not train a model.",
        ],
      });
    } finally {
      setMlDatasetExporting(false);
    }
  }, []);

  const toggleSort = (col) => {
    setPage(0);
    if (sortCol === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir(col === "date" || col === "created_at" ? "desc" : "asc");
    }
  };

  const sorted = useMemo(() => {
    return sortJournalTrades(trades, sortCol, sortDir);
  }, [trades, sortCol, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / JOURNAL_PAGE_SIZE));
  const visibleTrades = sorted.slice(page * JOURNAL_PAGE_SIZE, (page + 1) * JOURNAL_PAGE_SIZE);
  const filtersActive = false;
  const debugReport = useMemo(() => buildJournalDebugReport({
    status: storageStatus,
    authEmail,
    storageMode,
    trades,
    visibleTrades,
    sortedTrades: sorted,
    page,
    sortCol,
    sortDir,
    lastSavedTradeId,
  }), [authEmail, lastSavedTradeId, page, sortCol, sortDir, sorted, storageMode, storageStatus, trades, visibleTrades]);

  const copyDebugReport = useCallback(async () => {
    const text = JSON.stringify(debugReport, null, 2);
    setDebugReportText(text);
    setDebugCopyMessage("");

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setDebugCopyMessage("Debug report copied.");
      } else {
        setDebugCopyMessage("Clipboard unavailable. Debug report shown below.");
      }
    } catch {
      setDebugCopyMessage("Clipboard blocked. Debug report shown below.");
    }
  }, [debugReport]);

  const findLatestSavedTrade = useCallback(async () => {
    const targetId = String(lastSavedTradeId || storageStatus?.saveTradeId || readLastSavedTradeId() || "").trim();
    if (!targetId) {
      setSaveNotice({
        type: "warning",
        message: "No saved trade id is available yet.",
      });
      return;
    }

    setLastSavedTradeId(targetId);
    persistLastSavedTradeId(targetId);
    setSortCol("created_at");
    setSortDir("desc");

    const loadedRows = tradesRef.current.map((trade, index) => normalizeTrade(trade, index));
    const sortedLoadedRows = sortJournalTrades(loadedRows, "created_at", "desc");
    let foundPage = getTradePageForId(sortedLoadedRows, targetId, JOURNAL_PAGE_SIZE);

    if (foundPage.index >= 0) {
      setPage(foundPage.pageIndex);
      setStorageStatus(prev => ({
        ...(prev || getSupabasePersistenceDiagnostic()),
        currentPage: foundPage.pageIndex + 1,
        sortField: "created_at",
        sortDirection: "desc",
        postSaveVisibleInTable: true,
      }));
      setSaveNotice({
        type: "success",
        message: `Saved trade found on page ${foundPage.pageIndex + 1}.`,
      });
      return;
    }

    const exactResult = await loadJournalTradeByIdFromSupabase(targetId);
    const exactTrade = exactResult.trades?.[0] ? normalizeTrade(exactResult.trades[0]) : null;

    if (exactTrade) {
      const mergedTrades = mergeVerifiedTradeAtTop(loadedRows, exactTrade);
      const sortedMergedRows = sortJournalTrades(mergedTrades, "created_at", "desc");
      foundPage = getTradePageForId(sortedMergedRows, targetId, JOURNAL_PAGE_SIZE);
      const targetPage = foundPage.pageIndex >= 0 ? foundPage.pageIndex : 0;
      suppressNextSaveRef.current = true;
      tradesRef.current = mergedTrades;
      setTrades(mergedTrades);
      setStorageMode(exactResult.mode);
      setPage(targetPage);
      setStorageStatus(prev => ({
        ...(prev || getSupabasePersistenceDiagnostic()),
        lastLoadTarget: exactResult.lastLoadTarget,
        lastLoadErrorMessage: exactResult.lastLoadErrorMessage,
        loadedRowCount: mergedTrades.length,
        currentPage: targetPage + 1,
        sortField: "created_at",
        sortDirection: "desc",
        verifiedRowFound: true,
        verifiedRowUserIdMatches: true,
        postSaveVisibleInTable: true,
      }));
      setSaveNotice({
        type: "success",
        message: "Saved to Supabase and verified. Exact lookup restored the saved trade.",
      });
      return;
    }

    setStorageStatus(prev => ({
      ...(prev || getSupabasePersistenceDiagnostic()),
      lastLoadTarget: exactResult.lastLoadTarget,
      lastLoadErrorMessage: exactResult.lastLoadErrorMessage || "Exact Supabase lookup did not return the saved trade id for this user.",
      verifiedRowFound: false,
      verifiedRowUserIdMatches: false,
      postSaveVisibleInTable: false,
      currentPage: page + 1,
      sortField: "created_at",
      sortDirection: "desc",
    }));
    setSaveNotice({
      type: "warning",
      message: "Saved trade was not found in loaded rows or by exact Supabase lookup for this user.",
    });
  }, [lastSavedTradeId, page, storageStatus]);

  // Summary calculations
  const summary = useMemo(() => {
    if (trades.length === 0) return null;
    const wins = trades.filter(t => t.result === "WIN").length;
    const pnlValues = trades.map(t => Number(t.pnl)).filter(Number.isFinite);
    const netPnl = pnlValues.reduce((s, value) => s + value, 0);
    const best = pnlValues.length ? Math.max(...pnlValues) : 0;
    const worst = pnlValues.length ? Math.min(...pnlValues) : 0;
    const winRate = (wins / trades.length) * 100;
    return { total: trades.length, winRate, netPnl, best, worst };
  }, [trades]);

  const sortArrow = (col) => {
    if (sortCol !== col) return "";
    return sortDir === "asc" ? " ^" : " v";
  };

  const totalPnl = trades.reduce((s, t) => {
    const pnl = Number(t.pnl);
    return s + (Number.isFinite(pnl) ? pnl : 0);
  }, 0);
  const storageDisplayMode = storageMode === "supabase"
    ? "supabase"
    : storageStatus?.signedIn === true && storageStatus?.lastSaveErrorMessage
      ? "fallback"
      : "local";

  return (
    <div style={{ minHeight: "100%", padding: "24px", maxWidth: 1280, margin: "0 auto" }}>
      {/* Page Header */}
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 16, marginBottom: 24 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.7rem", color: "#C8F135", letterSpacing: "0.16em", textTransform: "uppercase" }}>
              Personal
            </div>
            <StorageStatus
              mode={storageDisplayMode}
              email={authEmail}
              onSignIn={storageStatus?.supabaseConfigured === true && storageDisplayMode === "local" ? () => navigate("/login") : undefined}
            />
          </div>
          <h1 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "clamp(2rem,5vw,3.5rem)", color: "#e5e5e5", margin: 0, letterSpacing: "0.04em", lineHeight: 1 }}>
            Trade Journal
          </h1>
          <details style={{ marginTop: 6 }}>
            <summary style={{
              cursor: "pointer",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.62rem",
              color: "#888899",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}>
              Storage details
            </summary>
            <StorageDebugStatus
              status={storageStatus}
              debugReportText={debugReportText}
              debugCopyMessage={debugCopyMessage}
              onCopyDebugReport={copyDebugReport}
            />
          </details>
          {storageMode !== "supabase" && storageStatus?.supabaseConfigured === true && (
            <div style={{
              marginTop: 6,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.64rem",
              color: "#FFB84D",
              lineHeight: 1.5,
            }}>
              Local demo mode uses this browser only. Sign in to enable Supabase cloud sync.
            </div>
          )}
          {saveNotice && (
            <div style={{
              marginTop: 8,
              padding: "8px 10px",
              borderRadius: 4,
              border: saveNotice.type === "success" ? "1px solid rgba(0,255,135,0.22)" : "1px solid rgba(255,184,77,0.28)",
              background: saveNotice.type === "success" ? "rgba(0,255,135,0.06)" : "rgba(255,184,77,0.08)",
              color: saveNotice.type === "success" ? "#00FF87" : "#FFB84D",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.68rem",
              lineHeight: 1.5,
            }}>
              {saveNotice.message}
            </div>
          )}
          {(lastSavedTradeId || storageStatus?.saveTradeId) && (
            <button
              onClick={findLatestSavedTrade}
              disabled={loadingJournal}
              style={{
                marginTop: 8,
                padding: "8px 10px",
                borderRadius: 4,
                border: "1px solid rgba(200,241,53,0.22)",
                background: "rgba(200,241,53,0.06)",
                color: loadingJournal ? "#555566" : "#C8F135",
                cursor: loadingJournal ? "not-allowed" : "pointer",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "0.66rem",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              Find latest saved trade
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            ref={importInputRef}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleImportFile}
            style={{ display: "none" }}
          />
          <button onClick={() => importInputRef.current?.click()}
            disabled={importing || loadingJournal}
            style={{
              padding: "10px 18px", borderRadius: 4, cursor: importing || loadingJournal ? "not-allowed" : "pointer",
              background: "transparent", border: "1px solid rgba(200,241,53,0.25)",
              color: importing || loadingJournal ? "#555566" : "#C8F135", fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.72rem", letterSpacing: "0.06em", transition: "all 0.15s",
              opacity: importing || loadingJournal ? 0.65 : 1,
            }}
          >
            {importing ? "Importing..." : loadingJournal ? "Loading..." : "Import CSV/XLSX"}
          </button>
          <button onClick={() => setShowClearModal(true)}
            style={{
              padding: "10px 18px", borderRadius: 4, cursor: "pointer",
              background: "rgba(255,59,59,0.06)", border: "1px solid rgba(255,59,59,0.24)",
              color: "#FF6B6B", fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.72rem", letterSpacing: "0.06em", transition: "all 0.15s",
            }}
          >
            Clear Current Dataset
          </button>
          {trades.length > 0 && (
            <button onClick={() => downloadCSV(trades)}
              style={{
              padding: "10px 22px", borderRadius: 4, cursor: "pointer",
                background: "transparent", border: "1px solid rgba(200,241,53,0.25)",
                color: "#C8F135", fontFamily: "'JetBrains Mono', monospace",
                fontSize: "0.78rem", letterSpacing: "0.08em", transition: "all 0.15s",
              }}
            >
              Export CSV
            </button>
          )}
          <button onClick={exportRealTradesJSON}
            style={{
              padding: "10px 18px", borderRadius: 4, cursor: "pointer",
              background: "rgba(255,184,77,0.06)", border: "1px solid rgba(255,184,77,0.26)",
              color: "#FFB84D", fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.72rem", letterSpacing: "0.06em", transition: "all 0.15s",
            }}
          >
            Export Real Trades JSON
          </button>
          <button onClick={exportMlDatasetJSON}
            disabled={mlDatasetExporting}
            style={{
              padding: "10px 18px", borderRadius: 4, cursor: mlDatasetExporting ? "not-allowed" : "pointer",
              background: "rgba(200,241,53,0.08)", border: "1px solid rgba(200,241,53,0.28)",
              color: mlDatasetExporting ? "#555566" : "#C8F135", fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.72rem", letterSpacing: "0.06em", transition: "all 0.15s",
              opacity: mlDatasetExporting ? 0.65 : 1,
            }}
          >
            {mlDatasetExporting ? "Exporting..." : "Export ML Dataset JSON"}
          </button>
          <button
            onClick={() => { setEditingTrade(null); setShowModal(true); }}
            disabled={loadingJournal || savingTrade}
            style={{
              padding: "10px 22px", borderRadius: 4, cursor: loadingJournal || savingTrade ? "not-allowed" : "pointer",
              background: "#C8F135", border: "none", color: "#060608",
              fontFamily: "'Bebas Neue', sans-serif", fontSize: "1rem",
              letterSpacing: "0.06em", transition: "all 0.15s",
              opacity: loadingJournal || savingTrade ? 0.65 : 1,
            }}
          >
            {savingTrade ? "Saving..." : "+ Add Trade"}
          </button>
        </div>
      </div>

      <AITradeEntryPanel
        text={aiTradeText}
        parsedTrades={aiParsedTrades}
        parsing={aiParsing}
        saving={aiSaving}
        summary={aiParseSummary}
        onTextChange={setAiTradeText}
        onParse={parseAiTradeEntry}
        onUpdateRow={updateAiParsedTrade}
        onSaveSelected={saveSelectedAiTrades}
      />

      <SmartImportPanel
        inputRef={smartImportInputRef}
        parsedTrades={smartImportRows}
        importing={smartImporting}
        saving={smartImportSaving}
        summary={smartImportSummary}
        columnMapping={smartImportMapping}
        onFileChange={handleSmartImportFile}
        onUpdateRow={updateSmartImportRow}
        onSaveSelected={saveSelectedSmartImportRows}
      />

      <div style={{
        marginBottom: 16,
        padding: "10px 12px",
        background: "rgba(255,184,77,0.06)",
        border: "1px solid rgba(255,184,77,0.18)",
        borderRadius: 4,
        color: "#FFB84D",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "0.68rem",
        lineHeight: 1.5,
      }}>
        Real training should use only real/paper journal trades. Synthetic rows are for development pipeline testing only.
        {" "}This exports a dataset for ML readiness review only. It does not train a model.
      </div>

      {loadingJournal && (
        <JournalActionSummary
          tone="success"
          title="Loading Journal"
          messages={["Loading journal rows from Supabase before using any local fallback."]}
        />
      )}

      {filtersActive && (
        <JournalActionSummary
          tone="warning"
          title="Filters Active"
          messages={["Some trades may be hidden by filters."]}
        />
      )}

      {largeLocalDatasetCount > LARGE_LOCAL_DATASET_THRESHOLD && (
        <JournalActionSummary
          tone="warning"
          title="Large Local Dataset Detected"
          metrics={[["Local Rows", largeLocalDatasetCount]]}
          messages={["Large local dataset detected. This may slow down the browser. Clear local dataset after confirming Supabase sync."]}
        />
      )}

      {clearSummary && (
        <JournalActionSummary
          tone={clearSummary.tone}
          title={clearSummary.title}
          messages={clearSummary.messages}
        />
      )}

      {importSummary && (
        <JournalActionSummary
          tone={importSummary.error ? "error" : importSummary.syntheticImported ? "warning" : "success"}
          title={importSummary.error || "Import Summary"}
          metrics={[
            ["Imported", importSummary.importedCount],
            ["Updated", importSummary.updatedCount],
            ["Skipped", importSummary.skippedCount],
            ["Loaded Rows", importSummary.loadedCount ?? trades.length],
          ]}
          messages={[
            ...(importSummary.syntheticImported ? ["Synthetic/sample trades are for development only. Use real journal history for real model training."] : []),
            ...(importSummary.saveWarning ? [importSummary.saveWarning] : []),
            ...importSummary.validationErrors.slice(0, 6),
            ...(importSummary.validationErrors.length > 6 ? [`${importSummary.validationErrors.length - 6} more validation errors.`] : []),
          ]}
        />
      )}

      {storageStatus?.lastSaveErrorMessage && (
        <JournalActionSummary
          tone="warning"
          title="Supabase Save Fallback"
          metrics={[
            ["Configured", String(storageStatus.supabaseConfigured === true)],
            ["Last Save Target", storageStatus.lastSaveTarget || formatStorageMode(storageMode)],
            ["Rows Attempted", storageStatus.rowsAttempted ?? 0],
          ]}
          messages={[
            `Supabase save failed: ${storageStatus.lastSaveErrorMessage}`,
            "Bullcast saved the latest journal data to localStorage instead.",
          ]}
        />
      )}

      {realExportSummary && (
        <JournalActionSummary
          tone={realExportSummary.downloaded ? "success" : "error"}
          title={realExportSummary.downloaded ? "Real Trades Export Summary" : "No real trades found. Synthetic/dev rows were excluded."}
          metrics={[
            ["Total Local Trades", realExportSummary.totalLocalTrades],
            ["Real Trades Exported", realExportSummary.realTradesExported],
            ["Synthetic Excluded", realExportSummary.syntheticTradesExcluded],
          ]}
        />
      )}

      {mlDatasetExportSummary && (
        <JournalActionSummary
          tone={mlDatasetExportSummary.error ? "error" : mlDatasetExportSummary.downloaded ? "success" : "warning"}
          title={mlDatasetExportSummary.error ? "ML Dataset Export Failed" : mlDatasetExportSummary.downloaded ? "ML Dataset Export Summary" : "No real trades found. ML dataset export requires real/paper journal trades."}
          metrics={[
            ["Total Local Trades", mlDatasetExportSummary.totalLocalTrades],
            ["Real Trades Sent", mlDatasetExportSummary.realTradesSent],
            ["Synthetic Excluded", mlDatasetExportSummary.syntheticTradesExcluded],
            ["Readiness Level", mlDatasetExportSummary.readinessLevel],
            ["Ready For Training", String(mlDatasetExportSummary.readyForTraining)],
            ["Gate Score", mlDatasetExportSummary.score],
          ]}
          messages={mlDatasetExportSummary.messages || []}
        />
      )}

      {/* Summary Strip */}
      {summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
          <SummaryCard label="Total Trades" value={summary.total} />
          <SummaryCard label="Win Rate"
            value={`${summary.winRate.toFixed(1)}%`}
            color={summary.winRate >= 60 ? "#00FF87" : summary.winRate >= 40 ? "#C8F135" : "#FF3B3B"} />
          <SummaryCard label="Net P&L"
            value={formatCurrency(summary.netPnl)}
            color={summary.netPnl >= 0 ? "#00FF87" : "#FF3B3B"} />
          <SummaryCard label="Best Trade" value={formatCurrency(summary.best)} color="#00FF87" />
          <SummaryCard label="Worst Trade" value={formatCurrency(summary.worst)} color="#FF3B3B" />
        </div>
      )}

      {/* Trade Table or Empty State */}
      {trades.length === 0 ? (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          padding: "80px 20px", textAlign: "center",
        }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "2.2rem", marginBottom: 16, opacity: 0.3 }}>JOURNAL</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.9rem", color: "#555566", marginBottom: 8 }}>
            No trades logged yet.
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.75rem", color: "#333344", marginBottom: 20 }}>
            Click + Add Trade to record your first trade.
          </div>
          <button
            onClick={() => { setEditingTrade(null); setShowModal(true); }}
            disabled={loadingJournal || savingTrade}
            style={{
              padding: "10px 24px", borderRadius: 4, cursor: loadingJournal || savingTrade ? "not-allowed" : "pointer",
              background: "#C8F135", border: "none", color: "#060608",
              fontFamily: "'Bebas Neue', sans-serif", fontSize: "1rem",
              letterSpacing: "0.08em",
              opacity: loadingJournal || savingTrade ? 0.65 : 1,
            }}
          >
            {savingTrade ? "Saving..." : "+ Add Trade"}
          </button>
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1080 }}>
            <thead>
              <tr>
                <Th>#</Th>
                <Th sortable onClick={() => toggleSort("date")}>Date{sortArrow("date")}</Th>
                <Th sortable onClick={() => toggleSort("symbol")}>Symbol{sortArrow("symbol")}</Th>
                <Th>Type</Th>
                <Th align="right">Entry ₹</Th>
                <Th align="right">Exit ₹</Th>
                <Th align="right">Qty</Th>
                <Th sortable align="right" onClick={() => toggleSort("pnl")}>P&L{sortArrow("pnl")}</Th>
                <Th sortable onClick={() => toggleSort("result")}>Result{sortArrow("result")}</Th>
                <Th>Labels</Th>
                <Th>Notes</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {visibleTrades.map((t, i) => (
                <tr key={t.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(200,241,53,0.02)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <Td style={{ color: "#333344" }}>{page * JOURNAL_PAGE_SIZE + i + 1}</Td>
                  <Td>{t.date}</Td>
                  <Td style={{ fontWeight: 700, color: "#e5e5e5" }}>{t.symbol}</Td>
                  <Td style={{ fontWeight: 700, color: t.type === "LONG" ? "#C8F135" : "#FF3B3B" }}>{t.type}</Td>
                  <Td align="right">{formatNumber(t.entry_price)}</Td>
                  <Td align="right">{formatNumber(t.exit_price)}</Td>
                  <Td align="right">{formatNumber(t.quantity, 0)}</Td>
                  <Td align="right" style={{ fontWeight: 700, color: Number(t.pnl) >= 0 ? "#00FF87" : "#FF3B3B" }}>
                    {formatCurrency(t.pnl)}
                  </Td>
                  <Td>
                    <span style={{
                      padding: "2px 8px", borderRadius: 3,
                      fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem",
                      textTransform: "uppercase", fontWeight: 700,
                      background: t.result === "WIN" ? "rgba(0,255,135,0.1)" : t.result === "LOSS" ? "rgba(255,59,59,0.1)" : "rgba(255,255,255,0.04)",
                      border: t.result === "WIN" ? "1px solid rgba(0,255,135,0.25)" : t.result === "LOSS" ? "1px solid rgba(255,59,59,0.25)" : "1px solid rgba(255,255,255,0.08)",
                      color: t.result === "WIN" ? "#00FF87" : t.result === "LOSS" ? "#FF3B3B" : "#555566",
                    }}>
                      {t.result || "-"}
                    </span>
                  </Td>
                  <Td>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 180 }}>
                      {t.setup_tag ? <TagBadge label={formatTag(t.setup_tag)} color="#C8F135" /> : null}
                      {t.mistake_tag && t.mistake_tag !== "none" ? <TagBadge label={formatTag(t.mistake_tag)} color="#FF3B3B" /> : null}
                      {!t.setup_tag && (!t.mistake_tag || t.mistake_tag === "none") ? <span style={{ color: "#333344" }}>-</span> : null}
                    </div>
                  </Td>
                  <Td style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#444466" }}>
                    {t.notes || "-"}
                  </Td>
                  <Td>
                    <button onClick={() => openEdit(t)}
                      style={{
                        background: "none", border: "1px solid rgba(200,241,53,0.08)", borderRadius: 4,
                        cursor: "pointer", padding: "3px 6px", color: "#444466", marginRight: 6,
                        fontFamily: "'JetBrains Mono', monospace", fontSize: "0.62rem", letterSpacing: "0.08em",
                        lineHeight: 1, transition: "all 0.15s",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.color = "#C8F135"; e.currentTarget.style.borderColor = "rgba(200,241,53,0.25)"; }}
                      onMouseLeave={e => { e.currentTarget.style.color = "#444466"; e.currentTarget.style.borderColor = "rgba(200,241,53,0.08)"; }}
                    >
                      EDIT
                    </button>
                    <button onClick={() => deleteTrade(t.id)}
                      style={{
                        background: "none", border: "none", cursor: "pointer", padding: 4,
                        color: "#333344", fontSize: "0.9rem", lineHeight: 1, transition: "color 0.15s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.color = "#FF3B3B"}
                      onMouseLeave={e => e.currentTarget.style.color = "#333344"}
                    >
                      x
                    </button>
                  </Td>
                </tr>
              ))}
              {/* Totals Row */}
              <tr style={{ borderTop: "1px solid rgba(200,241,53,0.1)", background: "rgba(200,241,53,0.02)" }}>
                <Td style={{ fontWeight: 700, color: "#C8F135", fontFamily: "'Bebas Neue', sans-serif", fontSize: "1rem" }}>TOTAL</Td>
                <Td colSpan={6}></Td>
                <Td align="right" style={{ fontWeight: 700, color: totalPnl >= 0 ? "#00FF87" : "#FF3B3B" }}>
                  {formatCurrency(totalPnl)}
                </Td>
                <Td colSpan={4}></Td>
              </tr>
            </tbody>
          </table>
          {pageCount > 1 && (
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              padding: "14px 0 0",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.68rem",
              color: "#555566",
            }}>
              <span>
                Showing {page * JOURNAL_PAGE_SIZE + 1}-{Math.min((page + 1) * JOURNAL_PAGE_SIZE, sorted.length)} of {sorted.length}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  style={paginationButtonStyle(page === 0)}
                >
                  Prev
                </button>
                <button
                  onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                  disabled={page >= pageCount - 1}
                  style={paginationButtonStyle(page >= pageCount - 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {showModal && <AddTradeModal onClose={closeModal} onSave={saveTrade} initialTrade={editingTrade} />}
      {showClearModal && (
        <ClearDatasetModal
          clearing={clearingDataset}
          supabaseSyncAvailable={storageStatus?.signedIn === true && storageMode === "supabase"}
          onClose={() => setShowClearModal(false)}
          onClearLocal={clearLocalDataset}
          onClearAll={clearLocalAndSupabaseDataset}
        />
      )}
    </div>
  );
}

// --- Utility sub-components ---
function AITradeEntryPanel({
  text,
  parsedTrades,
  parsing,
  saving,
  summary,
  onTextChange,
  onParse,
  onUpdateRow,
  onSaveSelected,
}) {
  const selectedCount = parsedTrades.filter(row => row.selected).length;

  return (
    <div style={{
      marginBottom: 18,
      padding: 14,
      background: "#0a0a0f",
      border: "1px solid rgba(200,241,53,0.12)",
      borderRadius: 4,
    }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        marginBottom: 10,
      }}>
        <div style={{
          color: "#C8F135",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "0.68rem",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}>
          AI Trade Entry
        </div>
        <button
          type="button"
          onClick={onParse}
          disabled={parsing || saving}
          style={paginationButtonStyle(parsing || saving)}
        >
          {parsing ? "Parsing..." : "Parse with Gemini"}
        </button>
      </div>
      <textarea
        value={text}
        onChange={event => onTextChange(event.target.value)}
        placeholder="Bought TATA at 820, sold at 842, qty 10. Breakout retest. Followed rules."
        style={{
          width: "100%",
          minHeight: 92,
          resize: "vertical",
          borderRadius: 4,
          border: "1px solid rgba(200,241,53,0.14)",
          background: "#060608",
          color: "#e5e5e5",
          padding: 10,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "0.72rem",
          lineHeight: 1.6,
          marginBottom: 10,
        }}
      />

      {summary && (
        <JournalActionSummary
          tone={summary.tone}
          title={summary.title}
          metrics={summary.metrics || []}
          messages={summary.messages || []}
        />
      )}

      {parsedTrades.length > 0 && (
        <>
          <div style={{ overflowX: "auto", marginTop: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1180 }}>
              <thead>
                <tr>
                  <Th>Select</Th>
                  <Th>Status</Th>
                  <Th>Date</Th>
                  <Th>Symbol</Th>
                  <Th>Side</Th>
                  <Th>Entry</Th>
                  <Th>Exit</Th>
                  <Th>Qty</Th>
                  <Th>Setup</Th>
                  <Th>Mistake</Th>
                  <Th>Rules</Th>
                  <Th>Risk</Th>
                  <Th>Reward</Th>
                  <Th>Notes</Th>
                </tr>
              </thead>
              <tbody>
                {parsedTrades.map((row) => {
                  const issues = parsedTradeIssues(row);
                  const canSave = parsedTradeCanSave(row);
                  return (
                    <tr key={row.client_id} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                      <Td>
                        <input
                          type="checkbox"
                          checked={row.selected === true}
                          disabled={row.saved === true}
                          onChange={event => onUpdateRow(row.client_id, "selected", event.target.checked)}
                        />
                      </Td>
                      <Td>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", maxWidth: 170 }}>
                          {row.saved ? <TagBadge label="Saved" color="#00FF87" /> : null}
                          {!row.saved && canSave && issues.length === 0 ? <TagBadge label="Ready" color="#00FF87" /> : null}
                          {!row.saved && issues.length > 0 ? <TagBadge label="Needs Review" color="#FFB84D" /> : null}
                          {issues.slice(0, 2).map(issue => <TagBadge key={issue} label={issue} color="#FFB84D" />)}
                        </div>
                      </Td>
                      <Td><AiCell value={row.date || ""} onChange={value => onUpdateRow(row.client_id, "date", value)} /></Td>
                      <Td><AiCell value={row.symbol || ""} onChange={value => onUpdateRow(row.client_id, "symbol", value.toUpperCase())} /></Td>
                      <Td>
                        <select
                          value={row.side || ""}
                          onChange={event => onUpdateRow(row.client_id, "side", event.target.value)}
                          style={aiInputStyle}
                        >
                          <option value="">Review</option>
                          <option value="LONG">LONG</option>
                          <option value="SHORT">SHORT</option>
                        </select>
                      </Td>
                      <Td><AiCell value={row.entry ?? ""} onChange={value => onUpdateRow(row.client_id, "entry", value)} /></Td>
                      <Td><AiCell value={row.exit ?? ""} onChange={value => onUpdateRow(row.client_id, "exit", value)} /></Td>
                      <Td><AiCell value={row.quantity ?? ""} onChange={value => onUpdateRow(row.client_id, "quantity", value)} /></Td>
                      <Td><AiCell value={row.setup_tag || row.setup || ""} onChange={value => onUpdateRow(row.client_id, "setup_tag", value)} /></Td>
                      <Td><AiCell value={row.mistake_tag || row.mistake || "none"} onChange={value => onUpdateRow(row.client_id, "mistake_tag", value)} /></Td>
                      <Td>
                        <select
                          value={row.rule_followed === true ? "true" : row.rule_followed === false ? "false" : ""}
                          onChange={event => onUpdateRow(row.client_id, "rule_followed", event.target.value === "" ? null : event.target.value === "true")}
                          style={aiInputStyle}
                        >
                          <option value="">Unknown</option>
                          <option value="true">Yes</option>
                          <option value="false">No</option>
                        </select>
                      </Td>
                      <Td><AiCell value={row.planned_risk ?? ""} onChange={value => onUpdateRow(row.client_id, "planned_risk", value)} /></Td>
                      <Td><AiCell value={row.planned_reward ?? ""} onChange={value => onUpdateRow(row.client_id, "planned_reward", value)} /></Td>
                      <Td><AiCell value={row.notes || ""} onChange={value => onUpdateRow(row.client_id, "notes", value)} wide /></Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
            <button
              type="button"
              onClick={onSaveSelected}
              disabled={saving || parsing || selectedCount === 0}
              style={paginationButtonStyle(saving || parsing || selectedCount === 0)}
            >
              {saving ? "Saving..." : `Save selected trades (${selectedCount})`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SmartImportPanel({
  inputRef,
  parsedTrades,
  importing,
  saving,
  summary,
  columnMapping,
  onFileChange,
  onUpdateRow,
  onSaveSelected,
}) {
  const selectedCount = parsedTrades.filter(row => row.selected).length;
  const mappingEntries = Object.entries(columnMapping || {});

  return (
    <div style={{
      marginBottom: 18,
      padding: 14,
      background: "#0a0a0f",
      border: "1px solid rgba(200,241,53,0.12)",
      borderRadius: 4,
    }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        marginBottom: 10,
      }}>
        <div style={{
          color: "#C8F135",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "0.68rem",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}>
          Smart Import
        </div>
        <span style={{
          color: "#555566",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "0.66rem",
        }}>
          {importing ? "Mapping columns..." : "CSV or XLSX"}
        </span>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={onFileChange}
        disabled={importing || saving}
        style={{
          width: "100%",
          borderRadius: 4,
          border: "1px solid rgba(200,241,53,0.14)",
          background: "#060608",
          color: "#e5e5e5",
          padding: 9,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "0.72rem",
          marginBottom: 10,
        }}
      />

      {summary && (
        <JournalActionSummary
          tone={summary.tone}
          title={summary.title}
          metrics={summary.metrics || []}
          messages={summary.messages || []}
        />
      )}

      {mappingEntries.length > 0 && (
        <div style={{
          marginTop: 10,
          marginBottom: 10,
          padding: 10,
          borderRadius: 4,
          border: "1px solid rgba(200,241,53,0.08)",
          background: "rgba(200,241,53,0.03)",
          color: "#888899",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "0.66rem",
          lineHeight: 1.7,
        }}>
          <div style={{ color: "#C8F135", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Column Mapping
          </div>
          {mappingEntries.map(([source, target]) => (
            <div key={source}>{source} -&gt; {target || "unmapped"}</div>
          ))}
        </div>
      )}

      <ParsedTradePreviewTable
        parsedTrades={parsedTrades}
        saving={saving}
        parsing={importing}
        selectedCount={selectedCount}
        onUpdateRow={onUpdateRow}
        onSaveSelected={onSaveSelected}
      />
    </div>
  );
}

function ParsedTradePreviewTable({
  parsedTrades,
  saving,
  parsing,
  selectedCount,
  onUpdateRow,
  onSaveSelected,
}) {
  if (parsedTrades.length === 0) return null;

  return (
    <>
      <div style={{ overflowX: "auto", marginTop: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1180 }}>
          <thead>
            <tr>
              <Th>Select</Th>
              <Th>Status</Th>
              <Th>Date</Th>
              <Th>Symbol</Th>
              <Th>Side</Th>
              <Th>Entry</Th>
              <Th>Exit</Th>
              <Th>Qty</Th>
              <Th>Setup</Th>
              <Th>Mistake</Th>
              <Th>Rules</Th>
              <Th>Risk</Th>
              <Th>Reward</Th>
              <Th>Notes</Th>
            </tr>
          </thead>
          <tbody>
            {parsedTrades.map((row) => {
              const issues = parsedTradeIssues(row);
              const canSave = parsedTradeCanSave(row);
              const needsReview = parsedTradeNeedsReview(row);
              return (
                <tr key={row.client_id} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                  <Td>
                    <input
                      type="checkbox"
                      checked={row.selected === true}
                      disabled={row.saved === true}
                      onChange={event => onUpdateRow(row.client_id, "selected", event.target.checked)}
                    />
                  </Td>
                  <Td>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", maxWidth: 170 }}>
                      {row.saved ? <TagBadge label="Saved" color="#00FF87" /> : null}
                      {!row.saved && canSave && !needsReview ? <TagBadge label="Ready" color="#00FF87" /> : null}
                      {!row.saved && needsReview ? <TagBadge label="Needs Review" color="#FFB84D" /> : null}
                      {issues.slice(0, 2).map(issue => <TagBadge key={issue} label={issue} color="#FFB84D" />)}
                    </div>
                  </Td>
                  <Td><AiCell value={row.date || ""} onChange={value => onUpdateRow(row.client_id, "date", value)} /></Td>
                  <Td><AiCell value={row.symbol || ""} onChange={value => onUpdateRow(row.client_id, "symbol", value.toUpperCase())} /></Td>
                  <Td>
                    <select
                      value={row.side || ""}
                      onChange={event => onUpdateRow(row.client_id, "side", event.target.value)}
                      style={aiInputStyle}
                    >
                      <option value="">Review</option>
                      <option value="LONG">LONG</option>
                      <option value="SHORT">SHORT</option>
                    </select>
                  </Td>
                  <Td><AiCell value={row.entry ?? ""} onChange={value => onUpdateRow(row.client_id, "entry", value)} /></Td>
                  <Td><AiCell value={row.exit ?? ""} onChange={value => onUpdateRow(row.client_id, "exit", value)} /></Td>
                  <Td><AiCell value={row.quantity ?? ""} onChange={value => onUpdateRow(row.client_id, "quantity", value)} /></Td>
                  <Td><AiCell value={row.setup_tag || row.setup || ""} onChange={value => onUpdateRow(row.client_id, "setup_tag", value)} /></Td>
                  <Td><AiCell value={row.mistake_tag || row.mistake || "none"} onChange={value => onUpdateRow(row.client_id, "mistake_tag", value)} /></Td>
                  <Td>
                    <select
                      value={row.rule_followed === true ? "true" : row.rule_followed === false ? "false" : ""}
                      onChange={event => onUpdateRow(row.client_id, "rule_followed", event.target.value === "" ? null : event.target.value === "true")}
                      style={aiInputStyle}
                    >
                      <option value="">Unknown</option>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  </Td>
                  <Td><AiCell value={row.planned_risk ?? ""} onChange={value => onUpdateRow(row.client_id, "planned_risk", value)} /></Td>
                  <Td><AiCell value={row.planned_reward ?? ""} onChange={value => onUpdateRow(row.client_id, "planned_reward", value)} /></Td>
                  <Td><AiCell value={row.notes || ""} onChange={value => onUpdateRow(row.client_id, "notes", value)} wide /></Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
        <button
          type="button"
          onClick={onSaveSelected}
          disabled={saving || parsing || selectedCount === 0}
          style={paginationButtonStyle(saving || parsing || selectedCount === 0)}
        >
          {saving ? "Saving..." : `Save selected trades (${selectedCount})`}
        </button>
      </div>
    </>
  );
}

const aiInputStyle = {
  width: "100%",
  minWidth: 78,
  borderRadius: 4,
  border: "1px solid rgba(200,241,53,0.12)",
  background: "#060608",
  color: "#e5e5e5",
  padding: "6px 7px",
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: "0.66rem",
};

function AiCell({ value, onChange, wide = false }) {
  return (
    <input
      value={value}
      onChange={event => onChange(event.target.value)}
      style={{
        ...aiInputStyle,
        minWidth: wide ? 180 : aiInputStyle.minWidth,
      }}
    />
  );
}

function JournalActionSummary({ title, metrics = [], messages = [], tone = "success" }) {
  const toneColor = tone === "error" ? "#FF3B3B" : tone === "warning" ? "#FFB84D" : "#C8F135";
  const toneBorder = tone === "error" ? "rgba(255,59,59,0.22)" : tone === "warning" ? "rgba(255,184,77,0.22)" : "rgba(200,241,53,0.14)";
  const toneBackground = tone === "error" ? "rgba(255,59,59,0.06)" : tone === "warning" ? "rgba(255,184,77,0.06)" : "rgba(200,241,53,0.04)";

  return (
    <div style={{
      marginBottom: 18,
      padding: "12px",
      background: "#0a0a0f",
      border: `1px solid ${toneBorder}`,
      borderRadius: 4,
    }}>
      <div style={{
        color: toneColor,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "0.68rem",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        marginBottom: 10,
      }}>
        {title}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 10 }}>
        {metrics.map(([label, value]) => (
          <div key={label} style={{
            background: "#060608",
            border: "1px solid rgba(200,241,53,0.08)",
            borderRadius: 4,
            padding: "9px 10px",
          }}>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.55rem",
              color: "#C8F135",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 5,
            }}>
              {label}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.78rem", color: "#888899" }}>
              {value}
            </div>
          </div>
        ))}
      </div>
      {messages.length > 0 && (
        <div style={{ display: "grid", gap: 7, marginTop: 10 }}>
          {messages.map((message, index) => (
            <div key={`${message}-${index}`} style={{
              padding: "8px 10px",
              background: toneBackground,
              border: `1px solid ${toneBorder}`,
              borderRadius: 4,
              color: toneColor,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.68rem",
              lineHeight: 1.5,
            }}>
              {message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StorageDebugStatus({ status, debugReportText, debugCopyMessage, onCopyDebugReport }) {
  if (!status) return null;
  const items = [
    ["isAuthenticated", String(status.isAuthenticated === true || status.signedIn === true)],
    ["userId present", String(status.userIdPresent === true)],
    ["currentUserId", status.currentUserId || "null"],
    ["currentUserEmail", status.currentUserEmail || "null"],
    ["storageMode", status.storageMode || status.mode || "local"],
    ["lastLoadTarget", status.lastLoadTarget || "null"],
    ["lastLoadErrorMessage", status.lastLoadErrorMessage || "null"],
    ["loadedRowCount", status.loadedRowCount ?? 0],
    ["lastSaveTarget", status.lastSaveTarget || "null"],
    ["lastSaveAction", status.lastSaveAction || "null"],
    ["lastSaveErrorMessage", status.lastSaveErrorMessage || "null"],
    ["lastInsertedRowCount", status.lastInsertedRowCount ?? status.returnedRowCount ?? 0],
    ["returnedRowCount", status.returnedRowCount ?? 0],
    ["lastReturnedRowIds", Array.isArray(status.lastReturnedRowIds) ? status.lastReturnedRowIds.join(", ") || "none" : "none"],
    ["lastReloadAfterSaveCount", status.lastReloadAfterSaveCount ?? 0],
    ["saveStartedAt", status.saveStartedAt || "null"],
    ["saveTradeId", status.saveTradeId || "null"],
    ["saveSymbol", status.saveSymbol || "null"],
    ["saveMode", status.saveMode || "null"],
    ["saveStep", status.saveStep || "idle"],
    ["supabaseInsertStatus", status.supabaseInsertStatus ?? "null"],
    ["verifySelectStatus", status.verifySelectStatus ?? "null"],
    ["verifiedRowFound", String(status.verifiedRowFound === true)],
    ["verifiedRowUserIdMatches", String(status.verifiedRowUserIdMatches === true)],
    ["postSaveVisibleInTable", String(status.postSaveVisibleInTable === true)],
    ["currentPage", status.currentPage ?? "null"],
    ["sortField", status.sortField || "null"],
    ["sortDirection", status.sortDirection || "null"],
    ["supabaseConfigured", String(status.supabaseConfigured === true)],
  ];

  return (
    <div>
      <div style={{
        marginTop: 6,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 6,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "0.58rem",
        color: status.lastSaveErrorMessage ? "#FFB84D" : "#555566",
        lineHeight: 1.6,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}>
        {items.map(([label, value]) => (
          <div key={label} style={{
            border: "1px solid rgba(200,241,53,0.08)",
            borderRadius: 4,
            padding: "6px 8px",
            background: "rgba(255,255,255,0.015)",
          }}>
            <span style={{ color: "#888899" }}>{label}: </span>
            <span style={{ color: status.lastSaveErrorMessage ? "#FFB84D" : "#C8F135" }}>{value}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          onClick={onCopyDebugReport}
          style={{
            padding: "7px 10px",
            borderRadius: 4,
            border: "1px solid rgba(200,241,53,0.2)",
            background: "rgba(200,241,53,0.06)",
            color: "#C8F135",
            cursor: "pointer",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.62rem",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          Copy Debug Report
        </button>
        {debugCopyMessage && (
          <span style={{
            marginLeft: 8,
            color: "#888899",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.62rem",
          }}>
            {debugCopyMessage}
          </span>
        )}
        {debugReportText && (
          <textarea
            readOnly
            value={debugReportText}
            style={{
              marginTop: 8,
              width: "100%",
              minHeight: 180,
              resize: "vertical",
              borderRadius: 4,
              border: "1px solid rgba(200,241,53,0.14)",
              background: "#060608",
              color: "#C8F135",
              padding: 10,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.62rem",
              lineHeight: 1.5,
            }}
          />
        )}
      </div>
    </div>
  );
}

function ClearDatasetModal({ clearing, supabaseSyncAvailable, onClose, onClearLocal, onClearAll }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 110,
        background: "rgba(0,0,0,0.78)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="glass-panel"
        style={{
          width: "100%", maxWidth: 520,
          padding: 22,
          border: "1px solid rgba(255,184,77,0.2)",
        }}
      >
        <div style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: "1.35rem",
          color: "#FFB84D",
          letterSpacing: "0.06em",
          marginBottom: 12,
        }}>
          Clear Current Dataset
        </div>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "0.76rem",
          color: "#888899",
          lineHeight: 1.7,
          marginBottom: 18,
        }}>
          This will remove the currently loaded journal dataset from this browser. Signed-in Supabase users can also clear their own cloud journal_trades rows.
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button onClick={onClose} disabled={clearing} style={modalButtonStyle("neutral", clearing)}>
            Cancel
          </button>
          <button onClick={onClearLocal} disabled={clearing} style={modalButtonStyle("warning", clearing)}>
            Clear Local Only
          </button>
          <button
            onClick={onClearAll}
            disabled={clearing || !supabaseSyncAvailable}
            style={modalButtonStyle("danger", clearing || !supabaseSyncAvailable)}
            title={supabaseSyncAvailable ? "" : "Sign in to clear Supabase journal rows."}
          >
            {clearing ? "Clearing..." : "Clear Local + Supabase"}
          </button>
        </div>
      </div>
    </div>
  );
}

function paginationButtonStyle(disabled) {
  return {
    padding: "7px 11px",
    borderRadius: 4,
    border: "1px solid rgba(200,241,53,0.16)",
    background: "#060608",
    color: disabled ? "#333344" : "#C8F135",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "0.66rem",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  };
}

function modalButtonStyle(tone, disabled) {
  const colors = {
    neutral: ["rgba(255,255,255,0.04)", "rgba(255,255,255,0.12)", "#888899"],
    warning: ["rgba(255,184,77,0.08)", "rgba(255,184,77,0.28)", "#FFB84D"],
    danger: ["rgba(255,59,59,0.08)", "rgba(255,59,59,0.28)", "#FF6B6B"],
  };
  const [background, border, color] = colors[tone] || colors.neutral;
  return {
    padding: "9px 13px",
    borderRadius: 4,
    border: `1px solid ${border}`,
    background,
    color: disabled ? "#333344" : color,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.65 : 1,
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "0.68rem",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
  };
}

function SummaryCard({ label, value, color }) {
  return (
    <div style={{
      background: "#0a0a0f",
      border: "1px solid rgba(200,241,53,0.08)",
      borderRadius: 4,
      padding: 20,
    }}>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "0.65rem", color: "#555566",
        letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8,
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: "'Bebas Neue', sans-serif",
        fontSize: "2rem", color: color || "#C8F135",
        letterSpacing: "0.04em", lineHeight: 1,
      }}>
        {value}
      </div>
    </div>
  );
}

function TagBadge({ label, color }) {
  return (
    <span style={{
      padding: "2px 6px",
      borderRadius: 3,
      border: `1px solid ${color === "#FF3B3B" ? "rgba(255,59,59,0.22)" : "rgba(200,241,53,0.18)"}`,
      background: color === "#FF3B3B" ? "rgba(255,59,59,0.06)" : "rgba(200,241,53,0.05)",
      color,
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: "0.58rem",
      lineHeight: 1.4,
      textTransform: "uppercase",
      letterSpacing: "0.06em",
    }}>
      {label}
    </span>
  );
}

function Th({ children, sortable, align, onClick, ...rest }) {
  return (
    <th
      onClick={onClick}
      style={{
        textAlign: align || "left",
        padding: "10px 14px",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "0.62rem", color: "#555566",
        letterSpacing: "0.12em", textTransform: "uppercase",
        fontWeight: 400, borderBottom: "1px solid rgba(200,241,53,0.1)",
        cursor: sortable ? "pointer" : "default",
        userSelect: "none", whiteSpace: "nowrap",
        background: "none",
      }}
      {...rest}
    >
      {children}
    </th>
  );
}

function Td({ children, align, colSpan, style: extraStyle }) {
  return (
    <td
      colSpan={colSpan}
      style={{
        textAlign: align || "left",
        padding: "10px 14px",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "0.78rem", color: "#555566",
        whiteSpace: "nowrap",
        ...extraStyle,
      }}
    >
      {children}
    </td>
  );
}
