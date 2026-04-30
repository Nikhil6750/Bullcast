import { useState, useEffect } from "react";
import axios from "axios";
import WatchlistCard from "../components/WatchlistCard";

export default function Watchlist() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState("");

  const fetchWatchlist = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get("http://localhost:8000/api/watchlist");
      setData(response.data);
      const now = new Date();
      setLastRefreshed(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      console.error(err);
      setError("Service temporarily unavailable. Could not load watchlist.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWatchlist();
  }, []);

  return (
    <div className="min-h-full p-6 text-white max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2">Market Mood Board</h1>
          <p className="text-neutral">Sentiment snapshot of top 20 Indian stocks based on today's news</p>
        </div>
        
        <div className="flex items-center gap-4 text-sm">
          {lastRefreshed && <span className="text-neutral">Last refreshed: {lastRefreshed}</span>}
          <button 
            onClick={fetchWatchlist}
            disabled={loading}
            className="px-3 py-1.5 bg-card border border-border hover:bg-neutral/20 rounded-lg transition-colors flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={loading ? "animate-spin" : ""}><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-bearish/10 border border-bearish/20 text-bearish px-6 py-4 rounded-xl w-full text-center mb-8">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        {loading && data.length === 0 ? (
          // Skeleton loaders
          Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-5 shadow-sm h-32 animate-pulse flex flex-col justify-between">
              <div className="flex justify-between">
                <div className="w-1/2 h-6 bg-border rounded"></div>
                <div className="w-1/4 h-6 bg-border rounded"></div>
              </div>
              <div className="w-full h-2 bg-border rounded mt-4"></div>
            </div>
          ))
        ) : (
          data.map((item, idx) => (
            <WatchlistCard key={idx} data={item} />
          ))
        )}
      </div>
      
      {!loading && !error && data.length === 0 && (
        <div className="text-center py-20 text-neutral">
          No watchlist data available.
        </div>
      )}
    </div>
  );
}
