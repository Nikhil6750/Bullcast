import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  getSupabaseConfigStatus,
  getCurrentSupabaseSession,
  onSupabaseAuthStateChange,
  signInWithEmail,
  signUpWithEmail,
} from "../services/supabaseStorage";
import "./Login.css";

function friendlyAuthMessage(error) {
  const message = String(error?.message || error || "").toLowerCase();

  if (message.includes("invalid login")) return "Invalid login credentials.";
  if (message.includes("email not confirmed")) {
    return "Email not confirmed. Check your inbox and confirm your account.";
  }
  if (message.includes("password") && (message.includes("6") || message.includes("six"))) {
    return "Password must be at least 6 characters.";
  }
  if (message.includes("supabase") || message.includes("fetch") || message.includes("network")) {
    return "Supabase unavailable. Continue in local demo mode or try again shortly.";
  }

  return "Authentication failed. Check your email and password, then try again.";
}

export default function Login() {
  const navigate = useNavigate();
  const [configStatus] = useState(() => getSupabaseConfigStatus());
  const configured = configStatus.supabaseConfigured;
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(!configured);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("neutral");

  const isSignup = mode === "signup";

  useEffect(() => {
    if (!configured) return undefined;

    let active = true;
    getCurrentSupabaseSession().then((currentSession) => {
      if (!active) return;
      setSession(currentSession);
      setAuthReady(true);
    });

    const unsubscribe = onSupabaseAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [configured]);

  const resetFeedback = () => {
    setMessage("");
    setMessageTone("neutral");
  };

  const switchMode = (nextMode) => {
    setMode(nextMode);
    resetFeedback();
  };

  const continueLocal = () => {
    navigate("/journal");
  };

  const submit = async (event) => {
    event.preventDefault();
    const trimmedEmail = email.trim();

    if (!configured) {
      setMessage("Supabase unavailable. Continue in local demo mode or configure Supabase.");
      setMessageTone("error");
      return;
    }

    if (!trimmedEmail || !password) {
      setMessage("Email and password are required.");
      setMessageTone("error");
      return;
    }

    if (password.length < 6) {
      setMessage("Password must be at least 6 characters.");
      setMessageTone("error");
      return;
    }

    setBusy(true);
    resetFeedback();

    try {
      if (isSignup) {
        await signUpWithEmail(trimmedEmail, password);
        setPassword("");
        setMessage("Account created. Check your email to confirm your account.");
        setMessageTone("success");
        return;
      }

      await signInWithEmail(trimmedEmail, password);
      setPassword("");
      navigate("/journal", { replace: true });
    } catch (error) {
      setMessage(friendlyAuthMessage(error));
      setMessageTone("error");
    } finally {
      setBusy(false);
    }
  };

  if (session?.user) {
    return (
      <main className="login-root">
        <section className="login-sidebar" aria-label="Bullcast">
          <Link to="/" className="login-brand">
            <span className="login-brand-mark">B</span>
            <span>BULLCAST</span>
          </Link>
          <div className="login-copy">
            <p className="login-kicker">Journal sync</p>
            <h1>Signed in and ready to sync.</h1>
            <p>Your journal can now load and save through Supabase under your account.</p>
          </div>
        </section>

        <section className="login-main">
          <div className="login-card login-card--signed-in">
            <div className="login-status-dot" aria-hidden="true" />
            <h2>Signed in</h2>
            <p className="login-signed-email">{session.user.email}</p>
            <button type="button" className="login-primary-btn" onClick={() => navigate("/journal")}>
              Go to Journal
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="login-root">
      <section className="login-sidebar" aria-label="Bullcast">
        <Link to="/" className="login-brand">
          <span className="login-brand-mark">B</span>
          <span>BULLCAST</span>
        </Link>

        <div className="login-copy">
          <p className="login-kicker">Trading journal</p>
          <h1>Sign in to Bullcast</h1>
          <p>Sync your journal securely with Supabase, or continue in local demo mode.</p>
        </div>

        <div className="login-local-note">
          Local demo data stays in this browser. Sign in to enable cloud sync.
        </div>
      </section>

      <section className="login-main">
        <div className="login-card">
          <div className="login-card-header">
            <p className="login-eyebrow">Supabase Auth</p>
            <h2>{isSignup ? "Create account" : "Welcome back"}</h2>
            <p>{isSignup ? "Create an account to sync journal data." : "Use your email and password to continue."}</p>
          </div>

          <div className="login-tabs" role="tablist" aria-label="Auth mode">
            <button
              type="button"
              className={!isSignup ? "login-tab login-tab--active" : "login-tab"}
              onClick={() => switchMode("signin")}
            >
              Sign in
            </button>
            <button
              type="button"
              className={isSignup ? "login-tab login-tab--active" : "login-tab"}
              onClick={() => switchMode("signup")}
            >
              Create account
            </button>
          </div>

          <form className="login-form" onSubmit={submit}>
            <label className="login-field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
              />
            </label>

            <label className="login-field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={isSignup ? "new-password" : "current-password"}
                placeholder="Password"
              />
            </label>

            {message ? (
              <div className={`login-alert login-alert--${messageTone}`} role="status">
                {message}
              </div>
            ) : null}

            {!configured ? (
              <div className="login-alert login-alert--error" role="status">
                Supabase unavailable. Continue in local demo mode until frontend Supabase env vars are configured.
                <div className="login-config-diagnostics">
                  hasSupabaseUrl: {String(configStatus.hasSupabaseUrl)}
                  {" | "}hasSupabaseAnonKey: {String(configStatus.hasSupabaseAnonKey)}
                  {" | "}supabaseConfigured: {String(configStatus.supabaseConfigured)}
                </div>
              </div>
            ) : null}

            <button type="submit" className="login-primary-btn" disabled={busy || !authReady}>
              {busy ? "Working..." : isSignup ? "Create account" : "Sign in"}
            </button>

            <button type="button" className="login-secondary-btn" onClick={continueLocal} disabled={busy}>
              Continue in local demo mode
            </button>
          </form>

          <div className="login-footer-toggle">
            {isSignup ? "Already have an account?" : "New here?"}{" "}
            <button type="button" onClick={() => switchMode(isSignup ? "signin" : "signup")}>
              {isSignup ? "Sign in" : "Create account"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
