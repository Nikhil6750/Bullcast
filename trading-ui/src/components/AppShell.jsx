import { Link, useLocation } from "react-router-dom";
import AuthStatus from "./AuthStatus";
import "./AppShell.css";

const NAV_LINKS = [
  { path: "/sentiment", label: "Sentiment" },
  { path: "/watchlist", label: "Watchlist" },
  { path: "/backtest", label: "Backtest" },
  { path: "/journal", label: "Journal" },
  { path: "/intelligence", label: "Intelligence" },
];

export default function AppShell({ children, user, onSignOut }) {
  const location = useLocation();

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <Link to="/" className="brand" aria-label="Bullcast home">
            <span className="brand-mark" aria-hidden="true">◆</span>
            <span className="brand-name">Bullcast</span>
          </Link>

          <nav className="main-nav" aria-label="Main navigation">
            {NAV_LINKS.map(({ path, label }) => (
              <Link
                key={path}
                to={path}
                className={`nav-link${location.pathname.startsWith(path) ? " nav-link--active" : ""}`}
                aria-current={location.pathname.startsWith(path) ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>

          <AuthStatus user={user} onSignOut={onSignOut} />
        </div>
      </header>

      <main className="app-main">
        {children}
      </main>
    </div>
  );
}
