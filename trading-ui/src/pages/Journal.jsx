import { useState, useEffect, useMemo, useCallback } from "react";

const STORAGE_KEY = "bullcast_journal_v1";

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
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseConfidence(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

function normalizeBoolean(value) {
  if (value === true || value === false) return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function formatTag(value) {
  if (!value) return "";
  return String(value).replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function normalizeTrade(trade, index = null) {
  const symbol = String(trade?.symbol || "").trim().toUpperCase();
  const type = String(trade?.type || "LONG").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
  const entry = Number(trade?.entry_price ?? 0);
  const exit = Number(trade?.exit_price ?? 0);
  const quantity = Number(trade?.quantity ?? 0);
  const hasValidPnl = Number.isFinite(Number(trade?.pnl));
  const computed = calcPnl(type, entry, exit, quantity);
  const assetType = ASSET_TYPES.includes(trade?.asset_type) ? trade.asset_type : inferAssetType(symbol);
  const setupTag = SETUP_TAGS.includes(trade?.setup_tag) ? trade.setup_tag : "";
  const mistakeTag = MISTAKE_TAGS.includes(trade?.mistake_tag) ? trade.mistake_tag : "none";

  return {
    id: String(trade?.id || `${symbol || "TRADE"}-${trade?.date || Date.now()}-${index ?? Date.now()}`),
    date: String(trade?.date || new Date().toISOString().split("T")[0]),
    symbol,
    asset_type: assetType,
    type,
    entry_price: Number.isFinite(entry) ? entry : 0,
    exit_price: Number.isFinite(exit) ? exit : 0,
    quantity: Number.isFinite(quantity) ? quantity : 0,
    notes: String(trade?.notes || ""),
    pnl: hasValidPnl ? Number(trade.pnl) : computed.pnl,
    pnl_pct: Number.isFinite(Number(trade?.pnl_pct)) ? Number(trade.pnl_pct) : computed.pnl_pct,
    result: String(trade?.result || computed.result).toUpperCase() === "WIN" ? "WIN" : "LOSS",
    setup_tag: setupTag,
    mistake_tag: mistakeTag,
    confidence_score: parseConfidence(trade?.confidence_score),
    planned_risk: parseOptionalNumber(trade?.planned_risk),
    planned_reward: parseOptionalNumber(trade?.planned_reward),
    rule_followed: normalizeBoolean(trade?.rule_followed),
    entry_reason: String(trade?.entry_reason || ""),
    exit_reason: String(trade?.exit_reason || ""),
  };
}

function loadTrades() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((trade, index) => normalizeTrade(trade, index)) : [];
  } catch {
    return [];
  }
}

function saveTrades(trades) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
  } catch (e) {
    console.error("Journal save failed:", e);
  }
}

function calcPnl(type, entry, exit, qty) {
  if (!entry || !exit || !qty) return { pnl: 0, pnl_pct: 0, result: "LOSS" };
  const pnl = type === "LONG"
    ? (exit - entry) * qty
    : (entry - exit) * qty;
  const cost = entry * qty;
  const pnl_pct = cost > 0 ? (pnl / cost) * 100 : 0;
  return { pnl, pnl_pct, result: pnl > 0 ? "WIN" : "LOSS" };
}

function formatCurrency(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "₹0.00";
  const sign = n > 0 ? "+" : "";
  return sign + "₹" + Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    t.pnl.toFixed(2), t.pnl_pct.toFixed(2),
    t.result, t.setup_tag || "", t.mistake_tag || "none", t.confidence_score ?? "",
    t.planned_risk ?? "", t.planned_reward ?? "",
    t.rule_followed === null || t.rule_followed === undefined ? "" : t.rule_followed,
    `"${(t.entry_reason || "").replace(/"/g, '""')}"`,
    `"${(t.exit_reason || "").replace(/"/g, '""')}"`,
    `"${(t.notes || "").replace(/"/g, '""')}"`
  ]);
  const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const today = new Date().toISOString().split("T")[0];
  a.href = url;
  a.download = `bullcast-journal-${today}.csv`;
  a.click();
  URL.revokeObjectURL(url);
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
      id: initialTrade?.id || Date.now().toString(),
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
  const [trades, setTrades] = useState(() => loadTrades());
  const [showModal, setShowModal] = useState(false);
  const [editingTrade, setEditingTrade] = useState(null);
  const [sortCol, setSortCol] = useState("date");
  const [sortDir, setSortDir] = useState("desc");

  useEffect(() => { saveTrades(trades); }, [trades]);

  const saveTrade = useCallback((trade) => {
    const normalized = normalizeTrade(trade);
    setTrades(prev => (
      editingTrade
        ? prev.map(t => t.id === normalized.id ? normalized : t)
        : [normalized, ...prev]
    ));
    setShowModal(false);
    setEditingTrade(null);
  }, [editingTrade]);

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
  }, []);

  const toggleSort = (col) => {
    if (sortCol === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir(col === "date" ? "desc" : "asc");
    }
  };

  const sorted = useMemo(() => {
    const arr = [...trades];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortCol) {
        case "date": return a.date.localeCompare(b.date) * dir;
        case "symbol": return a.symbol.localeCompare(b.symbol) * dir;
        case "pnl": return (a.pnl - b.pnl) * dir;
        case "result": return a.result.localeCompare(b.result) * dir;
        default: return 0;
      }
    });
    return arr;
  }, [trades, sortCol, sortDir]);

  // Summary calculations
  const summary = useMemo(() => {
    if (trades.length === 0) return null;
    const wins = trades.filter(t => t.result === "WIN").length;
    const netPnl = trades.reduce((s, t) => s + t.pnl, 0);
    const best = Math.max(...trades.map(t => t.pnl));
    const worst = Math.min(...trades.map(t => t.pnl));
    const winRate = (wins / trades.length) * 100;
    return { total: trades.length, winRate, netPnl, best, worst };
  }, [trades]);

  const sortArrow = (col) => {
    if (sortCol !== col) return "";
    return sortDir === "asc" ? " ^" : " v";
  };

  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);

  return (
    <div style={{ minHeight: "100%", padding: "24px", maxWidth: 1280, margin: "0 auto" }}>
      {/* Page Header */}
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 16, marginBottom: 24 }}>
        <div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.7rem", color: "#C8F135", letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 4 }}>
            Personal
          </div>
          <h1 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: "clamp(2rem,5vw,3.5rem)", color: "#e5e5e5", margin: 0, letterSpacing: "0.04em", lineHeight: 1 }}>
            Trade Journal
          </h1>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
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
          <button onClick={() => { setEditingTrade(null); setShowModal(true); }}
            style={{
              padding: "10px 22px", borderRadius: 4, cursor: "pointer",
              background: "#C8F135", border: "none", color: "#060608",
              fontFamily: "'Bebas Neue', sans-serif", fontSize: "1rem",
              letterSpacing: "0.06em", transition: "all 0.15s",
            }}
          >
            + Add Trade
          </button>
        </div>
      </div>

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
          <button onClick={() => { setEditingTrade(null); setShowModal(true); }}
            style={{
              padding: "10px 24px", borderRadius: 4, cursor: "pointer",
              background: "#C8F135", border: "none", color: "#060608",
              fontFamily: "'Bebas Neue', sans-serif", fontSize: "1rem",
              letterSpacing: "0.08em",
            }}
          >
            + Add Trade
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
              {sorted.map((t, i) => (
                <tr key={t.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.02)" }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(200,241,53,0.02)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <Td style={{ color: "#333344" }}>{i + 1}</Td>
                  <Td>{t.date}</Td>
                  <Td style={{ fontWeight: 700, color: "#e5e5e5" }}>{t.symbol}</Td>
                  <Td style={{ fontWeight: 700, color: t.type === "LONG" ? "#C8F135" : "#FF3B3B" }}>{t.type}</Td>
                  <Td align="right">{t.entry_price.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</Td>
                  <Td align="right">{t.exit_price.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</Td>
                  <Td align="right">{t.quantity}</Td>
                  <Td align="right" style={{ fontWeight: 700, color: t.result === "WIN" ? "#00FF87" : "#FF3B3B" }}>
                    {formatCurrency(t.pnl)}
                  </Td>
                  <Td>
                    <span style={{
                      padding: "2px 8px", borderRadius: 3,
                      fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem",
                      textTransform: "uppercase", fontWeight: 700,
                      background: t.result === "WIN" ? "rgba(0,255,135,0.1)" : "rgba(255,59,59,0.1)",
                      border: t.result === "WIN" ? "1px solid rgba(0,255,135,0.25)" : "1px solid rgba(255,59,59,0.25)",
                      color: t.result === "WIN" ? "#00FF87" : "#FF3B3B",
                    }}>
                      {t.result}
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
        </div>
      )}

      {/* Modal */}
      {showModal && <AddTradeModal onClose={closeModal} onSave={saveTrade} initialTrade={editingTrade} />}
    </div>
  );
}

// --- Utility sub-components ---
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
