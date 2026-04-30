import { useState, useRef, useEffect } from "react";
import { useSearch } from "../hooks/useSearch";
import StockLogo from "./StockLogo";

const POPULAR_SYMBOLS = [
  { symbol: "RELIANCE.NS", name: "Reliance Industries", type: "stock" },
  { symbol: "TCS.NS", name: "Tata Consultancy Services", type: "stock" },
  { symbol: "HDFCBANK.NS", name: "HDFC Bank", type: "stock" },
  { symbol: "^NSEI", name: "Nifty 50", type: "index" },
];

/**
 * @param {{ onSelect: (symbol: string, name?: string) => void, placeholder?: string, autoFocus?: boolean }} props
 */
export default function SearchBar({ onSelect, placeholder = "WHICH STOCK?", autoFocus = false }) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const containerRef = useRef(null);

  const { results, loading } = useSearch(query);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setFocused(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (symbol, name) => {
    setQuery("");
    setFocused(false);
    onSelect(symbol, name);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && query.trim()) {
      e.preventDefault();
      handleSelect(query.trim().toUpperCase());
    }
  };

  const showDropdown = focused && (query.length > 0 || POPULAR_SYMBOLS.length > 0);
  const displayResults = query.trim() ? results : POPULAR_SYMBOLS;

  return (
    <div className="relative w-full z-50" ref={containerRef}>
      <div className="flex border-b-2 border-muted focus-within:border-primary transition-colors">
        <input 
          type="text" 
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="flex-1 bg-transparent px-0 py-3 text-xl md:text-2xl font-mono text-white outline-none uppercase placeholder:text-neutral-500 focus:placeholder:opacity-0 transition-all"
        />
        <button 
          onClick={() => { if (query.trim()) handleSelect(query.trim().toUpperCase()); }}
          className="font-mono text-primary text-sm tracking-widest uppercase hover:text-white transition-colors flex items-center gap-2 whitespace-nowrap"
        >
          Analyze &rarr;
        </button>
      </div>

      {showDropdown && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border shadow-2xl max-h-80 overflow-y-auto">
          {loading && query.trim() ? (
            <div className="p-4 text-center font-mono text-xs text-neutral-400 uppercase tracking-widest animate-pulse">
              Searching...
            </div>
          ) : displayResults && displayResults.length > 0 ? (
            <div className="flex flex-col py-2">
              {!query.trim() && (
                <div className="px-4 py-2 text-[10px] font-mono uppercase tracking-widest text-neutral-500 border-b border-border/50">
                  Popular Assets
                </div>
              )}
              {displayResults.map((item, idx) => (
                <div 
                  key={idx}
                  onClick={() => handleSelect(item.symbol, item.name)}
                  className="px-4 py-3 hover:bg-white/5 cursor-pointer flex items-center gap-3 border-b border-border/30 last:border-0"
                >
                  <StockLogo symbol={item.symbol} name={item.name} size={28} />
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="font-mono font-semibold text-white tracking-wider">{item.symbol}</span>
                    <span className="font-mono text-xs text-neutral-400 truncate">{item.name}</span>
                  </div>
                  <div className="flex gap-2 items-center flex-shrink-0">
                    {item.type === "stock" && <span className="text-[10px] uppercase font-mono tracking-widest text-bullish border border-bullish/30 px-2 py-0.5 rounded-sm">Stock</span>}
                    {item.type === "index" && <span className="text-[10px] uppercase font-mono tracking-widest text-lime-400 border border-lime-400/30 px-2 py-0.5 rounded-sm">Index</span>}
                    {item.type === "crypto" && <span className="text-[10px] uppercase font-mono tracking-widest text-amber-400 border border-amber-400/30 px-2 py-0.5 rounded-sm">Crypto</span>}
                    {item.type === "forex" && <span className="text-[10px] uppercase font-mono tracking-widest text-blue-400 border border-blue-400/30 px-2 py-0.5 rounded-sm">Forex</span>}
                    {item.type === "commodity" && <span className="text-[10px] uppercase font-mono tracking-widest text-amber-600 border border-amber-600/30 px-2 py-0.5 rounded-sm">Cmdty</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : query.trim() ? (
            <div className="p-4 text-center font-mono text-xs text-neutral-400 uppercase tracking-widest">
              No results found
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
