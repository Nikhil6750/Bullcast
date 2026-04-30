import ShareButton from "./ShareButton";

export default function SentimentCard({ data }) {
  if (!data) return null;

  const badgeColor = 
    data.sentiment === "BULLISH" ? "bg-bullish text-black" :
    data.sentiment === "BEARISH" ? "bg-bearish text-white" :
    "bg-neutral text-white";

  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm w-full max-w-2xl mx-auto">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-3xl font-bold text-white uppercase tracking-wider">{data.stock}</h2>
          <div className="text-sm text-neutral mt-1">Last updated: {data.timestamp}</div>
        </div>
        <div className={`px-4 py-1 rounded-full font-bold text-sm tracking-widest ${badgeColor}`}>
          {data.sentiment}
        </div>
      </div>

      <div className="mb-6">
        <div className="flex justify-between items-end mb-2">
          <div className="text-sm text-neutral font-medium uppercase tracking-wider">Sentiment Score</div>
          <div className="text-3xl font-bold text-white">{data.score}<span className="text-lg text-neutral font-normal">/100</span></div>
        </div>
        <div className="w-full bg-border rounded-full h-3 overflow-hidden">
          <div 
            className={`h-full ${data.sentiment === "BULLISH" ? "bg-bullish" : data.sentiment === "BEARISH" ? "bg-bearish" : "bg-neutral"} transition-all duration-1000 ease-out`}
            style={{ width: `${data.score}%` }}
          ></div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-background rounded-lg p-3 text-center border border-border">
          <div className="text-xs text-neutral mb-1">Positive</div>
          <div className="text-xl font-bold text-bullish">{data.positive_pct}%</div>
        </div>
        <div className="bg-background rounded-lg p-3 text-center border border-border">
          <div className="text-xs text-neutral mb-1">Neutral</div>
          <div className="text-xl font-bold text-neutral">{data.neutral_pct}%</div>
        </div>
        <div className="bg-background rounded-lg p-3 text-center border border-border">
          <div className="text-xs text-neutral mb-1">Negative</div>
          <div className="text-xl font-bold text-bearish">{data.negative_pct}%</div>
        </div>
      </div>

      <div className="mb-6">
        <h3 className="text-lg font-bold text-white mb-3">Recent Headlines</h3>
        {data.headlines && data.headlines.length > 0 ? (
          <ul className="space-y-3">
            {data.headlines.slice(0, 5).map((headline, idx) => (
              <li key={idx} className="text-sm text-neutral hover:text-white transition-colors">
                <a href={headline.url} target="_blank" rel="noopener noreferrer" className="flex gap-2 items-start">
                  <span className="text-primary mt-1">•</span>
                  <span>{headline.title}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-neutral text-sm">No recent headlines found.</div>
        )}
      </div>

      <div className="border-t border-border pt-4 flex justify-end">
        <ShareButton data={data} />
      </div>
    </div>
  );
}
