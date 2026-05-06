import { useState, useEffect, useRef } from 'react'
import InsightCard from '../components/InsightCard'
import PatternHeatmap from '../components/PatternHeatmap'
import { analyzeJournal, askIntelligence, exportTradeDataset, getEdgarContext, getTrainingReport } from '../services/api'

const STORAGE_KEY = 'bullcast_journal_v1'

const EXAMPLE_QUESTIONS = [
  'Why do I keep losing trades?',
  'Which is my best performing stock?',
  'What day of the week am I most profitable?',
  'What is my biggest trading weakness?',
  'Should I trade LONG or SHORT more?',
  'What is my risk/reward ratio?',
]

const EQUITY_LIKE_TICKERS = new Set(['RELIANCE', 'TATASTEEL', 'INFY', 'TCS'])

function inferAssetType(symbol) {
  const s = String(symbol || '').trim().toUpperCase()
  if (!s) return 'unknown'
  if (s.includes('BTC') || s.includes('ETH') || s.includes('USDT') || s.endsWith('-USD')) return 'crypto'
  if (s.startsWith('^') || s.includes('NIFTY') || s.includes('SENSEX') || s.includes('SPX') || s.includes('NASDAQ')) return 'index'
  if (/^[A-Z]{6}$/.test(s) && !s.includes('.')) return 'forex'
  if (s.endsWith('.NS') || s.endsWith('.BO') || EQUITY_LIKE_TICKERS.has(s.replace(/\.(NS|BO)$/i, ''))) return 'stock'
  return 'unknown'
}

function optionalNumber(value) {
  if (value === '' || value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function optionalBoolean(value) {
  if (value === true || value === false) return value
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

function normalizeTrade(trade) {
  const entry = Number(trade.entry_price ?? trade.entryPrice ?? trade.entry ?? 0)
  const exit = Number(trade.exit_price ?? trade.exitPrice ?? trade.exit ?? 0)
  const quantity = Number(trade.quantity ?? trade.qty ?? 1)
  const pnl = Number(trade.pnl ?? trade.profitLoss ?? trade.profit_loss ?? ((exit - entry) * quantity))
  const type = String(trade.type ?? trade.side ?? 'LONG').toUpperCase()
  const result = String(trade.result ?? (pnl >= 0 ? 'WIN' : 'LOSS')).toUpperCase()
  const symbol = String(trade.symbol ?? trade.ticker ?? 'UNKNOWN').toUpperCase()

  return {
    id: String(trade.id ?? `${trade.symbol ?? 'TRADE'}-${trade.date ?? Date.now()}`),
    date: String(trade.date ?? trade.entryDate ?? new Date().toISOString().slice(0, 10)),
    symbol,
    asset_type: String(trade.asset_type ?? trade.assetType ?? inferAssetType(symbol)),
    type: type === 'SHORT' ? 'SHORT' : 'LONG',
    entry_price: entry,
    exit_price: exit,
    quantity,
    pnl,
    pnl_pct: Number(trade.pnl_pct ?? trade.pnlPct ?? trade.return_pct ?? 0),
    result: result === 'LOSS' ? 'LOSS' : 'WIN',
    notes: String(trade.notes ?? trade.note ?? ''),
    setup_tag: String(trade.setup_tag ?? trade.setupTag ?? ''),
    mistake_tag: String(trade.mistake_tag ?? trade.mistakeTag ?? 'none'),
    confidence_score: optionalNumber(trade.confidence_score ?? trade.confidenceScore),
    planned_risk: optionalNumber(trade.planned_risk ?? trade.plannedRisk),
    planned_reward: optionalNumber(trade.planned_reward ?? trade.plannedReward),
    rule_followed: optionalBoolean(trade.rule_followed ?? trade.ruleFollowed),
    entry_reason: String(trade.entry_reason ?? trade.entryReason ?? ''),
    exit_reason: String(trade.exit_reason ?? trade.exitReason ?? ''),
  }
}

function formatCoverage(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0%'
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`
}

function formatAssetMix(assetMix = {}) {
  const safeMix = assetMix && typeof assetMix === 'object' ? assetMix : {}
  const stock = Number(safeMix.stock ?? 0)
  const forex = Number(safeMix.forex ?? 0)
  const unknown = Number(safeMix.unknown ?? 0)
  return `${Number.isFinite(stock) ? stock : 0} stocks | ${Number.isFinite(forex) ? forex : 0} forex | ${Number.isFinite(unknown) ? unknown : 0} unknown`
}

function formatDatasetAssetMix(assetMix = {}) {
  const safeMix = assetMix && typeof assetMix === 'object' ? assetMix : {}
  const parts = [
    ['stock', 'stocks'],
    ['forex', 'forex'],
    ['crypto', 'crypto'],
    ['index', 'index'],
    ['unknown', 'unknown'],
  ]

  return parts
    .map(([key, label]) => `${Number(safeMix[key] ?? 0) || 0} ${label}`)
    .join(' | ')
}

function getCoverage(summary, key) {
  return summary?.label_coverage?.[key]?.coverage_pct ?? 0
}

function formatCell(value) {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'number') return Number.isInteger(value) ? value : value.toFixed(2)
  return String(value)
}

function datasetDateStamp() {
  return new Date().toISOString().slice(0, 10)
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function escapeCsvValue(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function rowsToCsv(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const lines = [
    headers.map(escapeCsvValue).join(','),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row?.[header])).join(',')),
  ]
  return lines.join('\n')
}

function DatasetReadinessPanel({ trades }) {
  const [dataset, setDataset] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [includeEdgar, setIncludeEdgar] = useState(false)
  const summary = dataset?.summary
  const qualityGate = dataset?.quality_gate
  const allRows = Array.isArray(dataset?.rows) ? dataset.rows : []
  const rows = allRows.slice(0, 5)
  const edgarSummary = summary?.edgar
  const baseWarnings = Array.isArray(summary?.warnings) ? summary.warnings : []
  const edgarWarnings = Array.isArray(edgarSummary?.warnings) ? edgarSummary.warnings : []
  const warnings = [
    ...baseWarnings,
    ...edgarWarnings.map((warning) => `EDGAR: ${warning}`),
  ]
  const hasTrades = trades.length > 0
  const canDownload = allRows.length > 0
  const previewColumns = edgarSummary?.enabled
    ? ['date', 'symbol', 'asset_type', 'direction', 'setup_tag', 'mistake_tag', 'planned_rr', 'actual_rr', 'result', 'edgar_point_in_time', 'edgar_as_of_date', 'edgar_available', 'edgar_cik', 'edgar_recent_10k_date']
    : ['date', 'symbol', 'asset_type', 'direction', 'setup_tag', 'mistake_tag', 'planned_rr', 'actual_rr', 'result']

  const generateDatasetPreview = async () => {
    if (!hasTrades) return
    setLoading(true)
    setError(null)
    try {
      const result = await exportTradeDataset(trades, { include_edgar: includeEdgar })
      setDataset(result)
    } catch (e) {
      setError(
        e.message?.includes('fetch')
          ? 'Could not connect to backend. Make sure the server is running.'
          : 'Dataset preview failed. Please try again.'
      )
    } finally {
      setLoading(false)
    }
  }

  const toggleEdgar = (event) => {
    setIncludeEdgar(event.target.checked)
    setDataset(null)
    setError(null)
  }

  const downloadCsv = () => {
    if (!canDownload) return
    downloadBlob(
      rowsToCsv(allRows),
      `bullcast_trade_dataset_${datasetDateStamp()}.csv`,
      'text/csv;charset=utf-8;'
    )
  }

  const downloadJson = () => {
    if (!canDownload) return
    const payload = {
      exported_at: new Date().toISOString(),
      summary: summary || {},
      rows: allRows,
    }
    downloadBlob(
      JSON.stringify(payload, null, 2),
      `bullcast_trade_dataset_${datasetDateStamp()}.json`,
      'application/json;charset=utf-8;'
    )
  }

  const metrics = [
    ['Total Rows', summary?.total_rows ?? 0],
    ['Usable Rows', summary?.usable_rows ?? 0],
    ['Missing Labels', summary?.missing_label_rows ?? 0],
    ['Asset Mix', formatDatasetAssetMix(summary?.asset_mix)],
    ['Setup Tag Coverage', formatCoverage(getCoverage(summary, 'setup_tag'))],
    ['Mistake Tag Coverage', formatCoverage(getCoverage(summary, 'mistake_tag'))],
    ['Planned R/R Coverage', formatCoverage(getCoverage(summary, 'planned_rr'))],
    ['Rule Followed Coverage', formatCoverage(getCoverage(summary, 'rule_followed'))],
    ...(edgarSummary?.enabled ? [
      ['Point-in-time', edgarSummary.point_in_time ? 'Enabled' : 'Disabled'],
      ['EDGAR Coverage', formatCoverage(edgarSummary.coverage ?? 0)],
      ['EDGAR Supported Rows', edgarSummary.supported_rows ?? 0],
      ['EDGAR Available Rows', edgarSummary.available_rows ?? 0],
    ] : []),
  ]

  return (
    <section
      style={{
        background: '#0c0c14',
        border: '1px solid rgba(200,241,53,0.08)',
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          padding: '16px 20px',
          borderBottom: '1px solid rgba(200,241,53,0.06)',
        }}
      >
        <div>
          <p
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.65rem',
              color: '#C8F135',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              margin: 0,
            }}
          >
            Model Dataset Readiness
          </p>
          <p
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.68rem',
              color: '#333344',
              margin: '6px 0 0',
              lineHeight: 1.5,
            }}
          >
            Preview the model-ready rows generated from your current Journal trades.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'flex-end' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: '#888899',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.66rem',
              lineHeight: 1.4,
              cursor: 'pointer',
              textAlign: 'right',
            }}
          >
            <input
              type="checkbox"
              checked={includeEdgar}
              onChange={toggleEdgar}
              style={{ accentColor: '#C8F135' }}
            />
            Include SEC EDGAR context for US stocks
          </label>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              onClick={generateDatasetPreview}
              disabled={!hasTrades || loading}
              style={{
                padding: '9px 16px',
                background: hasTrades && !loading ? '#C8F135' : '#111120',
                border: 'none',
                borderRadius: 4,
                color: hasTrades && !loading ? '#060608' : '#2a2a3e',
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '0.95rem',
                letterSpacing: '0.05em',
                cursor: hasTrades && !loading ? 'pointer' : 'not-allowed',
                transition: 'all 0.15s',
              }}
            >
              {loading ? 'Generating...' : 'Generate Dataset Preview'}
            </button>

            <button
              onClick={downloadCsv}
              disabled={!canDownload}
              style={{
                padding: '9px 14px',
                background: '#060608',
                border: '1px solid rgba(200,241,53,0.16)',
                borderRadius: 4,
                color: canDownload ? '#C8F135' : '#2a2a3e',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '0.68rem',
                letterSpacing: '0.06em',
                cursor: canDownload ? 'pointer' : 'not-allowed',
                textTransform: 'uppercase',
              }}
            >
              Download CSV
            </button>

            <button
              onClick={downloadJson}
              disabled={!canDownload}
              style={{
                padding: '9px 14px',
                background: '#060608',
                border: '1px solid rgba(200,241,53,0.16)',
                borderRadius: 4,
                color: canDownload ? '#C8F135' : '#2a2a3e',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '0.68rem',
                letterSpacing: '0.06em',
                cursor: canDownload ? 'pointer' : 'not-allowed',
                textTransform: 'uppercase',
              }}
            >
              Download JSON
            </button>
          </div>

          {!canDownload && (
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '0.62rem',
                color: '#333344',
                lineHeight: 1.4,
              }}
            >
              Generate a dataset preview first.
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: '18px 20px' }}>
        {!hasTrades && (
          <div
            style={{
              padding: '14px 16px',
              background: '#060608',
              border: '1px solid rgba(200,241,53,0.08)',
              borderRadius: 4,
              color: '#888899',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.78rem',
              lineHeight: 1.6,
            }}
          >
            Add Journal trades before generating a dataset preview.
          </div>
        )}

        {error && (
          <div
            style={{
              padding: '10px 12px',
              background: 'rgba(255,59,59,0.06)',
              border: '1px solid rgba(255,59,59,0.2)',
              borderRadius: 4,
              color: '#FF3B3B',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.74rem',
              marginBottom: 14,
            }}
          >
            {error}
          </div>
        )}

        {(includeEdgar || edgarSummary?.enabled) && (
          <div
            style={{
              padding: '10px 12px',
              background: 'rgba(200,241,53,0.04)',
              border: '1px solid rgba(200,241,53,0.08)',
              borderRadius: 4,
              color: '#888899',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.68rem',
              lineHeight: 1.5,
              marginBottom: 14,
            }}
          >
            EDGAR fields use point-in-time filtering based on trade date where available.
          </div>
        )}

        {summary && (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))',
                gap: 10,
                marginBottom: 16,
              }}
            >
              {metrics.map(([label, value]) => (
                <DatasetMetric key={label} label={label} value={value} />
              ))}
            </div>

            {qualityGate && (
              <TrainingReadinessPanel qualityGate={qualityGate} />
            )}

            {warnings.length > 0 && (
              <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
                {warnings.map((warning, index) => (
                  <div
                    key={`${warning}-${index}`}
                    style={{
                      padding: '8px 10px',
                      background: 'rgba(255,184,77,0.06)',
                      border: '1px solid rgba(255,184,77,0.2)',
                      borderRadius: 4,
                      color: '#FFB84D',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '0.68rem',
                      lineHeight: 1.5,
                    }}
                  >
                    {warning}
                  </div>
                ))}
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  minWidth: edgarSummary?.enabled ? 1280 : 820,
                  borderCollapse: 'collapse',
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                <thead>
                  <tr>
                    {previewColumns.map((header) => (
                      <th
                        key={header}
                        style={{
                          padding: '9px 10px',
                          textAlign: 'left',
                          fontSize: '0.58rem',
                          color: '#2a2a3e',
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          borderBottom: '1px solid rgba(200,241,53,0.06)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={row.trade_id ?? index}>
                      {previewColumns.map((key) => (
                        <td
                          key={key}
                          style={{
                            padding: '9px 10px',
                            color: key === 'result' && row[key] === 'LOSS' ? '#FF3B3B' : key === 'result' ? '#00FF87' : '#888899',
                            fontSize: '0.7rem',
                            borderBottom: '1px solid rgba(255,255,255,0.03)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formatCell(row[key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function TrainingReportPanel() {
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const loadReport = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await getTrainingReport()
      setPayload(result)
    } catch (e) {
      setError(
        e.message?.includes('fetch')
          ? 'Could not connect to backend. Make sure the server is running.'
          : 'Training report could not be loaded.'
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadReport()
  }, [])

  const report = payload?.report || {}
  const metrics = report?.metrics || {}
  const qualityGate = report?.quality_gate || {}
  const warnings = Array.isArray(report?.warnings) ? report.warnings : []
  const selectedColumns = Array.isArray(report?.selected_input_columns) ? report.selected_input_columns : []
  const confusionMatrix = Array.isArray(metrics?.confusion_matrix) ? metrics.confusion_matrix : []

  return (
    <section
      style={{
        background: '#0c0c14',
        border: '1px solid rgba(255,184,77,0.22)',
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 14,
          flexWrap: 'wrap',
          padding: '16px 20px',
          borderBottom: '1px solid rgba(255,184,77,0.12)',
        }}
      >
        <div style={{ maxWidth: 680 }}>
          <p
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.65rem',
              color: '#FFB84D',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              margin: 0,
            }}
          >
            DEV / SYNTHETIC TEST ONLY
          </p>
          <p
            style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '1.5rem',
              color: '#f5f5f7',
              letterSpacing: '0.04em',
              margin: '6px 0 0',
              lineHeight: 1,
            }}
          >
            Baseline Training Report
          </p>
          <p
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.68rem',
              color: '#888899',
              margin: '8px 0 0',
              lineHeight: 1.6,
            }}
          >
            Not real model performance. Do not use for trading decisions. Experimental, synthetic/dev only, and not financial advice.
          </p>
        </div>

        <button
          onClick={loadReport}
          disabled={loading}
          style={{
            padding: '9px 14px',
            background: loading ? '#111120' : '#060608',
            border: '1px solid rgba(255,184,77,0.3)',
            borderRadius: 4,
            color: loading ? '#2a2a3e' : '#FFB84D',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '0.68rem',
            letterSpacing: '0.06em',
            cursor: loading ? 'not-allowed' : 'pointer',
            textTransform: 'uppercase',
          }}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      <div style={{ padding: '18px 20px' }}>
        {error && (
          <div
            style={{
              padding: '10px 12px',
              background: 'rgba(255,59,59,0.06)',
              border: '1px solid rgba(255,59,59,0.2)',
              borderRadius: 4,
              color: '#FF3B3B',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.74rem',
              marginBottom: 14,
            }}
          >
            {error}
          </div>
        )}

        {!error && !loading && payload?.available === false && (
          <div
            style={{
              padding: '14px 16px',
              background: '#060608',
              border: '1px solid rgba(200,241,53,0.08)',
              borderRadius: 4,
              color: '#888899',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.78rem',
              lineHeight: 1.6,
            }}
          >
            {payload.message || 'No training report found. Run baseline training first.'}
          </div>
        )}

        {payload?.available === true && (
          <>
            <div
              style={{
                padding: '10px 12px',
                background: 'rgba(255,184,77,0.06)',
                border: '1px solid rgba(255,184,77,0.22)',
                borderRadius: 4,
                color: '#FFB84D',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '0.68rem',
                lineHeight: 1.5,
                marginBottom: 14,
              }}
            >
              {payload.synthetic_warning || 'DEV / SYNTHETIC TEST ONLY. Not real model performance.'}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))',
                gap: 10,
                marginBottom: 16,
              }}
            >
              <DatasetMetric label="Status" value={report.status || '-'} />
              <DatasetMetric label="Model Type" value={report.model_type || '-'} />
              <DatasetMetric label="Version" value={report.model_version || '-'} />
              <DatasetMetric label="Target" value={report.target_column || '-'} />
              <DatasetMetric label="Dataset Rows" value={report.dataset_rows ?? '-'} />
              <DatasetMetric label="Train Rows" value={report.train_rows ?? '-'} />
              <DatasetMetric label="Test Rows" value={report.test_rows ?? '-'} />
              <DatasetMetric label="Readiness" value={formatReadinessLevel(qualityGate.readiness_level)} />
            </div>

            {report.target_note && (
              <div
                style={{
                  padding: '10px 12px',
                  background: '#060608',
                  border: '1px solid rgba(200,241,53,0.08)',
                  borderRadius: 4,
                  color: '#888899',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '0.68rem',
                  lineHeight: 1.5,
                  marginBottom: 16,
                }}
              >
                Target note: {report.target_note}
              </div>
            )}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))',
                gap: 10,
                marginBottom: 16,
              }}
            >
              <DatasetMetric label="Accuracy" value={formatQualityValue(metrics.accuracy)} />
              <DatasetMetric label="Precision" value={formatQualityValue(metrics.precision)} />
              <DatasetMetric label="Recall" value={formatQualityValue(metrics.recall)} />
              <DatasetMetric label="ROC AUC" value={formatQualityValue(metrics.roc_auc)} />
              <DatasetMetric label="Brier Score" value={formatQualityValue(metrics.brier_score)} />
              <DatasetMetric label="Gate Score" value={`${Number(qualityGate.score ?? 0)}/100`} />
            </div>

            {confusionMatrix.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <p
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '0.62rem',
                    color: '#C8F135',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    margin: '0 0 10px',
                  }}
                >
                  Confusion Matrix
                </p>
                <div style={{ display: 'inline-grid', gap: 4 }}>
                  {confusionMatrix.map((row, rowIndex) => (
                    <div key={`matrix-${rowIndex}`} style={{ display: 'flex', gap: 4 }}>
                      {(Array.isArray(row) ? row : []).map((value, colIndex) => (
                        <div
                          key={`matrix-${rowIndex}-${colIndex}`}
                          style={{
                            minWidth: 46,
                            padding: '8px 10px',
                            background: '#060608',
                            border: '1px solid rgba(200,241,53,0.08)',
                            borderRadius: 4,
                            color: '#f5f5f7',
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: '0.78rem',
                            textAlign: 'center',
                          }}
                        >
                          {formatQualityValue(value)}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <TrainingReadinessPanel qualityGate={qualityGate} />

            {warnings.length > 0 && (
              <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
                {warnings.map((warning, index) => (
                  <div
                    key={`${warning}-${index}`}
                    style={{
                      padding: '8px 10px',
                      background: 'rgba(255,184,77,0.06)',
                      border: '1px solid rgba(255,184,77,0.2)',
                      borderRadius: 4,
                      color: '#FFB84D',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '0.68rem',
                      lineHeight: 1.5,
                    }}
                  >
                    {warning}
                  </div>
                ))}
              </div>
            )}

            {selectedColumns.length > 0 && (
              <details
                style={{
                  background: '#060608',
                  border: '1px solid rgba(200,241,53,0.08)',
                  borderRadius: 4,
                  padding: '12px 14px',
                }}
              >
                <summary
                  style={{
                    cursor: 'pointer',
                    color: '#C8F135',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '0.62rem',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                  }}
                >
                  Selected Input Columns ({selectedColumns.length})
                </summary>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                  {selectedColumns.map((column) => (
                    <span
                      key={column}
                      style={{
                        padding: '4px 7px',
                        borderRadius: 3,
                        border: '1px solid rgba(200,241,53,0.12)',
                        color: '#888899',
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '0.58rem',
                      }}
                    >
                      {column}
                    </span>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function DatasetMetric({ label, value }) {
  return (
    <div
      style={{
        background: '#060608',
        border: '1px solid rgba(200,241,53,0.08)',
        borderRadius: 4,
        padding: '11px 12px',
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.56rem',
          color: '#C8F135',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.78rem',
          color: '#888899',
          lineHeight: 1.4,
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </div>
    </div>
  )
}

function TrainingReadinessPanel({ qualityGate }) {
  const checks = Array.isArray(qualityGate?.checks) ? qualityGate.checks : []
  const recommendations = Array.isArray(qualityGate?.recommendations) ? qualityGate.recommendations.slice(0, 4) : []
  const ready = qualityGate?.ready_for_training === true
  const badgeColor = ready ? '#00FF87' : '#FF3B3B'

  return (
    <div
      style={{
        background: '#060608',
        border: '1px solid rgba(200,241,53,0.08)',
        borderRadius: 4,
        padding: 14,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 12,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.58rem',
              color: '#C8F135',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            Training Readiness
          </div>
          <div
            style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '1.3rem',
              color: '#f5f5f7',
              letterSpacing: '0.04em',
            }}
          >
            {formatReadinessLevel(qualityGate?.readiness_level)}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span
            style={{
              padding: '6px 9px',
              borderRadius: 4,
              border: `1px solid ${badgeColor}`,
              color: badgeColor,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.6rem',
              textTransform: 'uppercase',
            }}
          >
            {ready ? 'Ready for baseline' : 'Not ready'}
          </span>
          <span
            style={{
              color: '#888899',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.72rem',
            }}
          >
            Score {Number(qualityGate?.score ?? 0)}/100
          </span>
        </div>
      </div>

      {recommendations.length > 0 && (
        <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
          {recommendations.map((recommendation, index) => (
            <div
              key={`${recommendation}-${index}`}
              style={{
                color: '#888899',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '0.68rem',
                lineHeight: 1.5,
              }}
            >
              {recommendation}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gap: 7 }}>
        {checks.map((check, index) => {
          const color = qualityStatusColor(check.status)
          return (
            <div
              key={`${check.name}-${index}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '82px minmax(0,1fr)',
                gap: 10,
                alignItems: 'start',
                padding: '8px 9px',
                background: '#0c0c14',
                border: `1px solid ${qualityStatusBorder(check.status)}`,
                borderRadius: 4,
              }}
            >
              <div
                style={{
                  color,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '0.58rem',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                {String(check.status || 'warn')}
              </div>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    color: '#f5f5f7',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '0.68rem',
                    marginBottom: 3,
                  }}
                >
                  {check.name}
                </div>
                <div
                  style={{
                    color: '#888899',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '0.64rem',
                    lineHeight: 1.5,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {check.message}
                  <span style={{ color: '#333344' }}> - {formatQualityValue(check.value)}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function formatReadinessLevel(level) {
  return String(level || 'not_ready')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function qualityStatusColor(status) {
  if (status === 'pass') return '#00FF87'
  if (status === 'fail') return '#FF3B3B'
  return '#FFB84D'
}

function qualityStatusBorder(status) {
  if (status === 'pass') return 'rgba(0,255,135,0.22)'
  if (status === 'fail') return 'rgba(255,59,59,0.22)'
  return 'rgba(255,184,77,0.22)'
}

function formatQualityValue(value) {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(1)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, item]) => `${key}: ${item}`)
      .join(', ') || '-'
  }
  return String(value)
}

function EdgarDiagnosticsPanel() {
  const [ticker, setTicker] = useState('AAPL')
  const [context, setContext] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const warnings = Array.isArray(context?.warnings) ? context.warnings : []
  const recentFilings = Array.isArray(context?.recent_filings) ? context.recent_filings.slice(0, 5) : []
  const facts = context?.core_facts?.facts && typeof context.core_facts.facts === 'object'
    ? Object.entries(context.core_facts.facts)
    : []
  const available = context?.available === true

  const fetchContext = async () => {
    const cleanTicker = ticker.trim().toUpperCase()
    if (!cleanTicker) return
    setTicker(cleanTicker)
    setLoading(true)
    setError(null)

    try {
      const result = await getEdgarContext(cleanTicker)
      setContext(result)
    } catch (e) {
      setError(
        e.message?.includes('fetch')
          ? 'Could not connect to backend. Make sure the server is running.'
          : 'EDGAR context lookup failed. Please try again.'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <section
      style={{
        background: '#0c0c14',
        border: '1px solid rgba(200,241,53,0.08)',
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 14,
          flexWrap: 'wrap',
          padding: '16px 20px',
          borderBottom: '1px solid rgba(200,241,53,0.06)',
        }}
      >
        <div style={{ maxWidth: 520 }}>
          <p
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.65rem',
              color: '#C8F135',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              margin: 0,
            }}
          >
            SEC EDGAR Context
          </p>
          <p
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.68rem',
              color: '#333344',
              margin: '6px 0 0',
              lineHeight: 1.5,
            }}
          >
            EDGAR context is not used for predictions yet. This is a cached data inspection tool.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !loading) fetchContext()
            }}
            placeholder="AAPL"
            style={{
              width: 130,
              background: '#060608',
              border: '1px solid rgba(200,241,53,0.16)',
              borderRadius: 4,
              color: '#fff',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.78rem',
              padding: '9px 11px',
              outline: 'none',
            }}
          />
          <button
            onClick={fetchContext}
            disabled={loading || !ticker.trim()}
            style={{
              padding: '9px 16px',
              background: !loading && ticker.trim() ? '#C8F135' : '#111120',
              border: 'none',
              borderRadius: 4,
              color: !loading && ticker.trim() ? '#060608' : '#2a2a3e',
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '0.95rem',
              letterSpacing: '0.05em',
              cursor: !loading && ticker.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            {loading ? 'Fetching...' : 'Fetch EDGAR Context'}
          </button>
        </div>
      </div>

      <div style={{ padding: '18px 20px' }}>
        {error && (
          <EdgarNotice color="#FF3B3B" border="rgba(255,59,59,0.2)" background="rgba(255,59,59,0.06)">
            {error}
          </EdgarNotice>
        )}

        {!context && !error && (
          <EdgarNotice color="#888899" border="rgba(200,241,53,0.08)" background="#060608">
            Enter a US ticker such as AAPL or MSFT to inspect cached SEC filings and company facts.
          </EdgarNotice>
        )}

        {context && (
          <>
            {!available && (
              <EdgarNotice color="#FFB84D" border="rgba(255,184,77,0.2)" background="rgba(255,184,77,0.06)">
                EDGAR context unavailable for this ticker.
              </EdgarNotice>
            )}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))',
                gap: 10,
                margin: '14px 0 16px',
              }}
            >
              <DatasetMetric label="Ticker" value={context.ticker || ticker} />
              <DatasetMetric label="Company" value={context.company_name || '-' } />
              <DatasetMetric label="CIK" value={context.cik || '-'} />
              <DatasetMetric label="Recent Filings" value={Array.isArray(context.recent_filings) ? context.recent_filings.length : 0} />
              <DatasetMetric label="Core Facts" value={facts.length} />
            </div>

            {warnings.length > 0 && (
              <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
                {warnings.map((warning, index) => (
                  <EdgarNotice
                    key={`${warning}-${index}`}
                    color="#FFB84D"
                    border="rgba(255,184,77,0.2)"
                    background="rgba(255,184,77,0.06)"
                  >
                    {warning}
                  </EdgarNotice>
                ))}
              </div>
            )}

            {available && recentFilings.length > 0 && (
              <EdgarTable
                title="Recent Filings"
                columns={['form', 'filingDate', 'reportDate', 'primaryDocument']}
                rows={recentFilings}
              />
            )}

            {available && facts.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <p
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '0.62rem',
                    color: '#C8F135',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    margin: '0 0 10px',
                  }}
                >
                  Core Facts
                </p>
                <div style={{ overflowX: 'auto' }}>
                  <table
                    style={{
                      width: '100%',
                      minWidth: 760,
                      borderCollapse: 'collapse',
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    <thead>
                      <tr>
                        {['fact name', 'value', 'unit', 'fiscal_year', 'fiscal_period', 'form', 'filed'].map((header) => (
                          <th
                            key={header}
                            style={{
                              padding: '9px 10px',
                              textAlign: 'left',
                              fontSize: '0.58rem',
                              color: '#2a2a3e',
                              letterSpacing: '0.08em',
                              textTransform: 'uppercase',
                              borderBottom: '1px solid rgba(200,241,53,0.06)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {facts.map(([name, fact]) => (
                        <tr key={name}>
                          <EdgarTd>{name.replace(/_/g, ' ')}</EdgarTd>
                          <EdgarTd>{formatCell(fact?.value)}</EdgarTd>
                          <EdgarTd>{formatCell(fact?.unit)}</EdgarTd>
                          <EdgarTd>{formatCell(fact?.fiscal_year)}</EdgarTd>
                          <EdgarTd>{formatCell(fact?.fiscal_period)}</EdgarTd>
                          <EdgarTd>{formatCell(fact?.form)}</EdgarTd>
                          <EdgarTd>{formatCell(fact?.filed)}</EdgarTd>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function EdgarNotice({ children, color, border, background }) {
  return (
    <div
      style={{
        padding: '10px 12px',
        background,
        border: `1px solid ${border}`,
        borderRadius: 4,
        color,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '0.72rem',
        lineHeight: 1.6,
      }}
    >
      {children}
    </div>
  )
}

function EdgarTable({ title, columns, rows }) {
  return (
    <div>
      <p
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.62rem',
          color: '#C8F135',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          margin: '0 0 10px',
        }}
      >
        {title}
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            minWidth: 620,
            borderCollapse: 'collapse',
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          <thead>
            <tr>
              {columns.map((header) => (
                <th
                  key={header}
                  style={{
                    padding: '9px 10px',
                    textAlign: 'left',
                    fontSize: '0.58rem',
                    color: '#2a2a3e',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    borderBottom: '1px solid rgba(200,241,53,0.06)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.accessionNumber || index}>
                {columns.map((column) => (
                  <EdgarTd key={column}>{formatCell(row?.[column])}</EdgarTd>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function EdgarTd({ children }) {
  return (
    <td
      style={{
        padding: '9px 10px',
        color: '#888899',
        fontSize: '0.7rem',
        borderBottom: '1px solid rgba(255,255,255,0.03)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </td>
  )
}

export default function Intelligence() {
  const [trades, setTrades] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
      return Array.isArray(raw) ? raw.map(normalizeTrade) : []
    } catch {
      return []
    }
  })

  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [askError, setAskError] = useState(null)
  const [chatHistory, setChatHistory] = useState([])

  const inputRef = useRef(null)

  useEffect(() => {
    if (trades.length === 0) {
      setAnalysis(null)
      return
    }
    runAnalysis()
  }, [trades])

  const runAnalysis = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await analyzeJournal(trades)
      setAnalysis(result)
    } catch (e) {
      setError(
        e.message?.includes('fetch')
          ? 'Could not connect to backend. Make sure the server is running.'
          : 'Analysis failed. Please try again.'
      )
    } finally {
      setLoading(false)
    }
  }

  const handleAsk = async (q) => {
    const questionToAsk = q || question
    if (!questionToAsk.trim() || trades.length === 0) return

    setAsking(true)
    setAskError(null)

    const userMsg = { role: 'user', text: questionToAsk }
    setChatHistory((h) => [...h, userMsg])
    setQuestion('')

    try {
      const result = await askIntelligence(trades, questionToAsk)

      const assistantMsg = {
        role: 'assistant',
        text: result.answer,
        sources: result.sources,
        method: result.method,
      }
      setChatHistory((h) => [...h, assistantMsg])
    } catch {
      setAskError('Could not get answer. Try again.')
      setChatHistory((h) => h.slice(0, -1))
    } finally {
      setAsking(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#060608',
        backgroundImage: `
          linear-gradient(rgba(200,241,53,.035) 1px, transparent 1px),
          linear-gradient(90deg,rgba(200,241,53,.035) 1px, transparent 1px)
        `,
        backgroundSize: '36px 36px',
        color: '#fff',
        padding: 'clamp(24px,4vw,48px) clamp(16px,4vw,32px)',
      }}
    >
      <div style={{ marginBottom: 36 }}>
        <p
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '0.7rem',
            letterSpacing: '0.16em',
            color: '#C8F135',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}
        >
          AI-Powered - Behavioral Finance
        </p>

        <h1
          style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 'clamp(2.5rem,5vw,4.5rem)',
            letterSpacing: '0.03em',
            lineHeight: 0.95,
            marginBottom: 10,
          }}
        >
          Trade Intelligence
        </h1>

        <p
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '0.82rem',
            color: '#333344',
            maxWidth: 520,
          }}
        >
          RAG-powered analysis of your actual trades. Patterns, insights, and answers grounded in your own journal data.
        </p>
      </div>

      {trades.length === 0 && (
        <div
          style={{
            maxWidth: 500,
            padding: 40,
            background: '#0c0c14',
            border: '1px solid rgba(200,241,53,0.1)',
            borderRadius: 4,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '3rem', marginBottom: 16, opacity: 0.3 }}>📊</div>

          <h2
            style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '1.6rem',
              marginBottom: 10,
              color: '#C8F135',
            }}
          >
            No Trades Yet
          </h2>

          <p
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.82rem',
              color: '#333344',
              lineHeight: 1.7,
              marginBottom: 24,
            }}
          >
            Add trades in your Journal to unlock AI-powered pattern analysis and personalized coaching.
          </p>

          <a
            href="/journal"
            style={{
              display: 'inline-block',
              padding: '10px 24px',
              background: '#C8F135',
              color: '#060608',
              borderRadius: 4,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '1rem',
              letterSpacing: '0.06em',
              textDecoration: 'none',
            }}
          >
            Go to Journal {'->'}
          </a>
        </div>
      )}

      {trades.length === 0 && (
        <div style={{ maxWidth: 760, marginTop: 20, display: 'grid', gap: 20 }}>
          <DatasetReadinessPanel trades={trades} />
          <TrainingReportPanel />
          <EdgarDiagnosticsPanel />
        </div>
      )}

      {loading && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 16,
            maxWidth: 900,
          }}
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              style={{
                height: 140,
                background: '#0c0c14',
                border: '1px solid rgba(200,241,53,0.06)',
                borderRadius: 4,
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            />
          ))}

          <style>{`
            @keyframes pulse {
              0%,100% { opacity: .4; }
              50% { opacity: .8; }
            }
          `}</style>
        </div>
      )}

      {error && (
        <div
          style={{
            padding: '20px 24px',
            background: 'rgba(255,59,59,0.06)',
            border: '1px solid rgba(255,59,59,0.2)',
            borderRadius: 4,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '0.85rem',
            color: '#FF3B3B',
            maxWidth: 600,
          }}
        >
          Warning: {error}
        </div>
      )}

      {analysis && !loading && (
        <div
          className="intel-layout"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) 380px',
            gap: 24,
            alignItems: 'start',
          }}
        >
          <style>{`
            @media(max-width: 900px) {
              .intel-layout {
                grid-template-columns: 1fr !important;
              }
              .intel-stats {
                grid-template-columns: repeat(2, 1fr) !important;
              }
              .intel-context-row {
                grid-template-columns: repeat(2, 1fr) !important;
              }
              .insight-grid {
                grid-template-columns: 1fr !important;
              }
              .intel-chat {
                position: static !important;
                height: auto !important;
                min-height: 520px;
              }
            }
            @media(max-width: 600px) {
              .intel-stats {
                grid-template-columns: 1fr !important;
              }
              .intel-context-row {
                grid-template-columns: 1fr !important;
              }
            }
          `}</style>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div
              className="intel-stats"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4,1fr)',
                gap: 12,
              }}
            >
              {[
                {
                  label: 'Total Trades',
                  value: analysis.basic_stats?.total_trades ?? 0,
                  color: '#C8F135',
                  format: (v) => v,
                },
                {
                  label: 'Win Rate',
                  value: analysis.basic_stats?.win_rate ?? 0,
                  color: (analysis.basic_stats?.win_rate ?? 0) >= 55 ? '#00FF87' : '#FF3B3B',
                  format: (v) => `${v}%`,
                },
                {
                  label: 'Net P&L',
                  value: analysis.basic_stats?.total_pnl ?? 0,
                  color: (analysis.basic_stats?.total_pnl ?? 0) >= 0 ? '#00FF87' : '#FF3B3B',
                  format: (v) => `₹${v >= 0 ? '+' : ''}${v.toLocaleString('en-IN')}`,
                },
                {
                  label: 'Profit Factor',
                  value: analysis.basic_stats?.profit_factor ?? 0,
                  color: (analysis.basic_stats?.profit_factor ?? 0) >= 1.5 ? '#00FF87' : '#FF3B3B',
                  format: (v) => `${v}x`,
                },
              ].map((stat) => (
                <div
                  key={stat.label}
                  style={{
                    background: '#0c0c14',
                    border: '1px solid rgba(200,241,53,0.08)',
                    borderRadius: 4,
                    padding: '16px 18px',
                  }}
                >
                  <div
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '0.62rem',
                      color: '#2a2a3e',
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      marginBottom: 8,
                    }}
                  >
                    {stat.label}
                  </div>
                  <div
                    style={{
                      fontFamily: "'Bebas Neue', sans-serif",
                      fontSize: '1.8rem',
                      color: stat.color,
                      lineHeight: 1,
                    }}
                  >
                    {stat.format(stat.value)}
                  </div>
                </div>
              ))}
            </div>

            {analysis.context_summary && (
              <div
                className="intel-context-row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4,minmax(0,1fr))',
                  gap: 12,
                  background: '#0c0c14',
                  border: '1px solid rgba(200,241,53,0.08)',
                  borderRadius: 4,
                  padding: '14px 16px',
                }}
              >
                {[
                  {
                    label: 'Sentiment Coverage',
                    value: formatCoverage(analysis.context_summary.sentiment_coverage),
                  },
                  {
                    label: 'Market Coverage',
                    value: formatCoverage(analysis.context_summary.market_coverage),
                  },
                  {
                    label: 'Context Trades',
                    value: Number(analysis.context_summary.trades_with_context ?? 0) || 0,
                  },
                  {
                    label: 'Asset Mix',
                    value: formatAssetMix(analysis.context_summary.asset_mix),
                  },
                ].map((item) => (
                  <div key={item.label} style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '0.6rem',
                        color: '#C8F135',
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        marginBottom: 6,
                      }}
                    >
                      {item.label}
                    </div>
                    <div
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '0.78rem',
                        color: '#888899',
                        lineHeight: 1.5,
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div>
              <p
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '0.65rem',
                  color: '#C8F135',
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  marginBottom: 14,
                }}
              >
                Detected Patterns
              </p>

              <div
                className="insight-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2,1fr)',
                  gap: 12,
                }}
              >
                {(analysis.insights || []).map((insight, i) => (
                  <InsightCard key={i} insight={insight} />
                ))}
              </div>
            </div>

            <div
              style={{
                background: '#0c0c14',
                border: '1px solid rgba(200,241,53,0.08)',
                borderRadius: 4,
                padding: '20px 22px',
              }}
            >
              <PatternHeatmap byDay={analysis.by_day || {}} />
            </div>

            {analysis.by_symbol?.length > 0 && (
              <div
                style={{
                  background: '#0c0c14',
                  border: '1px solid rgba(200,241,53,0.08)',
                  borderRadius: 4,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    padding: '16px 20px',
                    borderBottom: '1px solid rgba(200,241,53,0.06)',
                  }}
                >
                  <p
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '0.65rem',
                      color: '#C8F135',
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      margin: 0,
                    }}
                  >
                    Symbol Breakdown
                  </p>
                </div>

                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  <thead>
                    <tr>
                      {['Symbol', 'Trades', 'Win Rate', 'Avg P&L', 'Total P&L'].map((h) => (
                        <th
                          key={h}
                          style={{
                            padding: '10px 16px',
                            textAlign: 'left',
                            fontSize: '0.62rem',
                            color: '#2a2a3e',
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            fontWeight: 500,
                            borderBottom: '1px solid rgba(200,241,53,0.06)',
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {analysis.by_symbol.map((row, i) => (
                      <tr key={i}>
                        <td style={{ padding: '10px 16px', color: '#fff', fontWeight: 700, fontSize: '0.82rem' }}>
                          {row.symbol}
                        </td>
                        <td style={{ padding: '10px 16px', color: '#555566', fontSize: '0.78rem' }}>
                          {row.trades}
                        </td>
                        <td
                          style={{
                            padding: '10px 16px',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            color: row.win_rate >= 55 ? '#00FF87' : '#FF3B3B',
                          }}
                        >
                          {row.win_rate}%
                        </td>
                        <td
                          style={{
                            padding: '10px 16px',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            color: row.avg_pnl >= 0 ? '#00FF87' : '#FF3B3B',
                          }}
                        >
                          {row.avg_pnl >= 0 ? '+' : ''}₹{row.avg_pnl.toLocaleString('en-IN')}
                        </td>
                        <td
                          style={{
                            padding: '10px 16px',
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            color: row.total_pnl >= 0 ? '#00FF87' : '#FF3B3B',
                          }}
                        >
                          {row.total_pnl >= 0 ? '+' : ''}₹{row.total_pnl.toLocaleString('en-IN')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <DatasetReadinessPanel trades={trades} />
            <TrainingReportPanel />
            <EdgarDiagnosticsPanel />
          </div>

          <div
            className="intel-chat"
            style={{
              background: '#0c0c14',
              border: '1px solid rgba(200,241,53,0.12)',
              borderRadius: 4,
              display: 'flex',
              flexDirection: 'column',
              height: 'calc(100vh - 200px)',
              position: 'sticky',
              top: 80,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid rgba(200,241,53,0.08)',
                flexShrink: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <div
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: analysis.llm_available ? '#00FF87' : '#C8F135',
                    boxShadow: `0 0 6px ${analysis.llm_available ? '#00FF87' : '#C8F135'}`,
                  }}
                />
                <p
                  style={{
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: '1.1rem',
                    letterSpacing: '0.04em',
                    margin: 0,
                  }}
                >
                  Ask Your Data
                </p>
              </div>

              <p
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '0.65rem',
                  color: '#2a2a3e',
                  margin: 0,
                }}
              >
                {analysis.llm_available ? 'AI-powered - Claude Haiku' : 'Pattern-matched - No API key'}
                {' - '}
                {trades.length} trades indexed
              </p>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '16px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              {chatHistory.length === 0 && (
                <div>
                  <p
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '0.78rem',
                      color: '#555566',
                      marginBottom: 16,
                      lineHeight: 1.7,
                    }}
                  >
                    Ask me anything about your trades. I analyze your actual journal data to give you specific answers.
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {EXAMPLE_QUESTIONS.map((q, i) => (
                      <button
                        key={i}
                        onClick={() => handleAsk(q)}
                        style={{
                          textAlign: 'left',
                          padding: '9px 14px',
                          background: 'transparent',
                          border: '1px solid rgba(200,241,53,0.1)',
                          borderRadius: 4,
                          color: '#444466',
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                          lineHeight: 1.4,
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = 'rgba(200,241,53,0.3)'
                          e.currentTarget.style.color = '#C8F135'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = 'rgba(200,241,53,0.1)'
                          e.currentTarget.style.color = '#444466'
                        }}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {chatHistory.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '0.6rem',
                      color: '#2a2a3e',
                      letterSpacing: '0.08em',
                      marginBottom: 4,
                    }}
                  >
                    {msg.role === 'user' ? 'YOU' : 'BULLCAST AI'}
                  </span>

                  <div
                    style={{
                      maxWidth: '90%',
                      padding: '10px 14px',
                      background: msg.role === 'user' ? 'rgba(200,241,53,0.08)' : '#0e0e1a',
                      border: `1px solid ${
                        msg.role === 'user' ? 'rgba(200,241,53,0.2)' : 'rgba(255,255,255,0.06)'
                      }`,
                      borderRadius: msg.role === 'user' ? '4px 4px 2px 4px' : '4px 4px 4px 2px',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '0.8rem',
                      color: msg.role === 'user' ? '#C8F135' : '#888899',
                      lineHeight: 1.7,
                      whiteSpace: 'pre-line',
                    }}
                  >
                    {msg.text}
                  </div>

                  {msg.sources?.length > 0 && (
                    <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span
                        style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: '0.6rem',
                          color: '#2a2a3e',
                        }}
                      >
                        Sources:
                      </span>

                      {msg.sources.map((src, si) => (
                        <span
                          key={si}
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: '0.6rem',
                            color: '#333344',
                            padding: '2px 6px',
                            border: '1px solid rgba(255,255,255,0.06)',
                            borderRadius: 3,
                          }}
                        >
                          {src.symbol} {src.date} ({src.result})
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {asking && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '10px 0' }}>
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: '#C8F135',
                        animation: `dot 1.2s ease-in-out ${i * 0.2}s infinite`,
                      }}
                    />
                  ))}

                  <style>{`
                    @keyframes dot {
                      0%,80%,100% { opacity: .2; }
                      40% { opacity: 1; }
                    }
                  `}</style>
                </div>
              )}

              {askError && (
                <div
                  style={{
                    padding: '8px 12px',
                    background: 'rgba(255,59,59,0.06)',
                    border: '1px solid rgba(255,59,59,0.2)',
                    borderRadius: 4,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '0.72rem',
                    color: '#FF3B3B',
                  }}
                >
                  {askError}
                </div>
              )}
            </div>

            <div
              style={{
                padding: '14px 16px',
                borderTop: '1px solid rgba(200,241,53,0.08)',
                flexShrink: 0,
              }}
            >
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  ref={inputRef}
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !asking) handleAsk()
                  }}
                  placeholder={trades.length === 0 ? 'Add trades first...' : 'Ask about your trades...'}
                  disabled={trades.length === 0 || asking}
                  style={{
                    flex: 1,
                    background: '#060608',
                    border: '1px solid rgba(200,241,53,0.15)',
                    borderRadius: 4,
                    padding: '10px 14px',
                    color: '#fff',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '0.82rem',
                    outline: 'none',
                    opacity: trades.length === 0 ? 0.4 : 1,
                  }}
                />

                <button
                  onClick={() => handleAsk()}
                  disabled={!question.trim() || asking || trades.length === 0}
                  style={{
                    padding: '10px 16px',
                    background: question.trim() && !asking && trades.length > 0 ? '#C8F135' : '#111120',
                    border: 'none',
                    borderRadius: 4,
                    color: question.trim() && !asking && trades.length > 0 ? '#060608' : '#2a2a3e',
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: '0.9rem',
                    letterSpacing: '0.04em',
                    cursor: question.trim() && !asking ? 'pointer' : 'not-allowed',
                    transition: 'all 0.15s',
                    flexShrink: 0,
                  }}
                >
                  {asking ? '...' : 'ASK ->'}
                </button>
              </div>

              <p
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '0.6rem',
                  color: '#1e1e2e',
                  marginTop: 8,
                  lineHeight: 1.5,
                }}
              >
                Answers are based on your journal data only. Not financial advice.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
