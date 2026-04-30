import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import ScoreGauge from "../components/ScoreGauge";
import HeadlineRow from "../components/HeadlineRow";
import ShareButton from "../components/ShareButton";
import SearchBar from "../components/SearchBar";
import StockLogo from "../components/StockLogo";

export default function Sentiment() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialStock = searchParams.get("stock") || "";
  
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const fetchSentiment = async (stockSymbol) => {
    if (!stockSymbol) return;
    
    setLoading(true);
    setError(null);
    setData(null);
    
    try {
      const response = await axios.post("http://localhost:8000/api/sentiment", { stock: stockSymbol });
      if (response.data && response.data.headlines && response.data.headlines.length > 0) {
        setData(response.data);
      } else {
        setError(`No news found for ${stockSymbol}. Try NSE format e.g. RELIANCE`);
      }
    } catch (err) {
      console.error(err);
      setError("Backend's asleep. Try again in a sec.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialStock) {
      fetchSentiment(initialStock);
    }
  }, [initialStock]);

  const handleSelect = (symbol) => {
    if (symbol) {
      setSearchParams({ stock: symbol.toUpperCase() });
    }
  };

  return (
    <div className="flex flex-col min-h-full">
      <div className="w-full max-w-7xl mx-auto px-6 py-8">
        {/* Top Search Bar */}
        <div className="w-full mb-12 border-b border-border pb-4">
          <SearchBar onSelect={handleSelect} placeholder="WHICH STOCK?" />
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-32 animate-pulse">
            <div className="text-primary font-mono text-sm tracking-widest uppercase mb-4">Reading the room...</div>
            <div className="flex gap-2">
              <div className="w-2 h-2 bg-primary rounded-full animate-bounce"></div>
              <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{animationDelay: "0.1s"}}></div>
              <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{animationDelay: "0.2s"}}></div>
            </div>
          </div>
        )}
        
        {/* Error State */}
        {error && !loading && (
          <div className="border border-bearish text-bearish px-6 py-4 bg-bearish/10 font-mono text-sm tracking-wider uppercase flex items-center justify-center py-20">
            {error}
          </div>
        )}

        {/* Dashboard Layout */}
        {!loading && !error && data && (
          <div className="w-full animate-[fade-in-up_0.4s_ease-out]">
            {/* Header */}
            <div className="w-full border-b border-border pb-6 mb-8 flex justify-between items-end gap-4">
              <div className="flex items-center gap-4">
                <StockLogo symbol={data.stock} name={data.company_name} size={52} />
                <div>
                  <h1 className="text-7xl md:text-8xl font-display text-white tracking-widest leading-none mb-1">{data.display_symbol || data.stock}</h1>
                  {data.company_name && <div className="font-mono text-sm text-neutral-400 tracking-wider">{data.company_name}</div>}
                </div>
              </div>
              <div className={`px-4 py-1 text-xl font-display tracking-widest border flex-shrink-0 ${data.sentiment === "BULLISH" ? "border-bullish text-bullish bg-bullish/10" : data.sentiment === "BEARISH" ? "border-bearish text-bearish bg-bearish/10" : "border-muted text-neutral-400 bg-muted/10"}`}>
                {data.sentiment}
              </div>
            </div>

            {/* Desktop Two-Column, Mobile Stacked */}
            <div className="flex flex-col md:flex-row gap-12">
              
              {/* Left Column 40% */}
              <div className="w-full md:w-[40%] flex flex-col gap-6">
                <ScoreGauge score={data.score} sentiment={data.sentiment} />
                
                <div className="grid grid-cols-3 gap-2 font-mono text-center text-xs mt-4">
                  <div className="bg-card border border-border p-3 rounded-[4px] flex flex-col gap-1">
                    <span className="text-neutral-400">POS</span>
                    <span className="text-bullish">{data.positive_pct}%</span>
                  </div>
                  <div className="bg-card border border-border p-3 rounded-[4px] flex flex-col gap-1">
                    <span className="text-neutral-400">NEU</span>
                    <span className="text-white">{data.neutral_pct}%</span>
                  </div>
                  <div className="bg-card border border-border p-3 rounded-[4px] flex flex-col gap-1">
                    <span className="text-neutral-400">NEG</span>
                    <span className="text-bearish">{data.negative_pct}%</span>
                  </div>
                </div>

                <div className="mt-8">
                  <ShareButton data={data} />
                </div>
              </div>

              {/* Right Column 60% */}
              <div className="w-full md:w-[60%] flex flex-col">
                <div className="font-mono text-xs text-neutral-400 uppercase tracking-widest border-b border-border pb-2 mb-4">
                  Analyzed Headlines
                </div>
                {data.headlines.map((headline, idx) => (
                  <HeadlineRow key={idx} headline={headline} idx={idx} />
                ))}
              </div>

            </div>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && !data && !initialStock && (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <div className="text-neutral-400 font-display text-4xl tracking-widest">AWAITING INPUT</div>
          </div>
        )}
      </div>
    </div>
  );
}
