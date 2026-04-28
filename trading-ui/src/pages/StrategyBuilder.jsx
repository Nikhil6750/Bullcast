import axios from "axios";
import { startTransition, useDeferredValue, useMemo, useState } from "react";
import ForexChart from "../components/ForexChart";
import PerformanceMetrics from "../components/PerformanceMetrics";
import SetupsVirtualList from "../components/SetupsVirtualList";
import { BASE_URL } from "../lib/api";

const STRATEGY_OPTIONS = [
  { value: "moving_average", label: "Moving Average Strategy" },
  { value: "rsi", label: "RSI Strategy" },
  { value: "breakout", label: "Breakout Strategy" },
  { value: "pine_script", label: "Pine Script Strategy" },
];

const STRATEGY_FIELDS = {
  moving_average: [
    { key: "fast_ma_period", label: "Fast MA Period", type: "number", min: 1, step: 1 },
    { key: "slow_ma_period", label: "Slow MA Period", type: "number", min: 2, step: 1 },
    { key: "ma_type", label: "MA Type", type: "select", options: ["EMA", "SMA"] },
  ],
  rsi: [
    { key: "rsi_length", label: "RSI Length", type: "number", min: 2, step: 1 },
    { key: "overbought", label: "Overbought", type: "number", min: 1, max: 100, step: 1 },
    { key: "oversold", label: "Oversold", type: "number", min: 0, max: 99, step: 1 },
  ],
  breakout: [
    { key: "lookback_period", label: "Lookback Period", type: "number", min: 2, step: 1 },
    { key: "breakout_threshold", label: "Breakout Threshold (%)", type: "number", min: 0, step: 0.1 },
  ],
};

const DEFAULT_PARAMETERS = {
  moving_average: { fast_ma_period: 12, slow_ma_period: 26, ma_type: "EMA" },
  rsi: { rsi_length: 14, overbought: 70, oversold: 30 },
  breakout: { lookback_period: 20, breakout_threshold: 0.5 },
  pine_script: {},
};

const DEFAULT_PINE_SCRIPT = `//@version=5
fast = ta.ema(close, 12)
slow = ta.ema(close, 26)
buy = ta.crossover(fast, slow)
sell = ta.crossunder(fast, slow)`;

function createEmptyRunData() {
  return {
    candles: [],
    signals: [],
    overlays: [],
    setups: [],
    trades: [],
    metrics: {
      totalTrades: 0,
      signalCount: 0,
      winRate: 0,
      netPnL: 0,
      avgReturn: 0,
      maxDrawdown: 0,
      profitFactor: null,
      longTrades: 0,
      shortTrades: 0,
    },
    strategy: null,
  };
}

function formatTime(sec) {
  const value = Number(sec);
  if (!Number.isFinite(value)) {
    return "-";
  }

  return new Date(value * 1000).toISOString().replace("T", " ").replace(".000Z", "Z");
}

function formatPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return "-";
  }

  const abs = Math.abs(num);
  if (abs >= 1000) {
    return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (abs >= 1) {
    return num.toFixed(4);
  }
  return num.toFixed(6);
}

function formatSignedPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return "-";
  }

  const prefix = num > 0 ? "+" : "";
  return `${prefix}${num.toFixed(2)}%`;
}

function extractBackendError(err) {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const data = err.response?.data;
    if (typeof data === "string" && data.trim()) {
      return data;
    }
    if (data?.detail) {
      return String(data.detail);
    }
    if (data?.error) {
      return String(data.error);
    }
    if (status) {
      return `HTTP ${status}`;
    }
    return err.message || "Request failed";
  }
  return String(err?.message || err || "Unknown error");
}

function inferMarketPairFromFilename(filename) {
  const name = String(filename || "");
  if (!name) {
    return { market: "", pair: "", error: "" };
  }

  if (name.slice(-4).toLowerCase() !== ".csv") {
    return { market: "", pair: "", error: "Invalid CSV filename format" };
  }

  const stem = name.slice(0, -4);
  if (stem.startsWith("FX_")) {
    const rest = stem.slice("FX_".length);
    const pair = rest.split("_", 1)[0] || "";
    if (!pair) {
      return { market: "", pair: "", error: "Invalid CSV filename format" };
    }
    return { market: "forex", pair, error: "" };
  }

  if (stem.startsWith("BINANCE_")) {
    const rest = stem.slice("BINANCE_".length);
    const pair = rest.split("_", 1)[0] || "";
    if (!pair) {
      return { market: "", pair: "", error: "Invalid CSV filename format" };
    }
    return { market: "crypto", pair, error: "" };
  }

  return { market: "", pair: "", error: "Invalid CSV filename format" };
}

function normalizeRunData(data) {
  const empty = createEmptyRunData();
  return {
    candles: Array.isArray(data?.candles) ? data.candles : empty.candles,
    signals: Array.isArray(data?.signals) ? data.signals : empty.signals,
    overlays: Array.isArray(data?.overlays) ? data.overlays : empty.overlays,
    setups: Array.isArray(data?.setups)
      ? [...data.setups].sort((left, right) => Number(left?.entry_time) - Number(right?.entry_time))
      : empty.setups,
    trades: Array.isArray(data?.trades) ? data.trades : empty.trades,
    metrics: data?.metrics ? { ...empty.metrics, ...data.metrics } : empty.metrics,
    strategy: data?.strategy || null,
  };
}

function ParameterFields({ strategyType, parameters, onChange }) {
  if (strategyType === "pine_script") {
    return (
      <div className="rounded-xl border border-[var(--color-border)] bg-[rgba(10,10,10,0.45)] p-4 text-sm text-[var(--color-text-secondary)]">
        Pine Script drives the signal logic for this mode. Use the Pine Script tab to edit the strategy and define
        `buy` and `sell` conditions.
      </div>
    );
  }

  const fields = STRATEGY_FIELDS[strategyType] || [];

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {fields.map((field) => (
        <label key={field.key} className="block">
          <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
            {field.label}
          </div>
          {field.type === "select" ? (
            <select
              className="terminal-input"
              value={parameters[field.key] ?? field.options?.[0] ?? ""}
              onChange={(event) => onChange(field.key, event.target.value)}
            >
              {field.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="terminal-input"
              type="number"
              min={field.min}
              max={field.max}
              step={field.step}
              value={parameters[field.key] ?? ""}
              onChange={(event) => onChange(field.key, event.target.value)}
            />
          )}
        </label>
      ))}
    </div>
  );
}

function DetailRow({ label, value, tone }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] py-2 last:border-b-0">
      <div className="text-xs uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">{label}</div>
      <div className={`text-sm ${tone || "text-[var(--color-text)]"}`}>{value}</div>
    </div>
  );
}

function StrategyBuilder() {
  const [csvFile, setCsvFile] = useState(null);
  const [strategyType, setStrategyType] = useState("moving_average");
  const [strategyParameters, setStrategyParameters] = useState(DEFAULT_PARAMETERS);
  const [pineScript, setPineScript] = useState(DEFAULT_PINE_SCRIPT);
  const [activeTab, setActiveTab] = useState("builder");
  const [runData, setRunData] = useState(() => createEmptyRunData());
  const [selectedSetupId, setSelectedSetupId] = useState(null);
  const [viewport, setViewport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const inferred = useMemo(() => inferMarketPairFromFilename(csvFile?.name), [csvFile]);
  const activeStrategy = useMemo(
    () => STRATEGY_OPTIONS.find((option) => option.value === strategyType) || STRATEGY_OPTIONS[0],
    [strategyType]
  );
  const currentParameters = strategyParameters[strategyType] || {};
  const deferredSetups = useDeferredValue(runData.setups);

  const selectedSetup = useMemo(
    () => runData.setups.find((setup) => setup.id === selectedSetupId) || null,
    [runData.setups, selectedSetupId]
  );

  const canRun = Boolean(csvFile) && !loading;

  const updateParameter = (key, value) => {
    setStrategyParameters((previous) => ({
      ...previous,
      [strategyType]: {
        ...previous[strategyType],
        [key]: value,
      },
    }));
  };

  const selectSetup = (setup) => {
    if (!setup) {
      return;
    }

    setSelectedSetupId(setup.id);
    setViewport({
      from: setup.range_start_time,
      to: setup.range_end_time,
    });
  };

  const resetView = () => {
    setSelectedSetupId(null);
    setViewport(null);
  };

  const onRun = async () => {
    if (!csvFile) {
      return;
    }

    setError("");
    setLoading(true);

    try {
      const form = new FormData();
      form.append("file", csvFile);
      form.append("strategy_type", strategyType);
      form.append("parameters_json", JSON.stringify(strategyParameters[strategyType] || {}));
      form.append("pine_script", strategyType === "pine_script" ? pineScript : "");

      const response = await axios.post(`${BASE_URL}/run-strategy`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const normalized = normalizeRunData(response?.data || {});
      startTransition(() => {
        setRunData(normalized);
        setSelectedSetupId(null);
        setViewport(null);
        setActiveTab("setups");
      });
    } catch (err) {
      setError(extractBackendError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen px-3 py-3 sm:px-4 sm:py-4">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-3">
        <div className="glass-panel px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--color-text-secondary)]">
                Strategy Lab
              </div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--color-text)]">
                Quant research terminal
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-[var(--color-text-secondary)]">
                Backend-evaluated signals, one persistent chart, and setup-driven viewport changes.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-[minmax(220px,1.15fr)_minmax(220px,0.95fr)_auto] xl:min-w-[820px]">
              <label className="block">
                <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
                  CSV Dataset
                </div>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="terminal-input file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-sm file:font-medium file:text-[var(--color-text)] hover:file:bg-white/14"
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    setCsvFile(file);
                    setError("");
                    setSelectedSetupId(null);
                    setViewport(null);
                    setActiveTab(strategyType === "pine_script" ? "pine" : "builder");
                    startTransition(() => setRunData(createEmptyRunData()));
                  }}
                />
              </label>

              <label className="block">
                <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
                  Strategy Type
                </div>
                <select
                  className="terminal-input"
                  value={strategyType}
                  onChange={(event) => {
                    const value = event.target.value;
                    setStrategyType(value);
                    if (value === "pine_script") {
                      setActiveTab("pine");
                    } else if (activeTab === "pine") {
                      setActiveTab("builder");
                    }
                  }}
                >
                  {STRATEGY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <button type="button" onClick={onRun} disabled={!canRun} className="terminal-button self-end">
                {loading ? "Evaluating..." : "Run Strategy"}
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <span className="rounded-full border border-[var(--color-border)] bg-[rgba(10,10,10,0.45)] px-3 py-1.5">
              {inferred.market ? `Market ${inferred.market}` : "Market -"}
            </span>
            <span className="rounded-full border border-[var(--color-border)] bg-[rgba(10,10,10,0.45)] px-3 py-1.5">
              {inferred.pair ? `Pair ${inferred.pair}` : "Pair -"}
            </span>
            <span className="rounded-full border border-[var(--color-border)] bg-[rgba(10,10,10,0.45)] px-3 py-1.5">
              Timeframe 5m
            </span>
            <span className="rounded-full border border-[var(--color-border)] bg-[rgba(10,10,10,0.45)] px-3 py-1.5">
              {activeStrategy.label}
            </span>
          </div>
        </div>

        {(inferred.error || error) && (
          <div className="glass-panel border-red-500/20 px-4 py-3 text-sm text-red-200">
            {inferred.error || error}
          </div>
        )}

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_390px]">
          <div className="flex min-h-0 flex-col gap-3">
            <div className="glass-panel p-3 sm:p-4">
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
                    Price Chart
                  </div>
                  <div className="mt-1 text-sm text-[var(--color-text)]">
                    {runData.candles.length
                      ? `${runData.candles.length} candles, ${runData.signals.length} backend signals`
                      : "Upload a dataset and run a strategy to load the chart."}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button type="button" className="secondary-button" onClick={resetView}>
                    Fit Data
                  </button>
                </div>
              </div>

              <div className="relative h-[420px] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] lg:h-[560px]">
                <ForexChart
                  candles={runData.candles}
                  signals={runData.signals}
                  overlays={runData.overlays}
                  viewport={viewport}
                />

                {runData.candles.length === 0 && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-[var(--color-text-secondary)]">
                    The chart stays mounted and only changes its visible range when you open a setup.
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
              <div className="glass-panel p-4">
                <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
                  Performance
                </div>
                <PerformanceMetrics metrics={runData.metrics} />
              </div>

              <div className="glass-panel p-4">
                <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
                  Setup Focus
                </div>

                {selectedSetup ? (
                  <div>
                    <div className="mb-3 text-lg font-semibold text-[var(--color-text)]">{selectedSetup.label}</div>
                    <DetailRow label="Direction" value={selectedSetup.direction} />
                    <DetailRow label="Entry Time" value={formatTime(selectedSetup.entry_time)} />
                    <DetailRow label="Entry Price" value={formatPrice(selectedSetup.entry_price)} />
                    <DetailRow label="Exit Time" value={formatTime(selectedSetup.exit_time)} />
                    <DetailRow label="Exit Price" value={formatPrice(selectedSetup.exit_price)} />
                    <DetailRow
                      label="Return"
                      value={formatSignedPercent(selectedSetup.return_pct)}
                      tone={Number(selectedSetup.return_pct) >= 0 ? "text-[var(--color-bull)]" : "text-[var(--color-bear)]"}
                    />
                    <DetailRow label="Bars Held" value={selectedSetup.bars_held} />
                    <DetailRow label="Exit Reason" value={selectedSetup.exit_reason.replaceAll("_", " ")} />
                  </div>
                ) : (
                  <div className="space-y-3 text-sm text-[var(--color-text-secondary)]">
                    <p>Select a setup in the Setups tab to move the chart viewport to that trade window.</p>
                    <p>
                      Current strategy: <span className="text-[var(--color-text)]">{activeStrategy.label}</span>
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="glass-panel flex min-h-[540px] flex-col overflow-hidden">
            <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
              {[
                ["builder", "Builder"],
                ["setups", "Setups"],
                ["pine", "Pine Script"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`tab-button ${activeTab === value ? "tab-button-active" : ""}`}
                  onClick={() => setActiveTab(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            {activeTab === "builder" && (
              <div className="flex flex-1 flex-col gap-4 p-4">
                <div>
                  <div className="text-sm font-semibold text-[var(--color-text)]">Dynamic strategy parameters</div>
                  <div className="mt-1 text-sm text-[var(--color-text-secondary)]">
                    Parameters are sent to the backend and evaluated there. The frontend only renders the returned
                    candles, overlays, and signals.
                  </div>
                </div>

                <ParameterFields strategyType={strategyType} parameters={currentParameters} onChange={updateParameter} />

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-[var(--color-border)] bg-[rgba(10,10,10,0.45)] p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
                      Dataset
                    </div>
                    <div className="mt-2 text-sm text-[var(--color-text)]">{csvFile?.name || "No CSV loaded"}</div>
                  </div>

                  <div className="rounded-xl border border-[var(--color-border)] bg-[rgba(10,10,10,0.45)] p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
                      Last Evaluation
                    </div>
                    <div className="mt-2 text-sm text-[var(--color-text)]">
                      {runData.candles.length ? `${runData.setups.length} setups, ${runData.signals.length} signals` : "No run yet"}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "setups" && (
              <div className="flex flex-1 min-h-0 flex-col p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-[var(--color-text)]">Detected setups</div>
                    <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                      Clicking a setup only changes the chart viewport.
                    </div>
                  </div>
                  <div className="text-xs text-[var(--color-text-secondary)]">
                    {deferredSetups.length} setups
                  </div>
                </div>

                {deferredSetups.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-[var(--color-border)] bg-[rgba(10,10,10,0.35)] px-6 text-center text-sm text-[var(--color-text-secondary)]">
                    Run a strategy to populate the setup explorer.
                  </div>
                ) : (
                  <div className="min-h-0 flex-1 rounded-xl border border-[var(--color-border)] bg-[rgba(10,10,10,0.35)] py-2">
                    <SetupsVirtualList
                      setups={deferredSetups}
                      selectedSetupId={selectedSetupId}
                      onSelect={selectSetup}
                    />
                  </div>
                )}
              </div>
            )}

            {activeTab === "pine" && (
              <div className="flex flex-1 flex-col gap-4 p-4">
                <div>
                  <div className="text-sm font-semibold text-[var(--color-text)]">Pine Script editor</div>
                  <div className="mt-1 text-sm text-[var(--color-text-secondary)]">
                    Supported functions: ta.ema, ta.sma, ta.rsi, ta.crossover, ta.crossunder.
                  </div>
                </div>

                <textarea
                  className="terminal-input h-[320px] resize-none font-mono text-sm"
                  value={pineScript}
                  onChange={(event) => setPineScript(event.target.value)}
                  spellCheck={false}
                />

                <div className="rounded-xl border border-[var(--color-border)] bg-[rgba(10,10,10,0.45)] p-4 text-sm text-[var(--color-text-secondary)]">
                  Define boolean `buy` and `sell` series. The backend parses the script, evaluates the signals, and
                  returns marker events and any compatible overlay lines.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default StrategyBuilder;
