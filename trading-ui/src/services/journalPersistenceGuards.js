export const LAST_SAVED_TRADE_ID_KEY = "bullcast_last_saved_trade_id";

export function authenticatedModePrefersSupabase({
  isAuthenticated,
  supabaseConfigured,
}) {
  return Boolean(isAuthenticated && supabaseConfigured);
}

export function tradeId(value) {
  return String(value || "").trim();
}

export function findTradeIndexById(rows, id) {
  const targetId = tradeId(id);
  if (!targetId || !Array.isArray(rows)) return -1;
  return rows.findIndex((row) => tradeId(row?.id) === targetId);
}

export function getTradePageForId(rows, id, pageSize) {
  const index = findTradeIndexById(rows, id);
  const safePageSize = Number.isFinite(Number(pageSize)) && Number(pageSize) > 0
    ? Number(pageSize)
    : 1;

  return {
    index,
    pageIndex: index >= 0 ? Math.floor(index / safePageSize) : -1,
  };
}

export function tradeDateSortValue(value) {
  const text = String(value || "").trim();
  if (!text) return 0;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) {
    const [, year, month, day] = iso;
    return Date.UTC(Number(year), Number(month) - 1, Number(day));
  }

  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (slash) {
    const [, month, day, rawYear] = slash;
    const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
    return Date.UTC(year, Number(month) - 1, Number(day));
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function mergeExactTradeAtTop(rows, exactTrade) {
  const targetId = tradeId(exactTrade?.id);
  if (!targetId) return Array.isArray(rows) ? [...rows] : [];

  const rest = (Array.isArray(rows) ? rows : []).filter((row) => (
    tradeId(row?.id) !== targetId
  ));
  return [exactTrade, ...rest];
}

export function reconcileVerifiedRowAfterReload({
  loadedRows,
  verifiedRowId,
  exactRow,
}) {
  const foundInReload = findTradeIndexById(loadedRows, verifiedRowId) >= 0;
  if (foundInReload) {
    return {
      rows: Array.isArray(loadedRows) ? [...loadedRows] : [],
      foundInReload: true,
      mergedExactRow: false,
      missingAfterExactLookup: false,
    };
  }

  if (exactRow && tradeId(exactRow.id) === tradeId(verifiedRowId)) {
    return {
      rows: mergeExactTradeAtTop(loadedRows, exactRow),
      foundInReload: false,
      mergedExactRow: true,
      missingAfterExactLookup: false,
    };
  }

  return {
    rows: Array.isArray(loadedRows) ? [...loadedRows] : [],
    foundInReload: false,
    mergedExactRow: false,
    missingAfterExactLookup: true,
  };
}
