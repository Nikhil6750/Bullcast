import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import TickerTape from "../components/TickerTape";
import CountUp from "../components/CountUp";
import SearchBar from "../components/SearchBar";
import StockLogo from "../components/StockLogo";

function StackedSentimentCard() {
  const cardRef = useRef(null);
  const [transform, setTransform] = useState("perspective(600px) rotateX(4deg) rotateY(-5deg)");
  const [transition, setTransition] = useState("transform 0.4s cubic-bezier(.23,1,.32,1)");

  const handleMouseMove = (e) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * 18;
    const y = ((e.clientY - rect.top) / rect.height - 0.5) * -14;
    setTransform(`perspective(600px) rotateX(${y + 4}deg) rotateY(${x - 5}deg)`);
    setTransition("none");
  };

  const handleMouseLeave = () => {
    setTransform("perspective(600px) rotateX(4deg) rotateY(-5deg)");
    setTransition("transform 0.4s cubic-bezier(.23,1,.32,1)");
  };

  return (
    <div 
      className="relative w-full max-w-sm h-80 mx-auto hidden sm:block perspective-[1000px] z-20"
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ transformStyle: "preserve-3d" }}
    >
      {/* Back Layer 2 */}
      <div className="absolute inset-0 bg-cardAlt border border-border opacity-30 shadow-2xl"
           style={{ transform: "perspective(600px) translateZ(-80px) rotateX(4deg) rotateY(-5deg) translate(20px, 20px)" }}></div>
           
      {/* Back Layer 1 */}
      <div className="absolute inset-0 bg-card border border-border opacity-60 shadow-2xl"
           style={{ transform: "perspective(600px) translateZ(-40px) rotateX(4deg) rotateY(-5deg) translate(10px, 10px)" }}></div>

      {/* Front Layer */}
      <div className="absolute inset-0 bg-[#0c0c14] border-2 border-border shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex flex-col p-6 z-10"
           style={{ transform, transition, transformStyle: "preserve-3d" }}>
        
        <div className="font-mono text-xs text-neutral-400 tracking-widest uppercase mb-4 flex justify-between items-center" style={{ transform: "translateZ(10px)" }}>
          <span className="text-amber-400/70 border border-amber-400/30 px-2 py-0.5 rounded-sm">Sample Data</span>
          <span className="flex items-center gap-2 text-neutral-500"><span className="w-1.5 h-1.5 rounded-full bg-neutral-500"></span> DEMO</span>
        </div>
        
        <div className="flex items-center gap-3 mb-2" style={{ transform: "translateZ(20px)" }}>
          <StockLogo symbol="RELIANCE.NS" name="Reliance Industries" size={40} />
          <div className="font-display text-5xl text-white tracking-widest">
            RELIANCE
          </div>
        </div>
        
        <div className="flex justify-between items-center mb-6" style={{ transform: "translateZ(15px)" }}>
          <div className="text-bullish font-mono text-xs tracking-widest border border-bullish/50 px-2 py-0.5 rounded-[4px]">
            BULLISH
          </div>
          <div className="font-mono text-xs text-neutral-400">
            SCORE <span className="text-white text-base ml-1"><CountUp end={74} duration={1200} /></span><span className="text-neutral-600">/100</span>
          </div>
        </div>
        
        <div className="w-full h-1 bg-border flex mb-6" style={{ transform: "translateZ(10px)" }}>
          <div className="h-full bg-bullish" style={{ width: `74%` }}></div>
        </div>
        
        <div className="grid grid-cols-3 gap-2 font-mono text-center text-xs mt-auto" style={{ transform: "translateZ(25px)" }}>
          <div className="bg-ghost border border-border p-2 rounded-[4px] flex flex-col gap-1">
            <span className="text-neutral-400">POS</span>
            <span className="text-bullish">62%</span>
          </div>
          <div className="bg-ghost border border-border p-2 rounded-[4px] flex flex-col gap-1">
            <span className="text-neutral-400">NEU</span>
            <span className="text-white">24%</span>
          </div>
          <div className="bg-ghost border border-border p-2 rounded-[4px] flex flex-col gap-1">
            <span className="text-neutral-400">NEG</span>
            <span className="text-bearish">14%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const navigate = useNavigate();

  const handleSelect = (symbol) => {
    if (symbol) {
      navigate(`/sentiment?stock=${encodeURIComponent(symbol)}`);
    }
  };

  return (
    <div className="flex flex-col min-h-full justify-between">
      <div className="w-full max-w-7xl mx-auto px-6 py-12 lg:py-24 flex-1 flex flex-col lg:flex-row gap-16 items-center">
        
        {/* Left: Typography & Search */}
        <div className="flex-1 w-full text-left relative z-10">
          <div className="font-mono text-xs text-primary uppercase tracking-widest mb-6">
            Live news sentiment · Indian markets
          </div>
          
          <div className="mb-6">
            <h1 className="font-display text-8xl sm:text-[140px] leading-[0.8] tracking-tight text-white m-0 p-0">
              DON'T<br/>
              TRADE<br/>
              <span className="text-primary">BLIND.</span>
            </h1>
          </div>
          
          <p className="font-mono text-neutral-400 text-sm uppercase tracking-widest max-w-sm leading-relaxed mb-10">
            Real-time sentiment on any stock.<br/>
            Powered by NLP. Free forever.
          </p>
          
          <div className="relative w-full max-w-md group mb-16">
            <SearchBar onSelect={handleSelect} placeholder="Which stock?" />
          </div>
          
        </div>
        
        {/* Right: 3D Stacked Card */}
        <div className="flex-1 w-full relative z-0 hidden lg:block">
          <StackedSentimentCard />
        </div>
        
      </div>
      
      {/* Ticker & Features */}
      <div className="w-full mt-auto">
        <TickerTape />
        
        <div className="w-full max-w-7xl mx-auto px-6 py-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-card border-t-2 border-primary/20 p-6 flex flex-col relative overflow-hidden">
            <div className="font-display text-2xl text-white tracking-widest mb-2">Instant sentiment</div>
            <div className="font-mono text-xs text-neutral-400 leading-relaxed uppercase">Process breaking news in real-time.</div>
          </div>
          <div className="bg-card border-t-2 border-muted p-6 flex flex-col">
            <div className="font-display text-2xl text-white tracking-widest mb-2">Daily mood board</div>
            <div className="font-mono text-xs text-neutral-400 leading-relaxed uppercase">Top 20 NSE stocks tracked constantly.</div>
          </div>
          <div className="bg-card border-t-2 border-muted p-6 flex flex-col">
            <div className="font-display text-2xl text-white tracking-widest mb-2">Backtest engine</div>
            <div className="font-mono text-xs text-neutral-400 leading-relaxed uppercase">Test strategies against historical data.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
