import { Link } from "react-router-dom";
import StockLogo from "./StockLogo";

export default function WatchlistCard({ data }) {
  if (!data) return null;

  const textColor = 
    data.sentiment === "BULLISH" ? "text-bullish" :
    data.sentiment === "BEARISH" ? "text-bearish" :
    "text-neutral";
    
  const bgColor = 
    data.sentiment === "BULLISH" ? "bg-bullish" :
    data.sentiment === "BEARISH" ? "bg-bearish" :
    "bg-neutral";

  return (
    <Link to={`/sentiment?stock=${data.stock}`} className="block">
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm hover:border-primary/50 hover:bg-card/80 transition-all cursor-pointer h-full flex flex-col">
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center gap-2.5">
            <StockLogo symbol={data.stock} name={data.company_name} size={28} />
            <h3 className="text-xl font-bold text-white uppercase tracking-wider">{data.display_symbol || data.stock}</h3>
          </div>
          <div className={`text-xs font-bold px-2 py-1 rounded bg-background border border-border ${textColor}`}>
            {data.sentiment}
          </div>
        </div>
        
        <div className="mt-auto">
          <div className="flex justify-between items-end mb-2">
            <span className="text-xs text-neutral">Score</span>
            <span className={`text-lg font-bold ${textColor}`}>{data.score}<span className="text-xs text-neutral font-normal">/100</span></span>
          </div>
          
          <div className="w-full h-1.5 flex rounded-full overflow-hidden bg-border">
            <div className="h-full bg-bullish" style={{ width: `${data.positive_pct}%` }}></div>
            <div className="h-full bg-neutral/50" style={{ width: `${data.neutral_pct}%` }}></div>
            <div className="h-full bg-bearish" style={{ width: `${data.negative_pct}%` }}></div>
          </div>
        </div>
      </div>
    </Link>
  );
}
