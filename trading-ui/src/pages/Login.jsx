import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getCurrentSupabaseSession,
  getSupabaseConfigStatus,
  onSupabaseAuthStateChange,
  signInWithEmail,
  signUpWithEmail,
} from "../services/supabaseStorage";
import { enterLocalDemoMode } from "../services/entryState";
import "./Login.css";

function friendlyError(err) {
  if (!err) return null;
  const msg = (err.message || "").toLowerCase();
  if (msg.includes("invalid login") || msg.includes("invalid credentials") || msg.includes("wrong password")) {
    return "Invalid email or password.";
  }
  if (msg.includes("email not confirmed")) {
    return "Email not confirmed yet. Please check your inbox.";
  }
  if (msg.includes("password") && msg.includes("6")) {
    return "Password must be at least 6 characters.";
  }
  if (msg.includes("already registered") || msg.includes("user already exists")) {
    return "An account with this email already exists. Try signing in.";
  }
  if (msg.includes("network") || msg.includes("fetch") || msg.includes("failed")) {
    return "Supabase is unavailable. Try again later.";
  }
  return "Something went wrong. Please try again.";
}

export default function Login({ user: userProp = null, onAuthChange }) {
  const navigate = useNavigate();
  const [configStatus] = useState(() => getSupabaseConfigStatus());
  const [sessionUser, setSessionUser] = useState(userProp);
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const configured = configStatus.supabaseConfigured;
  const user = userProp || sessionUser;
  const isSignup = mode === "signup";

  useEffect(() => {
    setSessionUser(userProp);
  }, [userProp]);

  useEffect(() => {
    if (!configured) return undefined;

    let active = true;
    getCurrentSupabaseSession().then((session) => {
      if (!active) return;
      const nextUser = session?.user ?? null;
      setSessionUser(nextUser);
      if (nextUser && onAuthChange) onAuthChange(nextUser);
    });

    const unsubscribe = onSupabaseAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      setSessionUser(nextUser);
      if (onAuthChange) onAuthChange(nextUser);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [configured, onAuthChange]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!configured) {
      setError(
        configStatus.supabaseUrlIsRestEndpoint
          ? "VITE_SUPABASE_URL must be the base Supabase project URL, not the REST API URL."
          : "Supabase is unavailable. Try again later."
      );
      return;
    }

    if (!email.trim()) {
      setError("Please enter your email.");
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    try {
      if (mode === "signin") {
        const data = await signInWithEmail(email.trim(), password);
        const nextUser = data?.user ?? data?.session?.user ?? null;
        if (nextUser) {
          setSessionUser(nextUser);
          if (onAuthChange) onAuthChange(nextUser);
        }
        navigate("/journal");
      } else {
        await signUpWithEmail(email.trim(), password);
        setSuccess("Account created. Check your email to confirm your account.");
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }

  function handleLocalDemo() {
    enterLocalDemoMode();
    navigate("/journal");
  }

  return (
    <div className="login-root">
      <div className="login-bg" aria-hidden="true">
        <div className="login-bg-grid" />
        <div className="login-bg-glow" />
      </div>

      <aside className="login-sidebar">
        <div className="login-sidebar-inner">
          <div className="login-logo">
            <span className="login-logo-mark">◆</span>
            <span className="login-logo-name">Bullcast</span>
          </div>
          <p className="login-tagline">
            Trading journal intelligence<br />with secure cloud sync.
          </p>
          <ul className="login-features">
            <li>
              <span className="login-feature-dot" />
              Import CSV &amp; XLSX trades
            </li>
            <li>
              <span className="login-feature-dot" />
              Trade intelligence &amp; analytics
            </li>
            <li>
              <span className="login-feature-dot" />
              Sentiment &amp; watchlists
            </li>
            <li>
              <span className="login-feature-dot" />
              Gemini-powered journal summaries
            </li>
          </ul>
          <p className="login-disclaimer">
            Prototype only. Not financial advice.
          </p>
        </div>
      </aside>

      <div className="login-main">
        <div className="login-card">
          <div className="login-card-logo">
            <span className="login-logo-mark">◆</span>
            <span className="login-logo-name">Bullcast</span>
          </div>

          {user ? (
            <div className="login-signedin">
              <p className="login-signedin-label">Signed in as</p>
              <p className="login-signedin-email">{user.email}</p>
              <div className="login-storage-badge">
                <span className="badge-dot badge-dot--green" />
                Storage: Supabase
              </div>
              <button className="btn-primary" onClick={() => navigate("/journal")}>
                Go to Journal
              </button>
            </div>
          ) : (
            <>
              <h1 className="login-card-title">
                {isSignup ? "Create your account" : "Sign in to Bullcast"}
              </h1>
              <p className="login-card-subtitle">
                {isSignup
                  ? "Save and sync your journal securely with Supabase."
                  : "Sync your journal securely with Supabase."}
              </p>

              <div className="login-tabs" role="tablist">
                <button
                  role="tab"
                  aria-selected={!isSignup}
                  className={`login-tab${!isSignup ? " login-tab--active" : ""}`}
                  onClick={() => { setMode("signin"); setError(null); setSuccess(null); }}
                >
                  Sign in
                </button>
                <button
                  role="tab"
                  aria-selected={isSignup}
                  className={`login-tab${isSignup ? " login-tab--active" : ""}`}
                  onClick={() => { setMode("signup"); setError(null); setSuccess(null); }}
                >
                  Create account
                </button>
              </div>

              {success && (
                <div className="login-alert login-alert--success" role="status">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M13.5 4.5L6.5 11.5L3 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {success}
                </div>
              )}

              {error && (
                <div className="login-alert login-alert--error" role="alert">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M8 5v3M8 10.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  {error}
                </div>
              )}

              <form className="login-form" onSubmit={handleSubmit} noValidate>
                <div className="form-field">
                  <label htmlFor="email" className="form-label">Email</label>
                  <input
                    id="email"
                    type="email"
                    className="form-input"
                    placeholder="you@example.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    autoComplete="email"
                    disabled={loading}
                    required
                  />
                </div>

                <div className="form-field">
                  <label htmlFor="password" className="form-label">Password</label>
                  <input
                    id="password"
                    type="password"
                    className="form-input"
                    placeholder={isSignup ? "Min. 6 characters" : "••••••••"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete={isSignup ? "new-password" : "current-password"}
                    disabled={loading}
                    required
                  />
                </div>

                <button type="submit" className="btn-primary" disabled={loading}>
                  {loading
                    ? (isSignup ? "Creating account…" : "Signing in…")
                    : (isSignup ? "Create account" : "Sign in")}
                </button>
              </form>

              <div className="login-divider">
                <span>or</span>
              </div>

              <button className="btn-ghost" onClick={handleLocalDemo} disabled={loading}>
                Continue in local demo mode
              </button>

              <p className="login-footer-toggle">
                {isSignup ? (
                  <>Already have an account?{" "}
                    <button
                      className="link-btn"
                      onClick={() => { setMode("signin"); setError(null); setSuccess(null); }}
                    >Sign in</button>
                  </>
                ) : (
                  <>New here?{" "}
                    <button
                      className="link-btn"
                      onClick={() => { setMode("signup"); setError(null); setSuccess(null); }}
                    >Create account</button>
                  </>
                )}
              </p>
            </>
          )}
        </div>

        <p className="login-legal">
          Prototype only · Not financial advice · No broker integration
        </p>
      </div>
    </div>
  );
}
