import { Link, useLocation } from "react-router-dom";

export default function Navbar() {
  const location = useLocation();
  const isActive = (path) => location.pathname === path ? "text-primary" : "text-neutral hover:text-white";

  return (
    <nav className="flex items-center justify-between p-4 bg-background border-b border-border">
      <div className="font-bold text-xl text-white">
        <Link to="/">Bullcast</Link>
      </div>
      <div className="flex gap-6 font-medium">
        <Link to="/sentiment" className={isActive("/sentiment")}>Sentiment</Link>
        <Link to="/watchlist" className={isActive("/watchlist")}>Watchlist</Link>
        <Link to="/backtest" className={isActive("/backtest")}>Backtest</Link>
        <Link to="/journal" className={isActive("/journal")}>Journal</Link>
      </div>
    </nav>
  );
}
