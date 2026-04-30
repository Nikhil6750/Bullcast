import { useState } from "react";

const LOGO_MAP = {
  RELIANCE: "https://logo.clearbit.com/ril.com",
  TCS: "https://logo.clearbit.com/tcs.com",
  INFY: "https://logo.clearbit.com/infosys.com",
  HDFCBANK: "https://logo.clearbit.com/hdfcbank.com",
  ICICIBANK: "https://logo.clearbit.com/icicibank.com",
  SBIN: "https://logo.clearbit.com/onlinesbi.sbi",
  WIPRO: "https://logo.clearbit.com/wipro.com",
  TATAMOTORS: "https://logo.clearbit.com/tatamotors.com",
  MARUTI: "https://logo.clearbit.com/marutisuzuki.com",
  SUNPHARMA: "https://logo.clearbit.com/sunpharma.com",
  ONGC: "https://logo.clearbit.com/ongcindia.com",
  NTPC: "https://logo.clearbit.com/ntpc.co.in",
  POWERGRID: "https://logo.clearbit.com/powergrid.in",
  TITAN: "https://logo.clearbit.com/titan.co.in",
  ADANIENT: "https://logo.clearbit.com/adani.com",
};

/** Strip .NS / .BO / ^ prefix to get a clean ticker for lookup */
function cleanSymbol(raw) {
  let s = (raw || "").toUpperCase().trim();
  if (s.endsWith(".NS")) s = s.slice(0, -3);
  if (s.endsWith(".BO")) s = s.slice(0, -3);
  if (s.startsWith("^")) s = s.slice(1);
  return s;
}

function monogram(symbol) {
  const clean = cleanSymbol(symbol);
  // For indices / forex / commodity give short codes
  if ((symbol || "").startsWith("^")) return "IDX";
  if ((symbol || "").includes("=")) return "FX";
  if (clean.endsWith("=F")) return "CMD";
  return clean.slice(0, 2);
}

export default function StockLogo({ symbol, name, size = 36 }) {
  const [imgFailed, setImgFailed] = useState(false);
  const clean = cleanSymbol(symbol);
  const logoUrl = LOGO_MAP[clean];

  const fallbackStyle = {
    width: size,
    height: size,
    minWidth: size,
    minHeight: size,
    borderRadius: 4,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: Math.max(10, size * 0.35),
    fontFamily: "'JetBrains Mono', monospace",
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "#C8F135",
    backgroundColor: "#0c0c14",
    border: "1px solid rgba(200, 241, 53, 0.25)",
    userSelect: "none",
    flexShrink: 0,
  };

  if (!logoUrl || imgFailed) {
    return (
      <div style={fallbackStyle} title={name || symbol}>
        {monogram(symbol)}
      </div>
    );
  }

  return (
    <img
      src={`${logoUrl}?size=${size * 2}`}
      alt={name || symbol}
      title={name || symbol}
      width={size}
      height={size}
      onError={() => setImgFailed(true)}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        borderRadius: 4,
        objectFit: "contain",
        backgroundColor: "#fff",
        flexShrink: 0,
      }}
    />
  );
}
