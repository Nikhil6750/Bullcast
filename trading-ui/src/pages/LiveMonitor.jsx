import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { createChart, LineStyle } from "lightweight-charts";
import { getAlertsLog, getLiveScan, getBacktestCandles } from "../services/api";

const FOREX_PAIRS = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USDCHF",
  "AUDUSD",
  "NZDUSD",
  "USDCAD",
  "GBPJPY",
  "EURJPY",
  "EURGBP",
  "AUDJPY",
  "GBPAUD",
  "EURAUD",
  "GBPCAD",
  "AUDCAD",
  "NZDJPY",
  "CHFJPY",
  "EURCAD",
  "AUDCHF",
  "EURCHF",
];

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const REQUEST_STAGGER_MS = 2 * 1000;
const PENDING_SIGNAL_DELAY_MS = 7 * 60 * 1000;
const PENDING_SIGNAL_CHECK_MS = 30 * 1000;
const LIVE_SIGNALS_STORAGE_KEY = "bullcast_live_signals";

function msUntilNext5mBoundary() {
  const now = new Date();
  return (5 - (now.getMinutes() % 5)) * 60000
    - now.getSeconds() * 1000
    - now.getMilliseconds()
    + 15000;
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function todayInIST() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function formatClockIST(date) {
  if (!date) return "--:--:--";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function formatPatternTime(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) return "--:--:--";
  return formatClockIST(new Date(value * 1000));
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatPrice(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(5) : "--";
}

function normalizePatterns(payload, pair) {
  const patterns = Array.isArray(payload?.patterns)
    ? payload.patterns
    : payload && Object.keys(payload).length
      ? [payload]
      : [];

  return patterns
    .filter((pattern) => pattern?.result !== "setup_not_formed")
    .map((pattern, index) => ({
      ...pattern,
      pair: pattern.pair || pair,
      monitorId: `${pattern.pair || pair}-${pattern.alert_timestamp || "unknown"}-${index}`,
    }));
}

function normalizeHistory(payload) {
  const alerts = Array.isArray(payload) ? payload : Array.isArray(payload?.alerts) ? payload.alerts : [];
  return alerts
    .map((alert, index) => ({
      ...alert,
      alert_timestamp: alert.alert_timestamp ?? alert.alert_time,
      monitorId: `history-${alert.pair || "pair"}-${alert.alert_timestamp ?? alert.alert_time ?? "unknown"}-${alert.result || "result"}-${index}`,
    }));
}

function sortByAlertTimeDesc(items) {
  return [...items].sort((a, b) => Number(b.alert_timestamp || 0) - Number(a.alert_timestamp || 0));
}

function storedSignalsFromRowsByPair(rowsByPair) {
  const source = rowsByPair && typeof rowsByPair === "object" ? rowsByPair : {};
  return FOREX_PAIRS.reduce((signals, pair) => {
    const value = source[pair];
    const pairRows = Array.isArray(value) ? value : value ? [value] : [];
    const latest = sortByAlertTimeDesc(pairRows.filter(Boolean))[0];
    if (latest) {
      signals[pair] = latest;
    }
    return signals;
  }, {});
}

function rowsByPairFromStoredSignals(signals) {
  if (!signals || typeof signals !== "object" || Array.isArray(signals)) return {};

  return FOREX_PAIRS.reduce((rowsByPair, pair) => {
    const value = signals[pair];
    const pairRows = Array.isArray(value) ? value : value ? [value] : [];
    const latest = sortByAlertTimeDesc(pairRows.filter(Boolean))[0];
    if (latest) {
      rowsByPair[pair] = [{
        ...latest,
        pair: latest.pair || pair,
        monitorId: latest.monitorId || `${latest.pair || pair}-${latest.alert_timestamp || "stored"}-0`,
      }];
    }
    return rowsByPair;
  }, {});
}

function loadStoredLiveSignals() {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(LIVE_SIGNALS_STORAGE_KEY);
    return raw ? rowsByPairFromStoredSignals(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function saveStoredLiveSignals(rowsByPair) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      LIVE_SIGNALS_STORAGE_KEY,
      JSON.stringify(storedSignalsFromRowsByPair(rowsByPair))
    );
  } catch {
    // Ignore storage failures so scanning still works in restricted browsers.
  }
}

function stripDetectedAt(signal) {
  const { detectedAt, ...row } = signal;
  return row;
}

function ResultBadge({ result }) {
  const isPending = result === "pending";
  return (
    <span
      className={`inline-flex min-w-[92px] justify-center rounded-md border px-2.5 py-1 text-xs font-semibold uppercase ${
        isPending
          ? "border-[#FFB84D]/40 bg-[#FFB84D]/15 text-[#FFB84D]"
          : "border-white/10 bg-white/5 text-neutral-300"
      }`}
    >
      {String(result || "pending").replace(/_/g, " ")}
    </span>
  );
}

function CandleChart({ pattern }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const { c1, c2, c3, pullback_candles, alert_candle, target } = pattern;
    const raw = [c1, c2, c3, ...(pullback_candles ?? [])];
    if (alert_candle) raw.push(alert_candle);

    const data = raw
      .filter(Boolean)
      .map((c) => ({
        time: Number(c.time),
        open: parseFloat(c.open),
        high: parseFloat(c.high),
        low: parseFloat(c.low),
        close: parseFloat(c.close),
      }))
      .sort((a, b) => a.time - b.time)
      .filter((c, i, arr) => i === 0 || c.time > arr[i - 1].time);

    if (data.length === 0) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      height: 260,
      layout: {
        background: { color: "#131722" },
        textColor: "#d1d4dc",
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: "#1e222d" },
      },
      rightPriceScale: {
        visible: true,
        borderColor: "#2a2e39",
      },
      leftPriceScale: {
        visible: false,
      },
      timeScale: {
        visible: false,
      },
      crosshair: { mode: 0 },
      handleScale: false,
      handleScroll: false,
    });

    const series = chart.addCandlestickSeries({
      upColor: "#26a69a",
      downColor: "#ef5350",
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
      borderVisible: false,
    });

    series.setData(data);

    if (target != null) {
      const targetPrice = parseFloat(target);
      series.createPriceLine({
        price: targetPrice,
        color: "#f5a623",
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: `TARGET LEVEL: ${targetPrice}`,
      });
    }

    chart.timeScale().fitContent();
    chart.timeScale().applyOptions({ barSpacing: 40 });

    return () => chart.remove();
  }, [pattern]);

  return <div ref={containerRef} className="h-[260px] w-full" />;
}

export default function LiveMonitor() {
  const [activeTab, setActiveTab] = useState("live");
  const [expandedId, setExpandedId] = useState(null);
  const [rowsByPair, setRowsByPair] = useState(loadStoredLiveSignals);
  const [pendingSignals, setPendingSignals] = useState({});
  const [historyRows, setHistoryRows] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [pairErrors, setPairErrors] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);
  const [nextRefreshAt, setNextRefreshAt] = useState(() => Date.now() + msUntilNext5mBoundary());
  const [now, setNow] = useState(Date.now());
  const [scanState, setScanState] = useState({
    running: false,
    pair: "",
    index: 0,
    total: FOREX_PAIRS.length,
  });
  const scanTokenRef = useRef(0);
  const boundaryTimeoutRef = useRef(null);
  const intervalRef = useRef(null);
  const startScanRef = useRef(null);
  const rowsByPairRef = useRef({});
  const pendingSignalsRef = useRef({});

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const payload = await getAlertsLog();
      setHistoryRows(normalizeHistory(payload));
    } catch (error) {
      setHistoryError(error?.message || "Could not load alert history.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const startScan = useCallback(async () => {
    const token = scanTokenRef.current + 1;
    scanTokenRef.current = token;

    // Snapshot pending rows before the scan replaces state for each pair.
    const pendingRows = Object.values(rowsByPairRef.current)
      .flat()
      .filter((r) => r.result === "pending" && r.target != null && r.c1?.open != null);
    setPairErrors({});
    setScanState({
      running: true,
      pair: "",
      index: 0,
      total: FOREX_PAIRS.length,
    });

    for (let index = 0; index < FOREX_PAIRS.length; index += 1) {
      if (scanTokenRef.current !== token) return;

      const pair = FOREX_PAIRS[index];
      setScanState({
        running: true,
        pair,
        index: index + 1,
        total: FOREX_PAIRS.length,
      });

      try {
        const payload = await getLiveScan(pair);
        const nextRows = normalizePatterns(payload, pair);
        if (scanTokenRef.current !== token) return;
        const latest = sortByAlertTimeDesc(nextRows)[0];

        if (latest) {
          setPendingSignals((current) => {
            const displayed = rowsByPairRef.current[pair]?.[0];
            if (String(displayed?.alert_timestamp) === String(latest.alert_timestamp)) {
              if (!current[pair]) return current;
              const next = { ...current };
              delete next[pair];
              return next;
            }

            const existing = current[pair];
            const detectedAt = String(existing?.alert_timestamp) === String(latest.alert_timestamp)
              ? existing.detectedAt
              : Date.now();

            return {
              ...current,
              [pair]: {
                ...latest,
                detectedAt,
              },
            };
          });
        } else {
          setPendingSignals((current) => {
            if (!current[pair]) return current;
            const next = { ...current };
            delete next[pair];
            return next;
          });
          setRowsByPair((current) => {
            const next = {
              ...current,
              [pair]: [],
            };
            saveStoredLiveSignals(next);
            return next;
          });
        }
      } catch (error) {
        if (scanTokenRef.current !== token) return;
        setPairErrors((current) => ({
          ...current,
          [pair]: error?.message || "Backtest request failed.",
        }));
      }

      if (index < FOREX_PAIRS.length - 1) {
        await sleep(REQUEST_STAGGER_MS);
      }
    }

    if (scanTokenRef.current !== token) return;

    // Evaluate pending rows: fetch last 20 candles per pair and check target/stop.
    if (pendingRows.length > 0) {
      const pairsToEvaluate = [...new Set(pendingRows.map((r) => r.pair))];
      const resolvedResults = {};

      for (const pair of pairsToEvaluate) {
        if (scanTokenRef.current !== token) return;
        try {
          const data = await getBacktestCandles(pair);
          const candles = Array.isArray(data?.candles) ? data.candles.slice(-20) : [];

          for (const row of pendingRows.filter((r) => r.pair === pair)) {
            const alertTime = Number(row.alert_timestamp);
            const target = parseFloat(row.target);
            const stop = parseFloat(row.c1.open);
            const isUp = row.direction === "UP";

            for (const candle of candles) {
              if (Number(candle.time) <= alertTime) continue;
              const high = parseFloat(candle.high);
              const low = parseFloat(candle.low);

              if (isUp) {
                if (high >= target) { resolvedResults[row.monitorId] = "win"; break; }
                if (low <= stop) { resolvedResults[row.monitorId] = "loss"; break; }
              } else {
                if (low <= target) { resolvedResults[row.monitorId] = "win"; break; }
                if (high >= stop) { resolvedResults[row.monitorId] = "loss"; break; }
              }
            }
          }
        } catch {
          // Non-fatal: evaluation failures don't block the scan result
        }
      }

      if (Object.keys(resolvedResults).length > 0 && scanTokenRef.current === token) {
        setRowsByPair((current) => {
          const next = { ...current };
          for (const [p, pairRows] of Object.entries(next)) {
            next[p] = pairRows.map((r) =>
              resolvedResults[r.monitorId] ? { ...r, result: resolvedResults[r.monitorId] } : r
            );
          }
          saveStoredLiveSignals(next);
          return next;
        });
      }
    }

    if (scanTokenRef.current !== token) return;
    setLastUpdated(new Date());
    setScanState({
      running: false,
      pair: "",
      index: 0,
      total: FOREX_PAIRS.length,
    });
  }, []);

  useEffect(() => {
    startScanRef.current = startScan;
  }, [startScan]);

  const revealPendingSignals = useCallback(() => {
    const nowMs = Date.now();
    const dueEntries = Object.entries(pendingSignalsRef.current)
      .filter(([, signal]) => nowMs - Number(signal.detectedAt || 0) >= PENDING_SIGNAL_DELAY_MS);

    if (dueEntries.length === 0) return;

    const duePairs = new Set(dueEntries.map(([pair]) => pair));
    setPendingSignals((current) => {
      const next = { ...current };
      for (const pair of duePairs) {
        delete next[pair];
      }
      return next;
    });

    setRowsByPair((current) => {
      const next = { ...current };
      for (const [pair, signal] of dueEntries) {
        next[pair] = [stripDetectedAt(signal)];
      }
      saveStoredLiveSignals(next);
      return next;
    });
  }, []);

  useEffect(() => {
    rowsByPairRef.current = rowsByPair;
  }, [rowsByPair]);

  useEffect(() => {
    pendingSignalsRef.current = pendingSignals;
  }, [pendingSignals]);

  useEffect(() => {
    startScan();

    const msUntilNext5m = msUntilNext5mBoundary();
    setNextRefreshAt(Date.now() + msUntilNext5m);
    boundaryTimeoutRef.current = window.setTimeout(() => {
      startScanRef.current?.();
      setNextRefreshAt(Date.now() + REFRESH_INTERVAL_MS);
      intervalRef.current = window.setInterval(() => {
        startScanRef.current?.();
        setNextRefreshAt(Date.now() + REFRESH_INTERVAL_MS);
      }, REFRESH_INTERVAL_MS);
    }, msUntilNext5m);

    return () => {
      scanTokenRef.current += 1;
      window.clearTimeout(boundaryTimeoutRef.current);
      window.clearInterval(intervalRef.current);
    };
  }, [startScan]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(revealPendingSignals, PENDING_SIGNAL_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [revealPendingSignals]);

  useEffect(() => {
    if (activeTab === "history") {
      loadHistory();
    }
  }, [activeTab, loadHistory]);

  const rows = useMemo(
    () => sortByAlertTimeDesc(Object.values(rowsByPair).flat()),
    [rowsByPair]
  );
  const sortedHistoryRows = useMemo(
    () => sortByAlertTimeDesc(historyRows),
    [historyRows]
  );
  const displayedRows = activeTab === "history" ? sortedHistoryRows : rows;
  const pendingIndicators = useMemo(
    () => FOREX_PAIRS
      .map((pair) => {
        const signal = pendingSignals[pair];
        if (!signal) return null;

        return {
          pair,
          countdown: formatCountdown(PENDING_SIGNAL_DELAY_MS - (now - Number(signal.detectedAt || now))),
        };
      })
      .filter(Boolean),
    [pendingSignals, now]
  );

  const errorCount = Object.keys(pairErrors).length;
  const countdown = formatCountdown(nextRefreshAt - now);
  const tableTitle = activeTab === "history" ? "History" : "Signals";
  const tableDate = activeTab === "history" ? "persisted alerts" : todayInIST();
  const emptyMessage = activeTab === "history"
    ? historyLoading ? "Loading alert history" : "No saved alerts yet."
    : scanState.running ? "Scanning pairs" : "No active signals for today's session.";

  return (
    <div className="min-h-full">
      <div className="mb-6 flex flex-col gap-2 border-b border-white/10 pb-5">
        <div className="text-xs uppercase text-[#FFB84D]">FFLC Live Signals</div>
        <h1 className="text-3xl font-semibold text-white">Live Monitor</h1>
      </div>

      <section className="mb-5 flex flex-col gap-3 rounded-lg border border-white/10 bg-[#0c0c14]/80 p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-sm text-neutral-300">
          <span>
            Last updated:{" "}
            <span className="text-white">{lastUpdated ? `${formatClockIST(lastUpdated)} IST` : "Running first scan"}</span>
          </span>
          <span>
            Next scan: <span className="text-[#FFB84D]">{countdown}</span>
          </span>
          {scanState.running && (
            <span className="inline-flex items-center gap-2 text-[#00C9A7]">
              <Loader2 className="h-4 w-4 animate-spin" />
              {scanState.pair} {scanState.index}/{scanState.total}
            </span>
          )}
          {errorCount > 0 && (
            <span className="text-[#FF5370]">{errorCount} pair{errorCount === 1 ? "" : "s"} failed</span>
          )}
          {pendingIndicators.length > 0 && (
            <span className="flex flex-wrap items-center gap-2 text-[#FFB84D]">
              {pendingIndicators.map(({ pair, countdown: pendingCountdown }) => (
                <span key={pair} className="inline-flex items-center gap-1">
                  {pair} ⏳ {pendingCountdown}
                </span>
              ))}
            </span>
          )}
        </div>

        {activeTab === "history" ? (
          <button
            type="button"
            onClick={loadHistory}
            disabled={historyLoading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#00C9A7]/30 bg-[#00C9A7]/15 px-4 text-sm font-semibold text-[#00C9A7] transition hover:bg-[#00C9A7]/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {historyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Reload History
          </button>
        ) : (
          <button
            type="button"
            onClick={startScan}
            disabled={scanState.running}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#00C9A7]/30 bg-[#00C9A7]/15 px-4 text-sm font-semibold text-[#00C9A7] transition hover:bg-[#00C9A7]/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {scanState.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh Now
          </button>
        )}
      </section>

      <div className="mb-4 flex w-fit items-center gap-1 rounded-lg border border-white/10 bg-[#0c0c14]/70 p-1">
        {[
          ["live", "Live"],
          ["history", "History"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={`rounded-md px-4 py-2 text-sm font-semibold transition ${
              activeTab === id
                ? "border border-[#00C9A7]/30 bg-[#00C9A7]/15 text-[#00C9A7]"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {historyError && activeTab === "history" && (
        <div className="mb-4 rounded-lg border border-[#FF5370]/35 bg-[#FF5370]/10 px-4 py-3 text-sm text-[#FF5370]">
          {historyError}
        </div>
      )}

      <section className="overflow-hidden rounded-lg border border-white/10 bg-[#0c0c14]/80">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="text-sm font-semibold text-white">{tableTitle}</div>
          <div className="font-mono text-xs uppercase text-neutral-500">
            {displayedRows.length} alert{displayedRows.length === 1 ? "" : "s"} | {tableDate}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead className="bg-white/[0.03] text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Pair</th>
                <th className="px-4 py-3">Direction</th>
                <th className="px-4 py-3 text-right">Target</th>
                <th className="px-4 py-3">Result</th>
              </tr>
            </thead>
            <tbody>
              {displayedRows.map((row) => {
                const isUp = row.direction === "UP";
                const isPending = row.result === "pending";
                const isExpanded = expandedId === row.monitorId;
                const hasChart = !!(row.c1 && row.c2 && row.c3);
                const rowTone = isPending
                  ? "border-[#FFB84D]/25 bg-[#FFB84D]/10 hover:bg-[#FFB84D]/15"
                  : isUp
                    ? "border-[#00C9A7]/20 bg-[#00C9A7]/[0.06] hover:bg-[#00C9A7]/10"
                    : "border-[#FF5370]/20 bg-[#FF5370]/[0.06] hover:bg-[#FF5370]/10";
                const directionTone = isUp
                  ? "border-[#00C9A7]/35 bg-[#00C9A7]/10 text-[#00C9A7]"
                  : "border-[#FF5370]/35 bg-[#FF5370]/10 text-[#FF5370]";

                return (
                  <Fragment key={row.monitorId}>
                    <tr
                      className={`border-t transition ${rowTone} ${hasChart ? "cursor-pointer select-none" : ""}`}
                      onClick={() => hasChart && setExpandedId(isExpanded ? null : row.monitorId)}
                    >
                      <td className="px-4 py-3 font-mono text-neutral-200">{formatPatternTime(row.alert_timestamp)}</td>
                      <td className="px-4 py-3 font-mono font-semibold text-white">{row.pair}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex min-w-[72px] justify-center rounded-md border px-2.5 py-1 text-xs font-semibold ${directionTone}`}>
                          {row.direction || "--"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[#FFB84D]">{formatPrice(row.target)}</td>
                      <td className="px-4 py-3"><ResultBadge result={row.result} /></td>
                    </tr>
                    {isExpanded && hasChart && (
                      <tr>
                        <td colSpan={5} className="border-t border-white/5 bg-[#07070f] px-4 pb-4 pt-2">
                          <CandleChart pattern={row} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {displayedRows.length === 0 && (
          <div className="px-4 py-12 text-center font-mono text-sm uppercase text-neutral-500">
            {emptyMessage}
          </div>
        )}
      </section>
    </div>
  );
}
