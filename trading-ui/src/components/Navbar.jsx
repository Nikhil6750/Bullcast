import { Link, useLocation } from "react-router-dom";
import AuthStatus from "./AuthStatus";

export default function Navbar() {
  const location = useLocation();
  const isActive = (path) => location.pathname === path ? "text-primary border-b-2 border-primary" : "text-neutral hover:text-white";

  return (
    <nav className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-4 border-b border-border bg-background/80 px-4 py-4 backdrop-blur-md sm:px-8">
      <div className="font-display text-3xl tracking-widest text-white hover:text-primary transition-colors">
        <Link to="/">BULLCAST<span className="text-primary">.</span></Link>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-4 sm:gap-6">
        <div className="flex flex-wrap justify-end gap-x-4 gap-y-2 font-mono text-sm uppercase tracking-wider sm:gap-x-8">
          <Link to="/sentiment" className={`py-1 transition-colors ${isActive("/sentiment")}`}>Sentiment</Link>
          <Link to="/watchlist" className={`py-1 transition-colors ${isActive("/watchlist")}`}>Watchlist</Link>
          <Link to="/backtest" className={`py-1 transition-colors ${isActive("/backtest")}`}>Backtest</Link>
          <Link to="/journal" className={`py-1 transition-colors ${isActive("/journal")}`}>Journal</Link>
          <Link to="/intelligence" className={`py-1 transition-colors ${isActive("/intelligence")}`}>Intelligence</Link>
        </div>
        <AuthStatus />
      </div>
    </nav>
  );
}
