import { useEffect, useState } from "react";

export default function ScoreGauge({ score, sentiment }) {
  const [animatedScore, setAnimatedScore] = useState(0);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimatedScore(score);
    }, 100);
    return () => clearTimeout(timer);
  }, [score]);

  const offset = circumference - (animatedScore / 100) * circumference;
  const strokeColor = sentiment === "BULLISH" ? "#00FF87" : sentiment === "BEARISH" ? "#FF3B3B" : "#333344";

  return (
    <div className="relative w-full max-w-[200px] mx-auto flex items-center justify-center py-4">
      <svg viewBox="0 0 110 110" className="w-full h-full transform -rotate-90 drop-shadow-[0_0_12px_rgba(0,0,0,0.5)]">
        <circle 
          cx="55" cy="55" r={radius} 
          fill="none" stroke="#111120" strokeWidth="8" 
        />
        <circle 
          cx="55" cy="55" r={radius} 
          fill="none" stroke={strokeColor} strokeWidth="8" 
          strokeDasharray={circumference} 
          strokeDashoffset={offset} 
          strokeLinecap="round"
          className="transition-all duration-[900ms] ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pt-4">
        <div className="text-5xl font-display text-primary leading-none tracking-wider">
          {animatedScore}
        </div>
        <div className="text-[10px] font-mono text-neutral-400 mb-1">/100</div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-white px-2 py-0.5 rounded-[2px] bg-ghost border border-border">
          {sentiment}
        </div>
      </div>
    </div>
  );
}
