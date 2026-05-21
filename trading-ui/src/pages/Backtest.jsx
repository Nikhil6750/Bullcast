import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Layers, Loader2, Play, Upload } from "lucide-react";
import { ColorType, createChart, LineStyle } from "lightweight-charts";
import { getBacktestPairs, runBacktest, runBacktestFromCSV, runMultiBacktest } from "../services/api";

const DEFAULT_PAIRS = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USDCHF",
  "USDCAD",
  "AUDUSD",
  "EURJPY",
  "GBPJPY",
  "CHFJPY",
  "CADJPY",
  "AUDJPY",
  "EURAUD",
  "GBPAUD",
  "EURGBP",
  "EURCAD",
  "GBPCAD",
  "GBPCHF",
  "EURCHF",
  "AUDCHF",
  "AUDCAD",
];

const METHOD_LABELS = {
  strong_midpoint: "Strong midpoint",
  weak_c1_open: "Weak C1 open",
  news_wick_prominent: "News wick prominent",
  news_wick_not_prominent: "News wick not prominent",
};

const RESULT_STYLES = {
  win: "border-[#00C9A7]/30 bg-[#00C9A7]/10 text-[#00C9A7]",
  loss: "border-[#FF5370]/30 bg-[#FF5370]/10 text-[#FF5370]",
  setup_not_formed: "border-white/15 bg-white/5 text-neutral-300",
  pending: "border-[#FFB84D]/30 bg-[#FFB84D]/10 text-[#FFB84D]",
};
const IST_OFFSET_SECONDS = 19800;

function chartTime(timestamp) {
  const value = Number(timestamp);
  return Number.isFinite(value) ? value + IST_OFFSET_SECONDS : null;
}

function localDateInputValue() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function dateStringInISTFromSeconds(timestamp) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(Number(timestamp) * 1000));
  const value = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function shiftDateString(dateString, days) {
  if (!dateString) return "";
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function cleanCsvCell(value) {
  return String(value || "").trim().replace(/^"|"$/g, "");
}

function parseCsvDateRange(text) {
  const lines = String(text || "").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;

  const headers = lines[0]
    .replace(/^\uFEFF/, "")
    .split(",")
    .map((header) => cleanCsvCell(header).toLowerCase());
  const timeIndex = Math.max(headers.findIndex((header) => header === "time" || header === "timestamp"), 0);
  const timestamps = lines
    .slice(1)
    .map((line) => {
      const raw = cleanCsvCell(line.split(",")[timeIndex]);
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) return null;
      return parsed > 10_000_000_000 ? Math.floor(parsed / 1000) : parsed;
    })
    .filter((timestamp) => timestamp !== null);

  if (!timestamps.length) return null;

  const minTs = Math.min(...timestamps);
  const maxTs = Math.max(...timestamps);
  return {
    start: dateStringInISTFromSeconds(minTs),
    end: dateStringInISTFromSeconds(maxTs),
  };
}

function formatPrice(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(5) : "--";
}

function formatPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : "0.00";
}

function formatIST(timestamp) {
  const date = new Date(Number(timestamp) * 1000);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${value("day")}-${value("month")}-${value("year")} ${value("hour")}:${value("minute")} ${value("dayPeriod").toUpperCase()}`;
}

function StatCard({ label, value, tone = "neutral", large = false }) {
  const toneClass = {
    green: "text-[#00C9A7]",
    red: "text-[#FF5370]",
    orange: "text-[#FFB84D]",
    neutral: "text-white",
  }[tone];

  return (
    <div className="min-h-[104px] rounded-lg border border-white/10 bg-[#0c0c14]/80 p-4">
      <div className="text-xs uppercase tracking-[0.16em] text-neutral-500">{label}</div>
      <div className={`mt-3 font-mono font-semibold ${toneClass} ${large ? "text-4xl" : "text-3xl"}`}>
        {value}
      </div>
    </div>
  );
}

function Badge({ children, className = "" }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${className}`}>
      {children}
    </span>
  );
}

function DirectionBadge({ direction }) {
  const isUp = direction === "UP";
  return (
    <Badge className={isUp ? "border-[#00C9A7]/30 bg-[#00C9A7]/10 text-[#00C9A7]" : "border-[#FF5370]/30 bg-[#FF5370]/10 text-[#FF5370]"}>
      <span className={`h-2 w-2 rounded-full ${isUp ? "bg-[#00C9A7]" : "bg-[#FF5370]"}`} />
      {direction}
    </Badge>
  );
}

function PullbackBadge({ type }) {
  const isStrong = type === "strong";
  return (
    <Badge className={isStrong ? "border-[#00C9A7]/25 bg-[#00C9A7]/10 text-[#00C9A7]" : "border-white/15 bg-white/5 text-neutral-300"}>
      {isStrong ? "Strong" : "Weak"}
    </Badge>
  );
}

function ResultBadge({ result }) {
  const label = String(result || "pending").replace(/_/g, " ").toUpperCase();
  return <Badge className={RESULT_STYLES[result] || RESULT_STYLES.pending}>{label}</Badge>;
}

function PatternChart({ pattern, index, sessionCandles = [] }) {
  const wrapperRef = useRef(null);
  const chartRef = useRef(null);
  const [overlay, setOverlay] = useState(null);
  const patternCandles = useMemo(
    () => [pattern.c1, pattern.c2, pattern.c3, ...(pattern.pullback_candles || [])].filter(Boolean),
    [pattern]
  );
  const candles = useMemo(() => {
    const source = Array.isArray(sessionCandles) && sessionCandles.length ? sessionCandles : patternCandles;
    return source
      .map((candle) => ({
        time: Number(candle.time),
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
      }))
      .filter((candle) => Number.isFinite(candle.time) && Number.isFinite(candle.open));
  }, [sessionCandles, patternCandles]);

  useEffect(() => {
    const container = chartRef.current;
    if (!container || !candles.length) return undefined;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 420,
      layout: {
        background: { type: ColorType.Solid, color: "#0d0d1a" },
        textColor: "#9ca3af",
        fontFamily: "IBM Plex Mono, monospace",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.05)" },
        horzLines: { color: "rgba(255,255,255,0.07)" },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.12)",
        scaleMargins: { top: 0.12, bottom: 0.12 },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.12)",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: "rgba(255,255,255,0.25)" },
        horzLine: { color: "rgba(255,255,255,0.25)" },
      },
    });

    const series = chart.addCandlestickSeries({
      upColor: "#00C9A7",
      downColor: "#FF5370",
      borderUpColor: "#00C9A7",
      borderDownColor: "#FF5370",
      wickUpColor: "#00C9A7",
      wickDownColor: "#FF5370",
      priceFormat: { type: "price", precision: 5, minMove: 0.00001 },
    });

    const istCandles = candles
      .map((candle) => ({ ...candle, time: chartTime(candle.time) }))
      .filter((candle) => candle.time !== null);
    series.setData(istCandles);
    series.createPriceLine({
      price: Number(pattern.target),
      color: "#FFB84D",
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "TARGET",
    });
    const alertChartTime = chartTime(pattern.alert_timestamp);
    if (alertChartTime !== null) {
      series.setMarkers([{
        time: alertChartTime,
        position: pattern.direction === "DOWN" ? "aboveBar" : "belowBar",
        color: "#FFB84D",
        shape: "circle",
        text: "ALERT",
      }]);
    }
    chart.timeScale().fitContent();

    const updateOverlay = () => {
      const zoneTop = series.priceToCoordinate(Number(pattern.zone_upper));
      const zoneBottom = series.priceToCoordinate(Number(pattern.zone_lower));
      const startTime = chartTime(patternCandles[0]?.time);
      const endTime = chartTime(patternCandles[patternCandles.length - 1]?.time || pattern.alert_timestamp);
      const alertTime = chartTime(pattern.alert_timestamp);
      const startX = startTime !== null ? chart.timeScale().timeToCoordinate(startTime) : null;
      const endX = endTime !== null ? chart.timeScale().timeToCoordinate(endTime) : null;
      const alertX = alertTime !== null ? chart.timeScale().timeToCoordinate(alertTime) : null;

      setOverlay({
        zone: zoneTop !== null && zoneBottom !== null ? {
          top: Math.min(zoneTop, zoneBottom),
          height: Math.max(Math.abs(zoneBottom - zoneTop), 2),
        } : null,
        pattern: startX !== null && endX !== null ? {
          left: Math.min(startX, endX),
          width: Math.max(Math.abs(endX - startX), 8),
        } : null,
        alert: alertX !== null ? { left: alertX } : null,
      });
    };

    const resizeObserver = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width);
      if (width > 0) {
        chart.applyOptions({ width });
        updateOverlay();
      }
    });

    resizeObserver.observe(container);
    chart.timeScale().subscribeVisibleTimeRangeChange(updateOverlay);
    const overlayTimer = window.setTimeout(updateOverlay, 0);

    return () => {
      window.clearTimeout(overlayTimer);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(updateOverlay);
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [candles, pattern, patternCandles]);

  return (
    <div className="rounded-lg border border-white/10 bg-[#0d0d1a] p-4">
      <div className="mb-3 font-mono text-xs uppercase tracking-[0.14em] text-neutral-300">
        ID: {pattern.id || index + 1} | Pair: {pattern.pair} | Time: {formatIST(pattern.alert_timestamp)}
      </div>
      <div ref={wrapperRef} className="relative overflow-hidden rounded-md border border-white/5 bg-[#0d0d1a]">
        <div ref={chartRef} className="h-[420px] w-full" />
        {overlay?.zone && (
          <div
            className="pointer-events-none absolute left-0 right-0 z-10 border-y border-[#FFB84D]/45 bg-[#FFB84D]/10"
            style={{ top: overlay.zone.top, height: overlay.zone.height }}
          />
        )}
        {overlay?.pattern && (
          <div
            className={`pointer-events-none absolute bottom-0 top-0 z-10 border-x ${pattern.direction === "DOWN" ? "border-[#FF5370]/35 bg-[#FF5370]/10" : "border-[#00C9A7]/35 bg-[#00C9A7]/10"}`}
            style={{ left: overlay.pattern.left, width: overlay.pattern.width }}
          />
        )}
        {overlay?.alert && (
          <div
            className="pointer-events-none absolute bottom-0 top-0 z-20 border-l border-dashed border-[#FFB84D]"
            style={{ left: overlay.alert.left }}
          />
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-neutral-500">
        <span>Target: <span className="text-[#FFB84D]">{formatPrice(pattern.target)}</span></span>
        <span>Zone: <span className="text-neutral-300">{formatPrice(pattern.zone_lower)} - {formatPrice(pattern.zone_upper)}</span></span>
        <span>Pattern: <span className="text-neutral-300">C1-C{patternCandles.length}</span></span>
      </div>
    </div>
  );
}

const SOURCE_MODES = [
  { id: "auto", label: "Saved Data" },
  { id: "upload", label: "Upload CSV" },
];

export default function Backtest() {
  const [pairs, setPairs] = useState(DEFAULT_PAIRS);
  const [pair, setPair] = useState("EURUSD");
  const [date, setDate] = useState(localDateInputValue());
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("single");
  const [sourceMode, setSourceMode] = useState("auto");
  const [csvFile, setCsvFile] = useState(null);
  const [csvDateRange, setCsvDateRange] = useState(null);
  const fileInputRef = useRef(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [expandedId, setExpandedId] = useState("");

  useEffect(() => {
    let active = true;
    getBacktestPairs()
      .then((payload) => {
        if (!active) return;
        const nextPairs = Array.isArray(payload?.pairs) && payload.pairs.length ? payload.pairs : DEFAULT_PAIRS;
        setPairs(nextPairs);
        setPair((current) => nextPairs.includes(current) ? current : nextPairs[0]);
      })
      .catch(() => {
        if (active) setPairs(DEFAULT_PAIRS);
      });
    return () => {
      active = false;
    };
  }, []);

  const patterns = useMemo(() => result?.patterns || [], [result]);
  const selectedDateOutsideCsvRange = sourceMode === "upload"
    && csvDateRange
    && date
    && (date < csvDateRange.start || date > csvDateRange.end);

  const handleSourceModeChange = (nextMode) => {
    if (nextMode === sourceMode) return;
    setSourceMode(nextMode);
    setCsvFile(null);
    setCsvDateRange(null);
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleCsvFileChange = async (file) => {
    setCsvFile(file);
    setCsvDateRange(null);
    setError("");

    if (!file) return;

    const nameUpper = file.name.toUpperCase();
    const matchedPair = pairs.find((candidate) => nameUpper.includes(candidate));
    if (matchedPair) {
      setPair(matchedPair);
    }

    try {
      const text = await file.text();
      const range = parseCsvDateRange(text);
      if (!range) return;

      const completeSessionDate = shiftDateString(range.end, -1);
      setCsvDateRange(range);
      setDate(completeSessionDate >= range.start ? completeSessionDate : range.end);
    } catch {
      setError("Could not parse this CSV's date range. You can still run it manually if the columns are valid.");
    }
  };

  const runSingle = async () => {
    if (sourceMode === "upload" && !csvFile) {
      setError("Please select a CSV file first.");
      return;
    }
    setLoading(true);
    setMode("single");
    setError("");
    setExpandedId("");
    try {
      const payload = sourceMode === "upload"
        ? await runBacktestFromCSV(pair, date, csvFile)
        : await runBacktest(pair, date);
      setResult(payload);
    } catch (err) {
      setError(err?.message || "Backtest failed.");
    } finally {
      setLoading(false);
    }
  };

  const runAll = async () => {
    setLoading(true);
    setMode("multi");
    setError("");
    setExpandedId("");
    try {
      const payload = await runMultiBacktest(pairs, date);
      setResult(payload);
    } catch (err) {
      setError(err?.message || "Multi-pair backtest failed.");
    } finally {
      setLoading(false);
    }
  };

  const toggleRow = (patternId) => {
    setExpandedId((current) => current === patternId ? "" : patternId);
  };

  const sessionCandlesForPattern = (pattern) => {
    if (Array.isArray(result?.results)) {
      return result.results.find((item) => item.pair === pattern.pair)?.candles || [];
    }
    return result?.candles || [];
  };

  return (
    <div className="min-h-full">
      <div className="mb-6 flex flex-col gap-2 border-b border-white/10 pb-5">
        <div className="text-xs uppercase tracking-[0.24em] text-[#FFB84D]">FFLC Strategy Backtester</div>
        <h1 className="text-3xl font-semibold tracking-tight text-white">Backtest</h1>
      </div>

      {/* Source mode toggle */}
      <div className="mb-3 flex items-center gap-1 rounded-lg border border-white/10 bg-[#0c0c14]/70 p-1 w-fit">
        {SOURCE_MODES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => handleSourceModeChange(s.id)}
            className={`rounded-md px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] transition ${
              sourceMode === s.id
                ? "bg-[#00C9A7]/20 text-[#00C9A7] border border-[#00C9A7]/30"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <section className="mb-6 grid gap-3 rounded-lg border border-white/10 bg-[#0c0c14]/70 p-4 md:grid-cols-[minmax(160px,1fr)_minmax(150px,220px)_auto_auto]">
        <label className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-[0.16em] text-neutral-500">Pair</span>
          <select
            value={pair}
            onChange={(event) => setPair(event.target.value)}
            className="h-11 rounded-md border border-white/10 bg-[#090910] px-3 font-mono text-sm text-white outline-none transition focus:border-[#00C9A7]/60"
          >
            {pairs.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-[0.16em] text-neutral-500">Date</span>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="h-11 rounded-md border border-white/10 bg-[#090910] px-3 font-mono text-sm text-white outline-none transition focus:border-[#00C9A7]/60"
          />
        </label>

        <button
          type="button"
          onClick={runSingle}
          disabled={loading}
          className="mt-auto inline-flex h-11 items-center justify-center gap-2 rounded-md border border-[#00C9A7]/30 bg-[#00C9A7]/15 px-4 text-sm font-semibold text-[#00C9A7] transition hover:bg-[#00C9A7]/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading && mode === "single" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Run Backtest
        </button>

        <button
          type="button"
          onClick={runAll}
          disabled={loading || sourceMode === "upload"}
          title={sourceMode === "upload" ? "Run All Pairs is not available in Upload mode" : ""}
          className="mt-auto inline-flex h-11 items-center justify-center gap-2 rounded-md border border-[#FFB84D]/35 bg-[#FFB84D]/10 px-4 text-sm font-semibold text-[#FFB84D] transition hover:bg-[#FFB84D]/15 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading && mode === "multi" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers className="h-4 w-4" />}
          Run All Pairs
        </button>
      </section>

      {/* CSV upload area, shown only in upload mode */}
      {sourceMode === "upload" && (
        <section className="mb-6 rounded-lg border border-dashed border-white/20 bg-[#0c0c14]/60 p-5">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => handleCsvFileChange(e.target.files?.[0] || null)}
          />
          {csvFile ? (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[#00C9A7]/15 text-[#00C9A7]">
                  <Upload className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-mono text-sm text-white">{csvFile.name}</div>
                  <div className="text-xs text-neutral-500">{(csvFile.size / 1024).toFixed(1)} KB - ready to run</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCsvFile(null);
                  setCsvDateRange(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className="text-xs text-neutral-500 hover:text-[#FF5370] transition"
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center gap-2 py-4 text-center transition hover:opacity-80"
            >
              <Upload className="h-6 w-6 text-neutral-500" />
              <span className="text-sm text-neutral-400">Click to choose a CSV file</span>
              <span className="text-xs text-neutral-600">Must have columns: time, open, high, low, close</span>
            </button>
          )}
          {csvDateRange && (
            <div className="mt-2 font-mono text-xs text-neutral-500">
              Data available: {csvDateRange.start} -&gt; {csvDateRange.end}
            </div>
          )}
        </section>
      )}

      {selectedDateOutsideCsvRange && (
        <div className="mb-4 rounded-lg border border-[#FFB84D]/35 bg-[#FFB84D]/10 px-4 py-2 font-mono text-xs text-[#FFB84D]">
          Warning: selected date {date} is outside this file&apos;s data range ({csvDateRange.start} -&gt; {csvDateRange.end})
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-lg border border-[#FF5370]/35 bg-[#FF5370]/10 px-4 py-3 text-sm text-[#FF5370]">
          {error}
        </div>
      )}

      {result && (
        <>
          <section className="mb-6 grid gap-3 md:grid-cols-5">
            <StatCard label="Total Setups Detected" value={result.total_setups || 0} />
            <StatCard label="Wins" value={result.wins || 0} tone="green" />
            <StatCard label="Losses" value={result.losses || 0} tone="red" />
            <StatCard label="Setup Not Formed" value={result.setup_not_formed || 0} />
            <StatCard label="Win Rate %" value={`${formatPercent(result.win_rate)}%`} tone="orange" large />
          </section>

          <div className="mb-4 flex flex-wrap gap-x-6 gap-y-2 rounded-lg border border-white/5 bg-[#0c0c14]/50 px-4 py-2 font-mono text-xs text-neutral-500">
            <span>Candles loaded: <span className="text-neutral-300">{result.candles_count ?? 0}</span></span>
            <span>Date: <span className="text-neutral-300">{result.date || date}</span></span>
            <span>Source: <span className="text-neutral-300">{result.data_source || "unknown"}</span></span>
            <span>Monday skip: <span className="text-neutral-300">{result.skipped ? "Yes" : "No"}</span></span>
          </div>

          <section className="overflow-hidden rounded-lg border border-white/10 bg-[#0c0c14]/80">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="text-sm font-semibold text-white">Pattern Results</div>
                {result.data_source && (
                  <span className={`rounded-md border px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.12em] ${
                    result.data_source === "upload"
                      ? "border-[#00C9A7]/30 bg-[#00C9A7]/10 text-[#00C9A7]"
                      : result.data_source === "csv"
                      ? "border-[#FFB84D]/30 bg-[#FFB84D]/10 text-[#FFB84D]"
                      : "border-white/15 bg-white/5 text-neutral-400"
                  }`}>
                    {result.data_source === "upload" ? "Uploaded CSV" : result.data_source === "csv" ? "Saved CSV" : "Live Feed"}
                  </span>
                )}
              </div>
              <div className="font-mono text-xs uppercase tracking-[0.14em] text-neutral-500">
                {mode === "multi" ? `${pairs.length} pairs` : pair} | {result.date || date}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.13em] text-neutral-500">
                  <tr>
                    <th className="w-12 px-4 py-3"></th>
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">Pair</th>
                    <th className="px-4 py-3">Direction</th>
                    <th className="px-4 py-3 text-right">Target Price</th>
                    <th className="px-4 py-3">Pullback Type</th>
                    <th className="px-4 py-3">Target Method</th>
                    <th className="px-4 py-3">Result</th>
                    <th className="px-4 py-3">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {patterns.map((pattern, index) => {
                    const rowId = pattern.id || `${pattern.pair}-${pattern.alert_timestamp}-${index}`;
                    const expanded = expandedId === rowId;
                    return (
                      <Fragment key={rowId}>
                        <tr
                          role="button"
                          tabIndex={0}
                          onClick={() => toggleRow(rowId)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") toggleRow(rowId);
                          }}
                          className="cursor-pointer border-t border-white/10 transition hover:bg-white/[0.03]"
                        >
                          <td className="px-4 py-3 text-neutral-500">
                            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </td>
                          <td className="px-4 py-3 font-mono text-neutral-300">{formatIST(pattern.alert_timestamp)}</td>
                          <td className="px-4 py-3 font-mono text-white">{pattern.pair}</td>
                          <td className="px-4 py-3"><DirectionBadge direction={pattern.direction} /></td>
                          <td className="px-4 py-3 text-right font-mono text-[#FFB84D]">{formatPrice(pattern.target)}</td>
                          <td className="px-4 py-3"><PullbackBadge type={pattern.pullback_type} /></td>
                          <td className="px-4 py-3 text-neutral-300">{METHOD_LABELS[pattern.target_method] || pattern.target_method}</td>
                          <td className="px-4 py-3"><ResultBadge result={pattern.result} /></td>
                          <td className="px-4 py-3 text-neutral-400">{pattern.reason}</td>
                        </tr>
                        {expanded && (
                          <tr className="border-t border-white/10 bg-black/15">
                            <td colSpan={9} className="px-4 py-4">
                              <PatternChart pattern={pattern} index={index} sessionCandles={sessionCandlesForPattern(pattern)} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {!loading && patterns.length === 0 && (
              <div className="px-4 py-12 text-center font-mono text-sm uppercase tracking-[0.14em] text-neutral-500">
                No patterns detected for this session.
              </div>
            )}
          </section>
        </>
      )}

      {loading && !result && (
        <div className="flex min-h-[320px] items-center justify-center rounded-lg border border-white/10 bg-[#0c0c14]/60">
          <div className="flex items-center gap-3 font-mono text-sm uppercase tracking-[0.16em] text-neutral-400">
            <Loader2 className="h-5 w-5 animate-spin text-[#FFB84D]" />
            Running backtest
          </div>
        </div>
      )}
    </div>
  );
}
