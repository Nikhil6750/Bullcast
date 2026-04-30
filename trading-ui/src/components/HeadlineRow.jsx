export default function HeadlineRow({ headline, idx }) {
  const score = headline.score || 0;
  const isBullish = score > 0.2;
  const isBearish = score < -0.2;
  const colorClass = isBullish ? "text-bullish border-bullish" : isBearish ? "text-bearish border-bearish" : "text-neutral-400 border-muted";

  return (
    <a 
      href={headline.url} 
      target="_blank" 
      rel="noopener noreferrer"
      className="flex gap-4 items-center p-4 border-b border-border bg-card/10 hover:bg-cardAlt transition-all group animate-[fade-in-up_0.5s_ease-out_forwards] opacity-0"
      style={{ animationDelay: `${idx * 0.1}s` }}
    >
      <div className="text-neutral-400 font-mono text-xs w-4 shrink-0 text-right opacity-50">
        {idx + 1}
      </div>
      <div className="flex-1 font-mono text-sm text-white group-hover:text-primary transition-colors pr-2 leading-relaxed">
        {headline.title}
      </div>
      <div className={`shrink-0 font-mono text-[10px] font-bold px-2 py-1 bg-background border ${colorClass} rounded-[4px] min-w-[50px] text-center`}>
        {score > 0 ? "+" : ""}{(score * 100).toFixed(0)}
      </div>
      <div className="shrink-0 text-neutral-400 group-hover:text-primary transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
      </div>
    </a>
  );
}
