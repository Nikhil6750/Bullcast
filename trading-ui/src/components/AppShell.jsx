import { Link, NavLink, Outlet } from "react-router-dom";
import AuthStatus from "./AuthStatus";
import "./AppShell.css";

const NAV_LINKS = [
  { to: "/sentiment", label: "Sentiment" },
  { to: "/watchlist", label: "Watchlist" },
  { to: "/backtest", label: "Backtest" },
  { to: "/journal", label: "Journal" },
  { to: "/intelligence", label: "Intelligence" },
];

export default function AppShell() {
  return (
    <div className="app-shell">
      <div className="app-grid-layer" aria-hidden="true" />
      <header className="app-header">
        <div className="header-inner">
          <Link to="/" className="brand" aria-label="Bullcast home">
            <span className="brand-mark">B</span>
            <span className="brand-name">
              BULLCAST<span className="brand-dot">.</span>
            </span>
          </Link>

          <nav className="main-nav" aria-label="Primary navigation">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) => (
                  isActive ? "nav-link nav-link--active" : "nav-link"
                )}
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          <AuthStatus />
        </div>
      </header>

      <div className="app-disclaimer">Prototype only. Not financial advice.</div>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
