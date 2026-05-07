const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function getDayData(byDay, day) {
  if (!byDay || typeof byDay !== "object") return null;
  return byDay[day] || byDay[day.toLowerCase()] || byDay[day.slice(0, 3)] || byDay[day.slice(0, 3).toLowerCase()] || null;
}

function getWinRate(data) {
  if (!data || typeof data !== "object") return null;
  const value = Number(data.win_rate ?? data.winRate ?? data.winrate);
  return Number.isFinite(value) ? value : null;
}

function getTradeCount(data) {
  if (!data || typeof data !== "object") return 0;
  const value = Number(data.trades ?? data.count ?? data.total);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function getColor(winRate) {
  if (winRate === null) return "#111120";
  if (winRate >= 65) return "#00FF87";
  if (winRate >= 50) return "#C8F135";
  if (winRate >= 35) return "#f0a500";
  return "#FF3B3B";
}

function getOpacity(winRate) {
  if (winRate === null) return 0.1;
  return 0.15 + (Math.max(0, Math.min(100, winRate)) / 100) * 0.6;
}

export default function PatternHeatmap({ byDay = {} }) {
  const hasData = byDay && typeof byDay === "object" && Object.keys(byDay).length > 0;

  return (
    <div>
      <p
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "0.65rem",
          color: "#C8F135",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: 14,
        }}
      >
        Win Rate by Day of Week
      </p>

      {!hasData && (
        <div
          style={{
            padding: "18px 20px",
            marginBottom: 14,
            border: "1px dashed rgba(200,241,53,0.18)",
            borderRadius: 4,
            textAlign: "center",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.78rem",
            color: "#888899",
            background: "rgba(255,255,255,0.02)",
          }}
        >
          Not enough trades across different days yet. Record more real journal entries to populate the heatmap.
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(88px, 1fr))",
          gap: 8,
        }}
      >
        {DAYS.map((day) => {
          const data = getDayData(byDay, day);
          const winRate = getWinRate(data);
          const trades = getTradeCount(data);
          const color = getColor(winRate);
          const opacity = getOpacity(winRate);

          return (
            <div
              key={day}
              style={{
                background: `${color}${Math.round(opacity * 255)
                  .toString(16)
                  .padStart(2, "0")}`,
                border: `1px solid ${color}30`,
                borderRadius: 4,
                padding: "14px 10px",
                textAlign: "center",
                position: "relative",
                overflow: "hidden",
                minWidth: 0,
              }}
            >
              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "0.65rem",
                  color: "#888899",
                  letterSpacing: "0.08em",
                  marginBottom: 8,
                  textTransform: "uppercase",
                }}
              >
                {day.slice(0, 3)}
              </div>

              <div
                style={{
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: "1.6rem",
                  color: winRate !== null ? color : "#3a3a4e",
                  lineHeight: 1,
                }}
              >
                {winRate !== null ? `${Math.round(winRate)}%` : "-"}
              </div>

              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "0.6rem",
                  color: "#888899",
                  marginTop: 6,
                }}
              >
                {trades > 0 ? `${trades} trade${trades !== 1 ? "s" : ""}` : "no data"}
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          gap: 16,
          marginTop: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        {[
          { color: "#FF3B3B", label: "< 35%" },
          { color: "#f0a500", label: "35-50%" },
          { color: "#C8F135", label: "50-65%" },
          { color: "#00FF87", label: "65%+" },
        ].map((item) => (
          <div
            key={item.label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: item.color,
                opacity: 0.7,
              }}
            />
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: "0.62rem",
                color: "#888899",
              }}
            >
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
