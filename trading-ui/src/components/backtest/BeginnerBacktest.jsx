import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { runBacktest } from "../../services/api";
import BenchmarkComparison from "./BenchmarkComparison";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  getBacktestVerdict,
  getMetricTone,
  safeMetric,
  toneColor,
} from "./backtestDisplayUtils";

const MARKET_OPTIONS = [
  {
    id: "indian",
    assetType: "stock",
    icon: "IN",
    title: "Indian Stocks",
    subtitle: "NSE symbols like RELIANCE.NS and TCS.NS",
  },
  {
    id: "us",
    assetType: "stock",
    icon: "US",
    title: "US Stocks",
    subtitle: "US symbols like AAPL, NVDA, MSFT",
  },
  {
    id: "forex_commodity",
    assetType: "forex",
    icon: "FX",
    title: "Forex / Commodities",
    subtitle: "Currency pairs and commodity futures",
  },
  {
    id: "index",
    assetType: "index",
    icon: "IDX",
    title: "Indices",
    subtitle: "Nifty, Sensex, S&P 500, Nasdaq",
  },
];

const QUICK_PICKS = {
  indian: [
    ["RELIANCE.NS", "Reliance Industries"],
    ["TCS.NS", "Tata Consultancy Services"],
    ["INFY.NS", "Infosys"],
    ["HDFCBANK.NS", "HDFC Bank"],
    ["SBIN.NS", "State Bank of India"],
    ["TATAMOTORS.NS", "Tata Motors"],
  ],
  us: [
    ["AAPL", "Apple"],
    ["NVDA", "Nvidia"],
    ["MSFT", "Microsoft"],
    ["AMZN", "Amazon"],
    ["GOOGL", "Alphabet"],
    ["META", "Meta"],
  ],
  forex_commodity: [
    ["USDINR=X", "USD / INR"],
    ["EURUSD=X", "EUR / USD"],
    ["GC=F", "Gold Futures"],
    ["CL=F", "Crude Oil Futures"],
    ["GBPINR=X", "GBP / INR"],
    ["EURINR=X", "EUR / INR"],
  ],
  index: [
    ["^NSEI", "Nifty 50"],
    ["^BSESN", "Sensex"],
    ["^GSPC", "S&P 500"],
    ["^IXIC", "Nasdaq Composite"],
  ],
};

const STRATEGIES = [
  {
    id: "sma_cross",
    title: "SMA Crossover",
    description: "Compares a short moving average with a long moving average to test trend-following behavior.",
    bestFor: "Trending markets",
    difficulty: "Beginner",
    how: "The strategy enters when the faster average rises above the slower average and exits when it falls back below.",
  },
  {
    id: "rsi",
    title: "RSI Reversal",
    description: "Tests whether oversold and overbought zones have historically marked reversals.",
    bestFor: "Range-bound markets",
    difficulty: "Beginner",
    how: "RSI measures recent momentum. The backtest checks whether stretched readings led to profitable reversals.",
  },
  {
    id: "macd",
    title: "MACD Momentum",
    description: "Tests momentum shifts using the MACD line and signal line.",
    bestFor: "Momentum markets",
    difficulty: "Intermediate",
    how: "MACD compares fast and slow trend behavior. Crossovers are tested as possible momentum changes.",
  },
  {
    id: "bollinger",
    title: "Bollinger Bounce",
    description: "Tests price behavior around volatility bands.",
    bestFor: "Mean-reversion markets",
    difficulty: "Intermediate",
    how: "The strategy studies whether moves around the bands historically reverted or continued.",
  },
  {
    id: "sentiment_sma",
    title: "Sentiment + SMA",
    description: "Tests a trend strategy with a simple sentiment filter.",
    bestFor: "News-sensitive stocks",
    difficulty: "Advanced",
    how: "The moving-average signal is filtered by a fixed sentiment threshold for this beginner preview.",
  },
];

const PERIODS = ["1mo", "3mo", "6mo", "1y", "2y", "5y"];
const CAPITAL_PRESETS = [50000, 100000, 500000, 1000000];

const panelStyle = {
  background: "#0c0c14",
  border: "1px solid rgba(200,241,53,0.08)",
  borderRadius: 4,
};

function StepHeader({ step }) {
  const labels = ["Market", "Symbol", "Strategy", "Run"];
  return (
    <div className="grid gap-2 sm:grid-cols-4">
      {labels.map((label, index) => {
        const active = step === index + 1;
        const complete = step > index + 1;
        return (
          <div
            key={label}
            style={{
              ...panelStyle,
              padding: "10px 12px",
              borderColor: active || complete ? "rgba(200,241,53,0.35)" : "rgba(200,241,53,0.08)",
              color: active || complete ? "#C8F135" : "#888899",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.72rem",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            {index + 1}. {label}
          </div>
        );
      })}
    </div>
  );
}

function CardButton({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...panelStyle,
        textAlign: "left",
        padding: 16,
        borderColor: active ? "rgba(200,241,53,0.5)" : "rgba(200,241,53,0.08)",
        background: active ? "rgba(200,241,53,0.08)" : "#0c0c14",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function NavButtons({ step, canContinue, onBack, onNext }) {
  return (
    <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-between">
      <button
        type="button"
        onClick={onBack}
        disabled={step === 1}
        style={{
          borderRadius: 4,
          border: "1px solid rgba(200,241,53,0.12)",
          background: "#060608",
          color: step === 1 ? "#333344" : "#888899",
          padding: "10px 14px",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "0.76rem",
          letterSpacing: "0.1em",
          cursor: step === 1 ? "not-allowed" : "pointer",
        }}
      >
        BACK
      </button>
      {step < 4 && (
        <button
          type="button"
          onClick={onNext}
          disabled={!canContinue}
          style={{
            borderRadius: 4,
            border: "1px solid rgba(200,241,53,0.35)",
            background: canContinue ? "#C8F135" : "#111120",
            color: canContinue ? "#060608" : "#444456",
            padding: "10px 18px",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.76rem",
            fontWeight: 700,
            letterSpacing: "0.1em",
            cursor: canContinue ? "pointer" : "not-allowed",
          }}
        >
          CONTINUE
        </button>
      )}
    </div>
  );
}

function MetricExplainerCard({ label, value, explanation, tone = "neutral" }) {
  return (
    <div style={{ ...panelStyle, padding: 14 }}>
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "0.66rem",
          color: "#888899",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "'Bebas Neue', sans-serif",
          color: toneColor(tone),
          fontSize: "1.8rem",
          lineHeight: 1,
          marginBottom: 8,
        }}
      >
        {value}
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", color: "#888899", fontSize: "0.74rem", lineHeight: 1.55 }}>
        {explanation}
      </div>
    </div>
  );
}

function formatDate(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString();
}

function BeginnerResults({ result, initialCapital, onSwitchExpert, symbol, strategy, period }) {
  const [openHelp, setOpenHelp] = useState(false);
  const verdict = getBacktestVerdict(result);
  const returnPct = safeMetric(result, "return_pct");
  const winRate = safeMetric(result, "win_rate");
  const maxDrawdown = safeMetric(result, "max_drawdown");
  const profitFactor = safeMetric(result, "profit_factor");
  const equity = Array.isArray(result?.equity_curve) ? result.equity_curve : [];

  return (
    <div className="flex flex-col gap-4">
      <div
        style={{
          ...panelStyle,
          padding: 20,
          borderColor: `${toneColor(verdict.tone)}55`,
          background: "#0c0c14",
        }}
      >
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            color: toneColor(verdict.tone),
            fontSize: "0.72rem",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            marginBottom: 10,
          }}
        >
          Verdict
        </div>
        <div
          style={{
            fontFamily: "'Bebas Neue', sans-serif",
            color: "#fff",
            fontSize: "clamp(2.3rem, 6vw, 4.5rem)",
            lineHeight: 0.95,
            letterSpacing: "0.03em",
          }}
        >
          {verdict.label}
        </div>
        <p style={{ color: "#888899", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.82rem", lineHeight: 1.6, marginTop: 12, maxWidth: 760 }}>
          {verdict.summary} {verdict.detail}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricExplainerCard
          label="Total Return"
          value={formatPercent(returnPct)}
          tone={getMetricTone("return_pct", returnPct)}
          explanation="Historical percentage return from this strategy over the selected period."
        />
        <MetricExplainerCard
          label="Win Rate"
          value={formatPercent(winRate, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
          tone={getMetricTone("win_rate", winRate)}
          explanation="Share of completed trades that closed with a positive result."
        />
        <MetricExplainerCard
          label="Max Drawdown"
          value={formatPercent(maxDrawdown)}
          tone={getMetricTone("max_drawdown", Math.abs(Number(maxDrawdown ?? 0)))}
          explanation="Largest historical equity drop during the selected backtest."
        />
        <MetricExplainerCard
          label="Profit Factor"
          value={formatNumber(profitFactor, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          tone={getMetricTone("profit_factor", profitFactor)}
          explanation="Gross wins divided by gross losses. Above 1 means wins exceeded losses."
        />
      </div>

      <BenchmarkComparison result={result} />

      <div style={{ ...panelStyle, padding: 16 }}>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", color: "#C8F135", fontSize: "0.68rem", letterSpacing: "0.16em", textTransform: "uppercase" }}>
              Equity Curve
            </div>
            <div style={{ color: "#888899", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.74rem", marginTop: 4 }}>
              Historical account value through the test.
            </div>
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", color: "#888899", fontSize: "0.74rem" }}>
            Start: {formatCurrency(initialCapital)}
          </div>
        </div>
        <div style={{ height: 330 }}>
          {equity.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={equity} margin={{ top: 8, right: 20, left: 14, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis
                  dataKey="time"
                  tickFormatter={formatDate}
                  stroke="rgba(255,255,255,0.22)"
                  tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={32}
                />
                <YAxis
                  domain={["auto", "auto"]}
                  tickFormatter={(value) => formatCurrency(value)}
                  stroke="rgba(255,255,255,0.22)"
                  tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  labelFormatter={formatDate}
                  formatter={(value) => [formatCurrency(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), "Equity"]}
                  contentStyle={{ backgroundColor: "rgba(10,10,10,0.95)", borderColor: "rgba(200,241,53,0.16)", borderRadius: 4, fontSize: 12 }}
                />
                <ReferenceLine y={Number(initialCapital)} stroke="rgba(200,241,53,0.35)" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="equity" stroke="#C8F135" dot={false} strokeWidth={2} activeDot={{ r: 4, fill: "#C8F135" }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-center" style={{ color: "#888899", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.8rem" }}>
              No equity curve returned for this backtest.
            </div>
          )}
        </div>
      </div>

      <div style={{ ...panelStyle, padding: 16 }}>
        <button
          type="button"
          onClick={() => setOpenHelp((value) => !value)}
          style={{
            width: "100%",
            background: "transparent",
            border: 0,
            color: "#C8F135",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.76rem",
            letterSpacing: "0.12em",
            textAlign: "left",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          {openHelp ? "Hide" : "Show"} How To Read This
        </button>
        {openHelp && (
          <div className="mt-4 grid gap-3 md:grid-cols-2" style={{ color: "#888899", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.76rem", lineHeight: 1.6 }}>
            <p>Win rate shows how often trades closed positive. It does not show how large wins or losses were.</p>
            <p>Drawdown shows the largest historical account drop during the backtest.</p>
            <p>Profit factor compares gross wins to gross losses. Above 1 means wins exceeded losses.</p>
            <p>Alpha compares strategy return against buy-and-hold on the same symbol.</p>
            <p>The equity curve shows historical account value through time.</p>
            <p>Backtests are simulations using past data. They do not predict future performance.</p>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => {
          if (typeof onSwitchExpert === "function") {
            onSwitchExpert({
              symbol,
              strategy,
              period,
              initial_capital: Number(initialCapital),
            });
          }
        }}
        style={{
          borderRadius: 4,
          border: "1px solid rgba(200,241,53,0.35)",
          background: "#C8F135",
          color: "#060608",
          padding: "13px 18px",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "0.78rem",
          fontWeight: 800,
          letterSpacing: "0.12em",
          cursor: "pointer",
        }}
      >
        Open in Expert Mode
      </button>
    </div>
  );
}

export default function BeginnerBacktest({ onSwitchExpert }) {
  const [step, setStep] = useState(1);
  const [market, setMarket] = useState("indian");
  const [symbol, setSymbol] = useState("RELIANCE.NS");
  const [symbolName, setSymbolName] = useState("Reliance Industries");
  const [manualSymbol, setManualSymbol] = useState("");
  const [strategy, setStrategy] = useState("sma_cross");
  const [expandedStrategy, setExpandedStrategy] = useState("");
  const [period, setPeriod] = useState("1y");
  const [initialCapital, setInitialCapital] = useState(100000);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selectedMarket = MARKET_OPTIONS.find((item) => item.id === market) || MARKET_OPTIONS[0];
  const selectedStrategy = STRATEGIES.find((item) => item.id === strategy) || STRATEGIES[0];
  const canContinue = step === 1 ? Boolean(market) : step === 2 ? Boolean(symbol) : step === 3 ? Boolean(strategy) : true;

  const quickPicks = useMemo(() => QUICK_PICKS[market] || [], [market]);

  const selectMarket = (item) => {
    const firstPick = QUICK_PICKS[item.id]?.[0];
    setMarket(item.id);
    if (firstPick) {
      setSymbol(firstPick[0]);
      setSymbolName(firstPick[1]);
      setManualSymbol("");
    }
  };

  const selectSymbol = (nextSymbol, nextName = "") => {
    setSymbol(nextSymbol);
    setSymbolName(nextName || nextSymbol);
    setManualSymbol(nextSymbol);
  };

  const run = async () => {
    if (!symbol) return;

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const payload = {
        symbol: symbol.trim().toUpperCase(),
        strategy,
        period,
        interval: "1d",
        initial_capital: Number(initialCapital),
        commission: 0.001,
        slippage: 0.0005,
      };
      if (strategy === "sentiment_sma") {
        payload.sentiment_score = 50;
      }
      const data = await runBacktest(payload);
      setResult(data);
    } catch (err) {
      setError(String(err?.message || err || "Backtest failed."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div style={{ ...panelStyle, padding: 18 }}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", color: "#C8F135", fontSize: "0.68rem", letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 8 }}>
              Beginner Backtest
            </div>
            <h1 style={{ fontFamily: "'Bebas Neue', sans-serif", color: "#fff", fontSize: "clamp(2.4rem, 6vw, 4.8rem)", lineHeight: 0.92, letterSpacing: "0.03em", margin: 0 }}>
              Guided Strategy Test
            </h1>
            <p style={{ color: "#888899", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.82rem", lineHeight: 1.55, marginTop: 10, maxWidth: 760 }}>
              Pick a market, symbol, strategy, and period. Bullcast runs the same backend backtest engine and explains the result in plain language.
            </p>
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", color: "#888899", fontSize: "0.76rem" }}>
            {selectedMarket.title} | {symbol || "No symbol"} | {selectedStrategy.title}
          </div>
        </div>
      </div>

      <StepHeader step={step} />

      <div style={{ ...panelStyle, padding: 18 }}>
        {step === 1 && (
          <div>
            <h2 style={{ fontFamily: "'Bebas Neue', sans-serif", color: "#fff", fontSize: "2.2rem", margin: 0, letterSpacing: "0.03em" }}>Pick Your Market</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {MARKET_OPTIONS.map((item) => (
                <CardButton key={item.id} active={market === item.id} onClick={() => selectMarket(item)}>
                  <div style={{ color: "#C8F135", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.72rem", letterSpacing: "0.12em", marginBottom: 12 }}>{item.icon}</div>
                  <div style={{ color: "#fff", fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.8rem", lineHeight: 1 }}>{item.title}</div>
                  <div style={{ color: "#888899", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.74rem", lineHeight: 1.5, marginTop: 8 }}>{item.subtitle}</div>
                </CardButton>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 style={{ fontFamily: "'Bebas Neue', sans-serif", color: "#fff", fontSize: "2.2rem", margin: 0, letterSpacing: "0.03em" }}>Pick Symbol</h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {quickPicks.map(([quickSymbol, quickName]) => (
                <button
                  key={quickSymbol}
                  type="button"
                  onClick={() => selectSymbol(quickSymbol, quickName)}
                  style={{
                    ...panelStyle,
                    padding: "12px 14px",
                    textAlign: "left",
                    borderColor: symbol === quickSymbol ? "rgba(200,241,53,0.5)" : "rgba(200,241,53,0.08)",
                    background: symbol === quickSymbol ? "rgba(200,241,53,0.08)" : "#0c0c14",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ color: "#fff", fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, fontSize: "0.86rem" }}>{quickSymbol}</div>
                  <div style={{ color: "#888899", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.7rem", marginTop: 4 }}>{quickName}</div>
                </button>
              ))}
            </div>
            <div className="mt-5">
              <label style={{ fontFamily: "'JetBrains Mono', monospace", color: "#888899", fontSize: "0.72rem", letterSpacing: "0.12em", textTransform: "uppercase" }}>
                Manual Symbol
              </label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  className="terminal-input"
                  value={manualSymbol}
                  onChange={(event) => setManualSymbol(event.target.value.toUpperCase())}
                  placeholder="AAPL, RELIANCE.NS, ^NSEI"
                  style={{ borderRadius: 4 }}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (manualSymbol.trim()) selectSymbol(manualSymbol.trim().toUpperCase(), manualSymbol.trim().toUpperCase());
                  }}
                  style={{
                    borderRadius: 4,
                    border: "1px solid rgba(200,241,53,0.35)",
                    background: "#060608",
                    color: "#C8F135",
                    padding: "10px 14px",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "0.76rem",
                    letterSpacing: "0.1em",
                  }}
                >
                  USE SYMBOL
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 style={{ fontFamily: "'Bebas Neue', sans-serif", color: "#fff", fontSize: "2.2rem", margin: 0, letterSpacing: "0.03em" }}>Choose Strategy</h2>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {STRATEGIES.map((item) => (
                <CardButton key={item.id} active={strategy === item.id} onClick={() => setStrategy(item.id)}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div style={{ color: "#fff", fontFamily: "'Bebas Neue', sans-serif", fontSize: "1.8rem", lineHeight: 1 }}>{item.title}</div>
                      <div style={{ color: "#888899", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.74rem", lineHeight: 1.5, marginTop: 8 }}>{item.description}</div>
                    </div>
                    <span style={{ border: "1px solid rgba(200,241,53,0.22)", color: "#C8F135", borderRadius: 4, padding: "3px 7px", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.62rem", whiteSpace: "nowrap" }}>
                      {item.difficulty}
                    </span>
                  </div>
                  <div style={{ color: "#C8F135", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.72rem", marginTop: 12 }}>Best for: {item.bestFor}</div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setExpandedStrategy((value) => (value === item.id ? "" : item.id));
                    }}
                    style={{ marginTop: 12, background: "transparent", border: 0, color: "#888899", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.7rem", padding: 0, cursor: "pointer" }}
                  >
                    {expandedStrategy === item.id ? "Hide" : "Show"} how this works
                  </button>
                  {expandedStrategy === item.id && (
                    <div style={{ color: "#888899", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.72rem", lineHeight: 1.55, marginTop: 8 }}>
                      {item.how}
                    </div>
                  )}
                </CardButton>
              ))}
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <h2 style={{ fontFamily: "'Bebas Neue', sans-serif", color: "#fff", fontSize: "2.2rem", margin: 0, letterSpacing: "0.03em" }}>Set Period And Capital</h2>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", color: "#888899", fontSize: "0.72rem", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10 }}>Period</div>
                <div className="grid grid-cols-3 gap-2">
                  {PERIODS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setPeriod(item)}
                      style={{
                        borderRadius: 4,
                        border: period === item ? "1px solid rgba(200,241,53,0.55)" : "1px solid rgba(200,241,53,0.08)",
                        background: period === item ? "rgba(200,241,53,0.1)" : "#060608",
                        color: period === item ? "#C8F135" : "#888899",
                        padding: "10px 12px",
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", color: "#888899", fontSize: "0.72rem", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10 }}>Initial Capital</div>
                <input
                  className="terminal-input"
                  type="number"
                  min="1"
                  value={initialCapital}
                  onChange={(event) => setInitialCapital(event.target.value)}
                  style={{ borderRadius: 4 }}
                />
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {CAPITAL_PRESETS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setInitialCapital(item)}
                      style={{
                        borderRadius: 4,
                        border: "1px solid rgba(200,241,53,0.08)",
                        background: "#060608",
                        color: "#888899",
                        padding: "8px 10px",
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: "0.72rem",
                      }}
                    >
                      {formatCurrency(item)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <div style={{ ...panelStyle, padding: 14 }}>
                <div style={{ color: "#888899", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.66rem", letterSpacing: "0.12em", textTransform: "uppercase" }}>Symbol</div>
                <div style={{ color: "#fff", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.95rem", marginTop: 7 }}>{symbol}</div>
              </div>
              <div style={{ ...panelStyle, padding: 14 }}>
                <div style={{ color: "#888899", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.66rem", letterSpacing: "0.12em", textTransform: "uppercase" }}>Strategy</div>
                <div style={{ color: "#fff", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.95rem", marginTop: 7 }}>{selectedStrategy.title}</div>
              </div>
              <div style={{ ...panelStyle, padding: 14 }}>
                <div style={{ color: "#888899", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.66rem", letterSpacing: "0.12em", textTransform: "uppercase" }}>Period</div>
                <div style={{ color: "#fff", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.95rem", marginTop: 7 }}>{period}</div>
              </div>
            </div>

            {error && (
              <div className="mt-4" style={{ border: "1px solid rgba(255,59,59,0.28)", color: "#FF3B3B", background: "rgba(255,59,59,0.06)", borderRadius: 4, padding: 12, fontFamily: "'JetBrains Mono', monospace", fontSize: "0.76rem" }}>
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={run}
              disabled={loading || !symbol}
              style={{
                marginTop: 18,
                width: "100%",
                borderRadius: 4,
                border: "1px solid rgba(200,241,53,0.42)",
                background: loading || !symbol ? "#111120" : "#C8F135",
                color: loading || !symbol ? "#444456" : "#060608",
                padding: "14px 18px",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "0.82rem",
                fontWeight: 900,
                letterSpacing: "0.16em",
                cursor: loading || !symbol ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "RUNNING..." : "RUN BACKTEST"}
            </button>
          </div>
        )}

        <NavButtons
          step={step}
          canContinue={canContinue}
          onBack={() => setStep((value) => Math.max(1, value - 1))}
          onNext={() => setStep((value) => Math.min(4, value + 1))}
        />
      </div>

      {result && (
        <BeginnerResults
          result={result}
          initialCapital={Number(initialCapital)}
          onSwitchExpert={onSwitchExpert}
          symbol={symbol}
          strategy={strategy}
          period={period}
        />
      )}
    </div>
  );
}
