function insightTone(severity) {
  const value = String(severity || '').toLowerCase()
  if (value === 'critical') return { color: '#FF3B3B', border: 'rgba(255,59,59,0.22)', background: 'rgba(255,59,59,0.06)' }
  if (value === 'warning') return { color: '#FFB84D', border: 'rgba(255,184,77,0.22)', background: 'rgba(255,184,77,0.06)' }
  if (value === 'positive') return { color: '#00FF87', border: 'rgba(0,255,135,0.2)', background: 'rgba(0,255,135,0.06)' }
  return { color: '#C8F135', border: 'rgba(200,241,53,0.14)', background: 'rgba(200,241,53,0.04)' }
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (text) return text
  }
  return '-'
}

export default function InsightCard({ insight }) {
  const item = insight && typeof insight === 'object' ? insight : {}
  const tone = insightTone(item.severity || item.type)
  const title = firstText(item.title, item.name, item.type, 'Pattern')
  const body = firstText(item.message, item.description, item.insight, item.recommendation)

  return (
    <div
      style={{
        background: '#0c0c14',
        border: `1px solid ${tone.border}`,
        borderRadius: 4,
        padding: '14px 16px',
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          marginBottom: 8,
        }}
      >
        <div
          style={{
            color: tone.color,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '0.62rem',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            overflowWrap: 'anywhere',
          }}
        >
          {title}
        </div>
        {(item.severity || item.type) && (
          <span
            style={{
              color: tone.color,
              background: tone.background,
              border: `1px solid ${tone.border}`,
              borderRadius: 3,
              padding: '3px 6px',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.52rem',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}
          >
            {item.severity || item.type}
          </span>
        )}
      </div>
      <div
        style={{
          color: '#888899',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.72rem',
          lineHeight: 1.6,
          overflowWrap: 'anywhere',
        }}
      >
        {body}
      </div>
    </div>
  )
}
