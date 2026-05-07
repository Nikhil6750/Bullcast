const SEVERITY_CONFIG = {
  critical: {
    border: "rgba(255,59,59,0.3)",
    glow: "rgba(255,59,59,0.05)",
    accent: "#FF3B3B",
    label: "ACTION NEEDED",
  },
  warning: {
    border: "rgba(200,241,53,0.25)",
    glow: "rgba(200,241,53,0.04)",
    accent: "#C8F135",
    label: "INSIGHT",
  },
  positive: {
    border: "rgba(0,255,135,0.25)",
    glow: "rgba(0,255,135,0.04)",
    accent: "#00FF87",
    label: "POSITIVE",
  },
  info: {
    border: "rgba(255,255,255,0.08)",
    glow: "rgba(255,255,255,0.02)",
    accent: "#888899",
    label: "INFO",
  },
};

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

export default function InsightCard({ insight }) {
  const item = insight && typeof insight === "object" ? insight : {};
  const severity = String(item.severity || item.type || "info").toLowerCase();
  const cfg = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.info;
  const title = firstText(item.title, item.name, item.type, "Journal Pattern");
  const finding = firstText(
    item.finding,
    item.message,
    item.description,
    item.insight,
    "No detailed finding returned yet. Add more complete journal trades to improve the analysis."
  );
  const recommendation = firstText(
    item.recommendation,
    item.next_step,
    item.action,
    "Review this pattern after more real trades are recorded."
  );

  return (
    <div
      style={{
        background: cfg.glow,
        border: `1px solid ${cfg.border}`,
        borderRadius: 4,
        padding: "20px 22px",
        position: "relative",
        overflow: "hidden",
        transition: "transform 0.2s",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.transform = "translateY(0)";
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: `linear-gradient(90deg, ${cfg.accent}80, ${cfg.accent}20, transparent)`,
        }}
      />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <h3
          style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: "1.15rem",
            color: "#fff",
            letterSpacing: "0.03em",
            margin: 0,
            overflowWrap: "anywhere",
          }}
        >
          {title}
        </h3>

        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.6rem",
            color: cfg.accent,
            letterSpacing: "0.12em",
            padding: "3px 8px",
            border: `1px solid ${cfg.border}`,
            borderRadius: 3,
            whiteSpace: "nowrap",
          }}
        >
          {cfg.label}
        </span>
      </div>

      <p
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "0.82rem",
          color: "#888899",
          lineHeight: 1.7,
          marginBottom: 14,
          overflowWrap: "anywhere",
        }}
      >
        {finding}
      </p>

      <div
        style={{
          padding: "10px 14px",
          background: "rgba(255,255,255,0.02)",
          borderLeft: `2px solid ${cfg.accent}`,
          borderRadius: "0 3px 3px 0",
        }}
      >
        <p
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "0.78rem",
            color: cfg.accent,
            lineHeight: 1.6,
            margin: 0,
            overflowWrap: "anywhere",
          }}
        >
          {"->"} {recommendation}
        </p>
      </div>
    </div>
  );
}
