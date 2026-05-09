import { Link, useLocation } from "react-router-dom";
import AuthStatus from "./AuthStatus";

export default function Navbar() {
  const location = useLocation();
  const isActive = (path) => location.pathname === path ? "text-primary border-b-2 border-primary" : "text-neutral hover:text-white";

  return (
    <nav className="flex flex-wrap items-center justify-between gap-4 px-8 py-4 border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-50">
      <div className="font-display text-3xl tracking-widest text-white hover:text-primary transition-colors">
        <Link to="/">BULLCAST<span className="text-primary">.</span></Link>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-6">
        <div className="flex gap-8 font-mono text-sm uppercase tracking-wider">
          <Link to="/sentiment" className={`py-1 transition-colors ${isActive("/sentiment")}`}>Sentiment</Link>
          <Link to="/watchlist" className={`py-1 transition-colors ${isActive("/watchlist")}`}>Watchlist</Link>
          <Link to="/backtest" className={`py-1 transition-colors ${isActive("/backtest")}`}>Backtest</Link>
          <Link to="/journal" className={`py-1 transition-colors ${isActive("/journal")}`}>Journal</Link>
          <Link to="/intelligence" className={`py-1 transition-colors ${isActive("/intelligence")}`}>Intelligence</Link>
        </div>
        <div className="font-mono text-[0.58rem] uppercase tracking-wider text-primary/80">
          AUTH BUILD: supabase-auth-v1
        </div>
        <AuthStatus />
      </div>
    </nav>
  );
}
