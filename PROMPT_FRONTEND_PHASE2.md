# Bullcast — Frontend Phase 2 Prompt

> Paste everything below the line into Claude Code at D:\Bullcast

---

## CONTEXT

You are working on the Bullcast algorithmic trading platform. The React frontend lives in `trading-ui/src/`. The stack is React + Vite + Tailwind + lightweight-charts (TradingView library). The backend API is at `http://localhost:8000`.

The goal is to make this look and work like a real algo trading workstation — signals drawn on the chart, a live order ticket when a signal fires, open positions panel, and accurate stats. Study each component carefully before changing it.

**Files to modify:**
1. `trading-ui/src/components/algo/ProChart.jsx`
2. `trading-ui/src/components/algo/SignalFeed.jsx`
3. `trading-ui/src/pages/AlgoTrading.jsx`

**Do NOT touch:** `vite.config.js`, `tailwind.config.js`, any backend files, any other component not listed above.

---

## FIX 1 — ProChart: Draw Entry / Stop / Target Lines + Fix Signal Markers

**File:** `trading-ui/src/components/algo/ProChart.jsx`

### Problem A — Signal arrows use wrong timestamp

In `AlgoTrading.jsx`, signals are added to the `signals` array with `time: Date.now()` (the current wall-clock time, a 13-digit ms timestamp). The chart uses `Math.floor(s.time / 1000)` to convert, but candle timestamps are already in Unix seconds (10 digits). So `Date.now() / 1000` = current time, which is BEYOND the last candle → the marker lands off-screen or not at all.

**Fix:** Change ProChart to accept a `latestSignal` prop (the full API response object) separately from `signals`. Use `latestSignal` to draw the price lines. For the signal markers array, use the candle data's last timestamp rather than the signal's arrival time:

Add `latestSignal = null` to ProChart's props:
```jsx
export default function ProChart({ symbol, interval, candles, signals, indicators, latestSignal = null }) {
```

### Problem B — No entry / stop / target lines on the chart

When a BUY or SELL signal is active (`latestSignal?.passed === true`), draw three horizontal price lines using lightweight-charts `createPriceLine`:

Add this block **inside** the `useEffect`, after `candleSeries.setData(dedupedData)` and before the signal markers section:

```js
// Draw entry / stop / target price lines when signal is active
if (latestSignal?.passed && latestSignal?.signal_output?.signal !== "HOLD") {
  const { entry, stop_loss, target_price, signal_output } = latestSignal;
  const isBuy = signal_output?.signal === "BUY";

  if (entry != null) {
    candleSeries.createPriceLine({
      price:      entry,
      color:      isBuy ? "#26a641" : "#da3633",
      lineWidth:  1,
      lineStyle:  2,   // dashed
      axisLabelVisible: true,
      title:      "Entry",
    });
  }
  if (stop_loss != null) {
    candleSeries.createPriceLine({
      price:      stop_loss,
      color:      "#da3633",
      lineWidth:  1,
      lineStyle:  2,
      axisLabelVisible: true,
      title:      "Stop",
    });
  }
  if (target_price != null) {
    candleSeries.createPriceLine({
      price:      target_price,
      color:      "#58a6ff",
      lineWidth:  1,
      lineStyle:  2,
      axisLabelVisible: true,
      title:      "Target",
    });
  }
}
```

### Problem C — Signal markers should use last candle's timestamp

Replace the existing marker block with this corrected version that pins the arrow to the last candle in the chart data, not to `Date.now()`:

```js
// Signal markers — pin to the last candle timestamp, not wall clock
if (latestSignal?.passed && latestSignal?.signal_output?.signal !== "HOLD" && dedupedData.length > 0) {
  const lastCandleTime = dedupedData[dedupedData.length - 1].time;
  const sigDir = latestSignal.signal_output.signal;
  const conf   = latestSignal.signal_output.confidence ?? 0;
  candleSeries.setMarkers([{
    time:     lastCandleTime,
    position: sigDir === "BUY" ? "belowBar" : "aboveBar",
    color:    sigDir === "BUY" ? "#26a641"  : "#da3633",
    shape:    sigDir === "BUY" ? "arrowUp"  : "arrowDown",
    text:     `${sigDir} ${(conf * 100).toFixed(0)}%`,
    size:     2,
  }]);
} else {
  // Also render any historical signals from the signals prop
  if (signals.length > 0 && dedupedData.length > 0) {
    const markers = signals
      .filter((s) => s.signal !== "HOLD")
      .map((s) => {
        // Find the nearest candle to this signal's time
        const sigTimeSec = Math.floor((s.time || Date.now()) / 1000);
        const nearest = dedupedData.reduce((prev, curr) =>
          Math.abs(curr.time - sigTimeSec) < Math.abs(prev.time - sigTimeSec) ? curr : prev
        );
        return {
          time:     nearest.time,
          position: s.signal === "BUY" ? "belowBar" : "aboveBar",
          color:    s.signal === "BUY" ? "#26a641"  : "#da3633",
          shape:    s.signal === "BUY" ? "arrowUp"  : "arrowDown",
          text:     `${s.signal}`,
          size:     1,
        };
      })
      .sort((a, b) => a.time - b.time);
    if (markers.length > 0) candleSeries.setMarkers(markers);
  }
}
```

Also add `latestSignal` to the `useEffect` dependency array:
```js
}, [candles, signals, indicators, latestSignal]);
```

---

## FIX 2 — AlgoTrading.jsx: Wire latestSignal into ProChart + Add Order Ticket

**File:** `trading-ui/src/pages/AlgoTrading.jsx`

### A — Pass latestSignal to ProChart

Find the `<ProChart ... />` render. Add the `latestSignal` prop:

```jsx
<ProChart
  symbol={symbol}
  interval={interval}
  candles={candles}
  signals={signals}
  indicators={indicators}
  latestSignal={latestSig}    // ← add this
/>
```

### B — Fix the HOLD confidence display

In the derived KPI values section, find:
```js
const sigConf = sig?.confidence != null ? `${(sig.confidence * 100).toFixed(1)}%` : "—";
```

Change to:
```js
const sigConf = (sig?.confidence != null && sig.confidence > 0)
  ? `${(sig.confidence * 100).toFixed(1)}%`
  : sigDir === "HOLD" ? "—" : "0.0%";
```

### C — Add Order Ticket panel (shows when BUY or SELL fires)

Add a new state variable near the top of the component:
```js
const [orderTicketOpen, setOrderTicketOpen] = useState(false);
```

When `latestSig` changes and `passed === true`, auto-open the ticket:
```js
useEffect(() => {
  if (latestSig?.passed && latestSig?.signal_output?.signal !== "HOLD") {
    setOrderTicketOpen(true);
  } else {
    setOrderTicketOpen(false);
  }
}, [latestSig]);
```

Add the Order Ticket component inline (inside the KPI bar area, right after the KPI chips row), ONLY when a BUY/SELL is active:

```jsx
{orderTicketOpen && latestSig?.passed && (
  <div style={{
    display:      "flex",
    alignItems:   "center",
    gap:          "12px",
    padding:      "10px 14px",
    background:   sigDir === "BUY" ? "rgba(38,166,65,0.08)" : "rgba(218,54,51,0.08)",
    border:       `1px solid ${sigDir === "BUY" ? "rgba(38,166,65,0.3)" : "rgba(218,54,51,0.3)"}`,
    borderRadius: "6px",
    flexWrap:     "wrap",
    marginTop:    "8px",
  }}>
    {/* Signal badge */}
    <span style={{
      padding:      "3px 10px",
      borderRadius: "4px",
      background:   sigDir === "BUY" ? "rgba(38,166,65,0.2)" : "rgba(218,54,51,0.2)",
      color:        sigDir === "BUY" ? "var(--tv-green)" : "var(--tv-red)",
      fontFamily:   "IBM Plex Mono, monospace",
      fontSize:     "12px",
      fontWeight:   700,
      letterSpacing:"0.05em",
    }}>{sigDir}</span>

    {/* Entry / Stop / Target */}
    {[
      { label: "Entry",  value: latestSig.entry },
      { label: "Stop",   value: latestSig.stop_loss,   color: "var(--tv-red)" },
      { label: "Target", value: latestSig.target_price, color: "var(--tv-blue)" },
    ].map(({ label, value, color }) => value != null && (
      <div key={label} style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
        <span style={{ fontSize: "9px", color: "var(--tv-muted)", fontFamily: "IBM Plex Mono, monospace", textTransform: "uppercase" }}>{label}</span>
        <span style={{ fontSize: "13px", color: color || "var(--tv-text)", fontFamily: "IBM Plex Mono, monospace", fontWeight: 600 }}>
          {value?.toFixed(5)}
        </span>
      </div>
    ))}

    {/* Kelly size */}
    {kelly?.fraction > 0 && (
      <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
        <span style={{ fontSize: "9px", color: "var(--tv-muted)", fontFamily: "IBM Plex Mono, monospace", textTransform: "uppercase" }}>Size</span>
        <span style={{ fontSize: "13px", color: "var(--tv-text)", fontFamily: "IBM Plex Mono, monospace", fontWeight: 600 }}>
          {(kelly.fraction * 100).toFixed(2)}%
        </span>
      </div>
    )}

    {/* Spacer */}
    <div style={{ flex: 1 }} />

    {/* Place Trade button */}
    <button
      onClick={async () => {
        try {
          await fetch(`${API_BASE_URL}/api/algo/trade/place`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({
              validated_signal: {
                symbol:        latestSig.symbol,
                signal:        latestSig.signal_output.signal,
                confidence:    latestSig.signal_output.confidence,
                entry:         latestSig.entry,
                stop_loss:     latestSig.stop_loss,
                target_price:  latestSig.target_price,
                regime:        latestSig.regime?.regime,
                kelly_fraction:latestSig.kelly?.fraction,
                current_price: latestSig.current_price,
              }
            }),
          });
          setOrderTicketOpen(false);
        } catch (e) {
          console.error("Place trade failed", e);
        }
      }}
      style={{
        padding:      "6px 16px",
        borderRadius: "4px",
        border:       "none",
        background:   sigDir === "BUY" ? "var(--tv-green)" : "var(--tv-red)",
        color:        "#0d1117",
        fontFamily:   "IBM Plex Mono, monospace",
        fontSize:     "12px",
        fontWeight:   700,
        cursor:       "pointer",
      }}
    >
      Place Paper Trade
    </button>

    {/* Dismiss */}
    <button
      onClick={() => setOrderTicketOpen(false)}
      style={{
        background: "transparent",
        border:     "none",
        color:      "var(--tv-muted)",
        cursor:     "pointer",
        fontSize:   "16px",
        lineHeight: 1,
      }}
    >×</button>
  </div>
)}
```

Make sure `API_BASE_URL` is imported at the top:
```js
import { API_BASE_URL } from "../services/api";
```
(It's already imported — just verify.)

### D — Live Stats bar (win rate + open positions)

Add a `stats` state and fetch it:
```js
const [stats, setStats] = useState(null);

// Fetch stats every 30s
useEffect(() => {
  const fetchStats = async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/algo/stats`);
      if (r.ok) setStats(await r.json());
    } catch (_) {}
  };
  fetchStats();
  const t = setInterval(fetchStats, 30_000);
  return () => clearInterval(t);
}, []);
```

In the KPI bar, add two more chips after the existing ones:

```jsx
{stats && (
  <>
    <KPIChip
      label="Win Rate"
      value={stats.total_trades > 0 ? `${(stats.win_rate * 100).toFixed(1)}%` : "—"}
      color={stats.win_rate >= 0.5 ? "var(--tv-green)" : stats.total_trades > 0 ? "var(--tv-red)" : "var(--tv-muted)"}
    />
    <KPIChip
      label="Open Pos"
      value={stats.open_positions ?? 0}
      color={stats.open_positions > 0 ? "var(--tv-orange)" : "var(--tv-muted)"}
    />
  </>
)}
```

Replace the existing `Today P&L` chip with a live version:
```jsx
<KPIChip
  label="Today P&L"
  value={stats ? `₹${stats.today_pnl >= 0 ? "+" : ""}${stats.today_pnl.toFixed(2)}` : "₹0"}
  color={stats?.today_pnl > 0 ? "var(--tv-green)" : stats?.today_pnl < 0 ? "var(--tv-red)" : "var(--tv-muted)"}
/>
```

---

## FIX 3 — SignalFeed: Only show actionable signals, suppress HOLD clutter

**File:** `trading-ui/src/components/algo/SignalFeed.jsx`

The feed currently adds every poll result including HOLD signals, which fills the feed with noise. Professional platforms only surface actionable signals.

Change the `setSignals` call in `fetchSignal`:

```js
// Before:
setSignals((prev) => [data, ...prev].slice(0, 20));

// After — only store BUY/SELL in history, always update latest:
const sigDir = data.signal_output?.signal || "HOLD";
setSignals((prev) => {
  const withNew = sigDir !== "HOLD" ? [data, ...prev] : prev;
  return withNew.slice(0, 20);
});
// Always show the latest status at top regardless
setLatestStatus(data);
```

Add `latestStatus` state:
```js
const [latestStatus, setLatestStatus] = useState(null);
```

At the top of the returned JSX, show a compact current-status line before the signals list:

```jsx
{/* Current status — always visible */}
{latestStatus && (
  <div style={{
    display:      "flex",
    alignItems:   "center",
    gap:          "8px",
    padding:      "8px 10px",
    background:   "var(--tv-surface)",
    border:       "1px solid var(--tv-border)",
    borderRadius: "4px",
    fontFamily:   "IBM Plex Mono, monospace",
    fontSize:     "11px",
  }}>
    <span style={{
      padding:    "2px 7px",
      borderRadius:"3px",
      fontWeight: 700,
      background: latestStatus.signal_output?.signal === "BUY"
        ? "rgba(38,166,65,0.2)"
        : latestStatus.signal_output?.signal === "SELL"
        ? "rgba(218,54,51,0.2)"
        : "rgba(100,100,100,0.2)",
      color: latestStatus.signal_output?.signal === "BUY"
        ? "var(--tv-green)"
        : latestStatus.signal_output?.signal === "SELL"
        ? "var(--tv-red)"
        : "var(--tv-muted)",
    }}>
      {latestStatus.signal_output?.signal || "HOLD"}
    </span>
    <span style={{ color: "var(--tv-muted)" }}>
      {latestStatus.regime?.regime || ""}
    </span>
    <span style={{ marginLeft: "auto", color: "var(--tv-muted)" }}>
      {latestStatus.timestamp ? new Date(latestStatus.timestamp).toLocaleTimeString() : ""}
    </span>
  </div>
)}

{/* Actionable signal history */}
{signals.length === 0 && (
  <div className="text-neutral-500 font-mono text-xs py-4 text-center">
    Watching for BUY / SELL setups…
  </div>
)}
```

Then render `signals` (which now only contains BUY/SELL history) below that status line.

---

## VERIFICATION

After all changes:

1. `localhost:5173/algo` — load the page
2. With a HOLD signal: Confidence chip shows "—" not "100.0%"
3. With a BUY/SELL signal (test by switching to 1h or 1D on a trending pair like GBP/USD):
   - Arrow marker appears on the chart at the last candle
   - Three horizontal dashed lines appear: Entry (green/red), Stop (red), Target (blue)
   - Order ticket bar appears below the KPI chips with entry/stop/target values and "Place Paper Trade" button
4. SignalFeed right panel shows current status at top, BUY/SELL history below
5. Win Rate and Open Pos KPI chips appear (both "—"/0 initially is fine)
6. No console errors

## END OF PROMPT
