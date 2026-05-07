export function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function safeMetric(result, key) {
  return toFiniteNumber(result?.metrics?.[key]);
}

export function formatNumber(value, options = {}) {
  const num = toFiniteNumber(value);
  if (num === null) return "-";
  return num.toLocaleString("en-IN", options);
}

export function formatCurrency(value, options = {}) {
  const num = toFiniteNumber(value);
  if (num === null) return "-";
  return `\u20B9${num.toLocaleString("en-IN", { maximumFractionDigits: 0, ...options })}`;
}

export function formatPercent(value, options = {}) {
  const num = toFiniteNumber(value);
  if (num === null) return "-";
  return `${num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2, ...options })}%`;
}

export function getBenchmarkValues(result) {
  const available = Boolean(result?.benchmark_available);
  const strategyReturn = toFiniteNumber(result?.strategy_return_pct ?? result?.metrics?.return_pct);
  const benchmarkReturn = toFiniteNumber(result?.benchmark_return_pct);
  const alpha = toFiniteNumber(result?.alpha_pct);

  return {
    available,
    label: result?.benchmark_label || "Buy & Hold",
    strategyReturn,
    benchmarkReturn,
    alpha,
    warning: result?.benchmark_warning || (!available ? "Benchmark comparison is unavailable for this result." : ""),
  };
}

export function getMetricTone(metricName, value) {
  const num = toFiniteNumber(value);
  if (num === null) return "neutral";

  switch (metricName) {
    case "return_pct":
    case "total_pnl":
    case "alpha_pct":
      return num > 0 ? "positive" : num < 0 ? "negative" : "neutral";
    case "win_rate":
      if (num >= 60) return "positive";
      if (num < 45) return "negative";
      return "neutral";
    case "max_drawdown":
      if (num > 20) return "negative";
      if (num > 10) return "warning";
      return "positive";
    case "profit_factor":
      if (num >= 1.5) return "positive";
      if (num < 1) return "negative";
      return "neutral";
    default:
      return "neutral";
  }
}

export function toneColor(tone) {
  if (tone === "positive") return "#00FF87";
  if (tone === "negative") return "#FF3B3B";
  if (tone === "warning") return "#C8F135";
  return "#888899";
}

export function getBacktestVerdict(result) {
  if (!result) {
    return {
      key: "neutral",
      label: "BACKTEST READY",
      tone: "neutral",
      summary: "Run a backtest to see a historical strategy summary.",
      detail: "This is a historical backtest, not a prediction.",
    };
  }

  const totalTrades = safeMetric(result, "total_trades") ?? 0;
  const winRate = safeMetric(result, "win_rate") ?? 0;
  const profitFactor = safeMetric(result, "profit_factor") ?? 0;
  const returnPct = safeMetric(result, "return_pct") ?? 0;
  const maxDrawdown = Math.abs(safeMetric(result, "max_drawdown") ?? 0);
  const benchmark = getBenchmarkValues(result);

  if (totalTrades < 5) {
    return {
      key: "not_enough_trades",
      label: "NOT ENOUGH TRADES",
      tone: "warning",
      summary: "This result has too few trades to judge the strategy reliably.",
      detail: "This is a historical backtest, not a prediction.",
    };
  }

  if (maxDrawdown > 20) {
    return {
      key: "high_drawdown",
      label: "HIGH DRAWDOWN WARNING",
      tone: "negative",
      summary: "The strategy had a large historical drawdown in this test.",
      detail: "This is a historical backtest, not a prediction.",
    };
  }

  if (winRate >= 60 && profitFactor >= 1.5 && returnPct > 10) {
    return {
      key: "strong_performance",
      label: "STRONG PERFORMANCE",
      tone: "positive",
      summary: "The strategy produced strong historical metrics for the selected period.",
      detail: "This is a historical backtest, not a prediction.",
    };
  }

  if (benchmark.available && benchmark.alpha !== null && benchmark.alpha >= 5) {
    return {
      key: "beat_market",
      label: "STRATEGY BEAT BUY & HOLD",
      tone: "positive",
      summary: "The strategy outperformed the same-symbol buy-and-hold benchmark.",
      detail: "This is a historical backtest, not a prediction.",
    };
  }

  if (benchmark.available && benchmark.alpha !== null && Math.abs(benchmark.alpha) <= 5) {
    return {
      key: "close_to_market",
      label: "CLOSE TO BUY & HOLD",
      tone: "warning",
      summary: "The strategy finished close to the buy-and-hold benchmark.",
      detail: "This is a historical backtest, not a prediction.",
    };
  }

  if (benchmark.available && benchmark.alpha !== null && benchmark.alpha < 0) {
    return {
      key: "market_outperformed",
      label: "BUY & HOLD OUTPERFORMED",
      tone: "negative",
      summary: "The buy-and-hold benchmark outperformed this strategy.",
      detail: "This is a historical backtest, not a prediction.",
    };
  }

  if (returnPct > 0) {
    return {
      key: "mixed_positive",
      label: "MIXED RESULT",
      tone: "warning",
      summary: "The strategy was profitable, but the evidence is not strong enough for a clear verdict.",
      detail: "This is a historical backtest, not a prediction.",
    };
  }

  return {
    key: "weak",
    label: "WEAK RESULT",
    tone: "negative",
    summary: "The strategy was weak over the selected historical period.",
    detail: "This is a historical backtest, not a prediction.",
  };
}
