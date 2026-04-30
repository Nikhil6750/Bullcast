export default function TickerTape() {
  const stocks = [
    { sym: "RELIANCE", score: 74, sentiment: "BULLISH" },
    { sym: "TCS", score: 62, sentiment: "BULLISH" },
    { sym: "HDFCBANK", score: 48, sentiment: "NEUTRAL" },
    { sym: "INFY", score: 55, sentiment: "BULLISH" },
    { sym: "ICICIBANK", score: 31, sentiment: "BEARISH" },
    { sym: "SBIN", score: 68, sentiment: "BULLISH" },
    { sym: "BAJFINANCE", score: 42, sentiment: "NEUTRAL" },
    { sym: "TATAMOTORS", score: 81, sentiment: "BULLISH" },
    { sym: "ITC", score: 50, sentiment: "NEUTRAL" },
    { sym: "LT", score: 25, sentiment: "BEARISH" }
  ];
  
  // Create a 2x repeated list for seamless scrolling
  const items = [...stocks, ...stocks];

  return (
    <div className="w-full bg-card border-y border-border py-4 overflow-hidden relative font-mono text-xs tracking-widest uppercase flex items-center">
      {/* Fade masks */}
      <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-card to-transparent z-10 pointer-events-none"></div>
      <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-card to-transparent z-10 pointer-events-none"></div>
      
      {/* 200% width container translating 0 to -50% */}
      <div className="flex w-[200%] animate-[ticker_22s_linear_infinite]">
        {items.map((stock, i) => {
          const color = stock.sentiment === "BULLISH" ? "text-bullish" : stock.sentiment === "BEARISH" ? "text-bearish" : "text-neutral-400";
          return (
            <div key={i} className="flex-1 flex items-center justify-center gap-3 px-4 shrink-0">
              <span className="text-white font-bold">{stock.sym}</span>
              <span className={color}>{stock.score}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
