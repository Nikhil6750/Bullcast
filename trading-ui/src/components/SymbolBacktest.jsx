import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useSearch } from '../hooks/useSearch';
import { useBacktest } from '../hooks/useBacktest';
import BenchmarkComparison from './backtest/BenchmarkComparison';
import { formatCurrency, formatNumber, formatPercent, safeMetric } from './backtest/backtestDisplayUtils';

const ASSET_TYPES = ['stock', 'forex', 'commodity', 'index'];
const STRATEGIES = [
  { value: 'sma_cross', label: 'SMA Crossover' },
  { value: 'rsi', label: 'RSI' },
  { value: 'macd', label: 'MACD' },
  { value: 'bollinger', label: 'Bollinger Breakout' },
  { value: 'sentiment_sma', label: 'Sentiment SMA' },
];

const PERIODS = ['1mo', '3mo', '6mo', '1y', '2y', '5y', 'max'];
const INTERVALS = ['1d', '1wk', '1mo'];

function inferAssetType(symbol) {
  const value = String(symbol || '').toUpperCase();
  if (!value) return 'stock';
  if (value.startsWith('^')) return 'index';
  if (value.endsWith('=F')) return 'commodity';
  if (value.endsWith('=X') || /^[A-Z]{6}$/.test(value)) return 'forex';
  return 'stock';
}

function cleanInitialConfig(initialConfig) {
  if (!initialConfig || typeof initialConfig !== 'object') return null;

  const next = {};
  if (initialConfig.symbol) next.symbol = String(initialConfig.symbol).trim().toUpperCase();
  if (STRATEGIES.some((item) => item.value === initialConfig.strategy)) next.strategy = initialConfig.strategy;
  if (PERIODS.includes(initialConfig.period)) next.period = initialConfig.period;

  const capital = Number(initialConfig.initial_capital);
  if (Number.isFinite(capital) && capital > 0) {
    next.initial_capital = capital;
  }

  return Object.keys(next).length ? next : null;
}

export default function SymbolBacktest({ initialConfig = null }) {
  const [assetType, setAssetType] = useState('stock');
  const [searchQuery, setSearchQuery] = useState('');
  
  const [config, setConfig] = useState({
    symbol: '',
    strategy: 'sma_cross',
    period: '1y',
    interval: '1d',
    initial_capital: 100000,
    commission: 0.001,
    slippage: 0.0005,
    sentiment_score: 50,
  });

  const { results: searchResults } = useSearch(searchQuery);
  const { result: results, loading, error, execute } = useBacktest();
  const appliedInitialConfigKey = useRef('');
  const initialConfigKey = useMemo(() => {
    const cleaned = cleanInitialConfig(initialConfig);
    return cleaned ? JSON.stringify(cleaned) : '';
  }, [initialConfig]);

  useEffect(() => {
    if (!initialConfigKey || appliedInitialConfigKey.current === initialConfigKey) {
      return;
    }

    const cleaned = cleanInitialConfig(initialConfig);
    if (!cleaned) return;

    setConfig((previous) => ({
      ...previous,
      ...cleaned,
    }));
    if (cleaned.symbol) {
      setSearchQuery(cleaned.symbol);
      setAssetType(inferAssetType(cleaned.symbol));
    }
    appliedInitialConfigKey.current = initialConfigKey;
  }, [initialConfig, initialConfigKey]);

  const filteredSearchResults = (searchResults || []).filter(item => !assetType || item.type === assetType);

  const handleRun = async () => {
    if (!config.symbol) {
      return;
    }
    const payload = {
      symbol: config.symbol,
      strategy: config.strategy,
      period: config.period,
      interval: config.interval,
      initial_capital: Number(config.initial_capital),
      commission: Number(config.commission),
      slippage: Number(config.slippage),
    };
    if (config.strategy === 'sentiment_sma') {
      payload.sentiment_score = Number(config.sentiment_score);
    }
    
    await execute(payload);
  };

  const formatPrice = (v) => {
    const num = Number(v);
    if (!Number.isFinite(num)) return "-";
    return num.toFixed(2);
  };
  const formatSignedCurrency = (v) => {
    const num = Number(v);
    if (!Number.isFinite(num)) return '-';
    const sign = num > 0 ? '+' : '';
    return `${sign}${formatCurrency(num, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  const formatDate = (ts) => {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString();
  };
  const totalPnl = safeMetric(results, "total_pnl");
  const returnPct = safeMetric(results, "return_pct");
  const equityCurve = Array.isArray(results?.equity_curve) ? results.equity_curve : [];
  const trades = Array.isArray(results?.trades) ? results.trades : [];

  return (
    <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
      {/* Sidebar Config */}
      <div className="glass-panel p-4 flex flex-col gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-[var(--color-text-secondary)] mb-2">Asset Type</div>
          <div className="flex flex-wrap gap-2">
            {ASSET_TYPES.map(type => (
              <button
                key={type}
                className={`px-3 py-1 text-xs rounded-full border ${assetType === type ? 'border-[var(--color-bull)] text-[var(--color-bull)] bg-[var(--color-bull)]/10' : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-white/5'}`}
                onClick={() => setAssetType(type)}
              >
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-widest text-[var(--color-text-secondary)] mb-2">Symbol Search</div>
          <input
            className="terminal-input w-full"
            placeholder="Search symbol..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {filteredSearchResults.length > 0 && (
            <div className="mt-2 flex flex-col gap-1 border border-[var(--color-border)] rounded-lg bg-[rgba(0,0,0,0.5)] p-1 max-h-40 overflow-y-auto">
              {filteredSearchResults.map(item => (
                <div 
                  key={item.symbol} 
                  className="px-2 py-1 text-sm cursor-pointer hover:bg-white/10 rounded"
                  onClick={() => {
                    setConfig({ ...config, symbol: item.symbol });
                    setSearchQuery(item.symbol);
                  }}
                >
                  <div className="font-semibold text-[var(--color-text)]">{item.symbol}</div>
                  <div className="text-[10px] text-[var(--color-text-secondary)] leading-tight">{item.name}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-widest text-[var(--color-text-secondary)] mb-2">Strategy</div>
          <select className="terminal-input w-full" value={config.strategy} onChange={(e) => setConfig({ ...config, strategy: e.target.value })}>
            {STRATEGIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-[var(--color-text-secondary)] mb-1">Period</div>
            <select className="terminal-input w-full" value={config.period} onChange={(e) => setConfig({ ...config, period: e.target.value })}>
              {PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-widest text-[var(--color-text-secondary)] mb-1">Interval</div>
            <select className="terminal-input w-full" value={config.interval} onChange={(e) => setConfig({ ...config, interval: e.target.value })}>
              {INTERVALS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-[var(--color-text-secondary)] mb-1">Initial Cap</div>
            <input type="number" className="terminal-input w-full" value={config.initial_capital} onChange={(e) => setConfig({ ...config, initial_capital: e.target.value })} />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-widest text-[var(--color-text-secondary)] mb-1">Commission</div>
            <input type="number" step="0.001" className="terminal-input w-full" value={config.commission} onChange={(e) => setConfig({ ...config, commission: e.target.value })} />
          </div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-widest text-[var(--color-text-secondary)] mb-1">Slippage</div>
          <input type="number" step="0.001" className="terminal-input w-full" value={config.slippage} onChange={(e) => setConfig({ ...config, slippage: e.target.value })} />
        </div>

        {config.strategy === 'sentiment_sma' && (
          <div>
            <div className="text-[11px] uppercase tracking-widest text-[var(--color-text-secondary)] mb-1">Sentiment Score ({config.sentiment_score})</div>
            <input type="range" min="0" max="100" className="w-full accent-[var(--color-bull)]" value={config.sentiment_score} onChange={(e) => setConfig({ ...config, sentiment_score: e.target.value })} />
          </div>
        )}

        {error && <div className="text-red-400 text-sm mt-2">{error}</div>}

        <button className="terminal-button w-full mt-2" onClick={handleRun} disabled={loading || !config.symbol}>
          {loading ? 'Running...' : config.symbol ? 'Run Backtest' : 'Select Symbol'}
        </button>
      </div>

      {/* Main Area */}
      <div className="flex flex-col gap-4">
        {results ? (
          <>
            {/* Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {[
                { label: "Total Trades", value: formatNumber(safeMetric(results, "total_trades"), { maximumFractionDigits: 0 }) },
                { label: "Win Rate", value: formatPercent(safeMetric(results, "win_rate"), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
                { label: "Total P&L", value: formatCurrency(totalPnl, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), color: totalPnl === null ? "text-[var(--color-text)]" : totalPnl >= 0 ? "text-[var(--color-bull)]" : "text-[var(--color-bear)]" },
                { label: "Return", value: formatPercent(returnPct), color: returnPct === null ? "text-[var(--color-text)]" : returnPct >= 0 ? "text-[var(--color-bull)]" : "text-[var(--color-bear)]" },
                { label: "Max Drawdown", value: formatPercent(safeMetric(results, "max_drawdown")) },
                { label: "Profit Factor", value: formatNumber(safeMetric(results, "profit_factor"), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
                { label: "Sharpe Ratio", value: formatNumber(safeMetric(results, "sharpe_ratio"), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
                { label: "Sortino Ratio", value: formatNumber(safeMetric(results, "sortino_ratio"), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
                { label: "Calmar Ratio", value: formatNumber(safeMetric(results, "calmar_ratio"), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
              ].map((m, i) => (
                <div key={i} className="glass-panel p-3 flex flex-col justify-center bg-gradient-to-br from-white/[0.03] to-transparent">
                  <div className="text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)]">{m.label}</div>
                  <div className={`text-lg font-semibold mt-1 ${m.color || "text-[var(--color-text)]"}`}>{m.value}</div>
                </div>
              ))}
            </div>

            <BenchmarkComparison result={results} />

            {/* Equity Curve */}
            <div className="glass-panel p-4 h-[350px]">
              <div className="text-[11px] uppercase tracking-widest text-[var(--color-text-secondary)] mb-4">
                Equity Curve
              </div>

              {equityCurve.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={equityCurve} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis
                      dataKey="time"
                      tickFormatter={formatDate}
                      stroke="rgba(255,255,255,0.2)"
                      tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }}
                      axisLine={false}
                      tickLine={false}
                      minTickGap={30}
                    />
                    <YAxis
                      domain={['auto', 'auto']}
                      stroke="rgba(255,255,255,0.2)"
                      tick={{ fontSize: 10, fill: "rgba(255,255,255,0.5)" }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(val) => formatCurrency(val)}
                    />
                    <Tooltip
                      labelFormatter={formatDate}
                      formatter={(val) => [
                        formatCurrency(val, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                        'Equity',
                      ]}
                      contentStyle={{
                        backgroundColor: 'rgba(10,10,10,0.95)',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderRadius: 4,
                        fontSize: 12,
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="equity"
                      stroke="var(--color-bull)"
                      dot={false}
                      strokeWidth={2}
                      activeDot={{ r: 4, fill: "var(--color-bull)" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-center text-sm text-[var(--color-text-secondary)]">
                  No equity curve returned for this backtest.
                </div>
              )}
            </div>

            {/* Trades Table */}
            <div className="glass-panel p-4 overflow-hidden flex flex-col max-h-[400px]">
              <div className="text-[11px] uppercase tracking-widest text-[var(--color-text-secondary)] mb-4">Trade Execution Log</div>
              <div className="overflow-y-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)] border-b border-[var(--color-border)] sticky top-0 bg-[var(--color-panel)] z-10">
                    <tr>
                      <th className="pb-2 font-normal">Entry Date</th>
                      <th className="pb-2 font-normal">Exit Date</th>
                      <th className="pb-2 font-normal">Type</th>
                      <th className="pb-2 font-normal text-right">Entry Price</th>
                      <th className="pb-2 font-normal text-right">Exit Price</th>
                      <th className="pb-2 font-normal text-right">PnL</th>
                      <th className="pb-2 font-normal text-right">Return</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.length > 0 ? trades.map((t, i) => (
                      <tr key={i} className="border-b border-[var(--color-border)] last:border-0 hover:bg-white/[0.02]">
                        <td className="py-2">{formatDate(t.entry_time)}</td>
                        <td className="py-2">{formatDate(t.exit_time)}</td>
                        <td className="py-2">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${t.type === 'LONG' ? 'bg-[var(--color-bull)]/20 text-[var(--color-bull)]' : 'bg-[var(--color-bear)]/20 text-[var(--color-bear)]'}`}>{t.type}</span>
                        </td>
                        <td className="py-2 text-right">{formatCurrency(t.entry_price, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className="py-2 text-right">{formatCurrency(t.exit_price, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className={`py-2 text-right font-medium ${t.pnl >= 0 ? 'text-[var(--color-bull)]' : 'text-[var(--color-bear)]'}`}>{formatSignedCurrency(t.pnl)}</td>
                        <td className={`py-2 text-right font-medium ${t.return_pct >= 0 ? 'text-[var(--color-bull)]' : 'text-[var(--color-bear)]'}`}>{t.return_pct > 0 ? '+' : ''}{formatPrice(t.return_pct)}%</td>
                      </tr>
                    )) : (
                      <tr><td colSpan="7" className="py-6 text-center text-[var(--color-text-secondary)]">No trades executed</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <div className="glass-panel flex-1 flex flex-col items-center justify-center text-[var(--color-text-secondary)] p-12 text-center min-h-[400px]">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
            </div>
            <h3 className="text-lg font-medium text-[var(--color-text)] mb-2">Backtest Engine Ready</h3>
            <p className="text-sm max-w-sm">Configure your parameters in the sidebar and click Run to simulate strategy performance.</p>
          </div>
        )}
      </div>
    </div>
  );
}
