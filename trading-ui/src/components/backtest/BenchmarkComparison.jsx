import { formatPercent, getBenchmarkValues, toneColor } from "./backtestDisplayUtils";

function BenchmarkItem({ label, value, tone = "neutral" }) {
  return (
    <div
      style={{
        background: "#060608",
        border: "1px solid rgba(200,241,53,0.08)",
        borderRadius: 4,
        padding: "12px 14px",
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "0.66rem",
          color: "#888899",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: "1.6rem",
          lineHeight: 1,
          color: toneColor(tone),
          letterSpacing: "0.02em",
        }}
      >
        {value}
      </div>
    </div>
  );
}

export default function BenchmarkComparison({ result }) {
  const benchmark = getBenchmarkValues(result);
  const alphaTone = benchmark.alpha === null ? "neutral" : benchmark.alpha > 0 ? "positive" : benchmark.alpha < 0 ? "negative" : "warning";

  return (
    <div
      style={{
        background: "#0c0c14",
        border: "1px solid rgba(200,241,53,0.08)",
        borderRadius: 4,
        padding: 16,
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.68rem",
              color: "#C8F135",
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            Benchmark Comparison
          </div>
          <div
            style={{
              fontFamily: "'Bebas Neue', sans-serif",
              color: "#fff",
              fontSize: "2rem",
              lineHeight: 1,
              letterSpacing: "0.03em",
            }}
          >
            {benchmark.label}
          </div>
        </div>
        {!benchmark.available && (
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.72rem",
              color: "#C8F135",
              border: "1px solid rgba(200,241,53,0.18)",
              borderRadius: 4,
              padding: "8px 10px",
              maxWidth: 360,
            }}
          >
            {benchmark.warning}
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <BenchmarkItem label="Strategy Return" value={formatPercent(benchmark.strategyReturn)} tone={benchmark.strategyReturn > 0 ? "positive" : benchmark.strategyReturn < 0 ? "negative" : "neutral"} />
        <BenchmarkItem label="Buy & Hold Return" value={formatPercent(benchmark.benchmarkReturn)} tone={benchmark.benchmarkReturn > 0 ? "positive" : benchmark.benchmarkReturn < 0 ? "negative" : "neutral"} />
        <BenchmarkItem label="Alpha" value={formatPercent(benchmark.alpha)} tone={alphaTone} />
        <BenchmarkItem label="Benchmark Label" value={benchmark.label} />
      </div>
    </div>
  );
}

