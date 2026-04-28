function formatSignedPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return "-";
  }

  const prefix = num > 0 ? "+" : "";
  return `${prefix}${num.toFixed(2)}%`;
}

function formatPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return "-";
  }
  return `${num.toFixed(1)}%`;
}

function formatMetric(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return "-";
  }
  return num.toFixed(digits);
}

export default function PerformanceMetrics({ metrics }) {
  const cards = [
    { label: "Total Trades", value: metrics?.totalTrades ?? 0 },
    { label: "Signals", value: metrics?.signalCount ?? 0 },
    { label: "Win Rate", value: formatPercent(metrics?.winRate) },
    {
      label: "Net PnL",
      value: formatSignedPercent(metrics?.netPnL),
      tone: Number(metrics?.netPnL) >= 0 ? "text-[var(--color-bull)]" : "text-[var(--color-bear)]",
    },
    {
      label: "Max Drawdown",
      value: formatSignedPercent(metrics?.maxDrawdown),
      tone: Number(metrics?.maxDrawdown) >= 0 ? "text-[var(--color-text)]" : "text-[var(--color-bear)]",
    },
    {
      label: "Profit Factor",
      value: metrics?.profitFactor == null ? "-" : formatMetric(metrics?.profitFactor),
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <div key={card.label} className="metric-card">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">{card.label}</div>
          <div className={`mt-2 text-lg font-semibold ${card.tone || "text-[var(--color-text)]"}`}>{card.value}</div>
        </div>
      ))}
    </div>
  );
}
