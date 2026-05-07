const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function dayValue(row) {
  if (typeof row === 'number') return row
  if (!row || typeof row !== 'object') return 0
  return Number(row.win_rate ?? row.winRate ?? row.pnl ?? row.total_pnl ?? row.trades ?? row.count ?? 0) || 0
}

function dayCount(row) {
  if (!row || typeof row !== 'object') return null
  const value = Number(row.trades ?? row.count ?? row.total ?? 0)
  return Number.isFinite(value) && value > 0 ? value : null
}

function heatColor(value) {
  if (value > 0) return 'rgba(0,255,135,0.16)'
  if (value < 0) return 'rgba(255,59,59,0.14)'
  return 'rgba(255,255,255,0.04)'
}

export default function PatternHeatmap({ byDay = {} }) {
  const rows = DAY_ORDER.map((day) => {
    const row = byDay?.[day] ?? byDay?.[day.toLowerCase()] ?? byDay?.[day.slice(0, 3)] ?? {}
    return { day, row, value: dayValue(row), count: dayCount(row) }
  })

  return (
    <div>
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.62rem',
          color: '#C8F135',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          marginBottom: 12,
        }}
      >
        Day Pattern Heatmap
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(96px,1fr))',
          gap: 8,
        }}
      >
        {rows.map(({ day, value, count }) => (
          <div
            key={day}
            style={{
              background: heatColor(value),
              border: '1px solid rgba(200,241,53,0.08)',
              borderRadius: 4,
              padding: '10px 11px',
              minWidth: 0,
            }}
          >
            <div
              style={{
                color: '#f5f5f7',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '0.68rem',
                marginBottom: 5,
              }}
            >
              {day.slice(0, 3)}
            </div>
            <div
              style={{
                color: '#888899',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '0.62rem',
                lineHeight: 1.4,
              }}
            >
              {count === null ? 'No trades' : `${count} trades`}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
