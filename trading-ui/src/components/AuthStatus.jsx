import { useEffect, useState } from "react";
import {
  getCurrentSupabaseSession,
  isSupabasePersistenceConfigured,
  onSupabaseAuthStateChange,
  signInWithEmail,
  signOutSupabase,
  signUpWithEmail,
} from "../services/supabaseStorage";

function AuthBadge({ tone = "local", children }) {
  const colors = tone === "supabase"
    ? "border-green-400/25 bg-green-400/10 text-green-300"
    : "border-amber-300/25 bg-amber-300/10 text-amber-300";

  return (
    <span className={`rounded border px-2 py-1 font-mono text-[0.62rem] uppercase tracking-wider ${colors}`}>
      {children}
    </span>
  );
}

function AuthModal({ onClose }) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("neutral");

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setMessage("");
    setMessageTone("neutral");
  };

  const submit = async (event) => {
    event.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setMessage("Email and password are required.");
      setMessageTone("error");
      return;
    }

    setBusy(true);
    setMessage("");
    setMessageTone("neutral");
    try {
      if (mode === "signup") {
        await signUpWithEmail(trimmedEmail, password);
        setPassword("");
        setMessage("Check your email to confirm your account.");
        setMessageTone("success");
        return;
      }

      await signInWithEmail(trimmedEmail, password);
      setPassword("");
      onClose();
    } catch (error) {
      setMessage(error?.message || "Authentication failed.");
      setMessageTone("error");
    } finally {
      setBusy(false);
    }
  };

  const messageColor = messageTone === "success"
    ? "border-green-400/20 bg-green-400/10 text-green-300"
    : messageTone === "error"
      ? "border-red-400/20 bg-red-400/10 text-red-300"
      : "border-white/10 bg-white/5 text-neutral";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded border border-primary/15 bg-[#09090f] p-5 shadow-2xl shadow-black/50"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="font-display text-2xl tracking-wider text-white" id="auth-modal-title">
              Bullcast Auth
            </div>
            <p className="mt-1 font-mono text-xs leading-5 text-neutral">
              Sign in to sync journal data to Supabase. Local demo mode stays in this browser.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-white/10 px-2 py-1 font-mono text-xs text-neutral transition hover:border-white/25 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="mb-4 grid grid-cols-2 rounded border border-white/10 bg-black/25 p-1 font-mono text-xs uppercase tracking-wider">
          <button
            type="button"
            onClick={() => switchMode("signin")}
            className={`rounded px-3 py-2 transition ${mode === "signin" ? "bg-primary text-background" : "text-neutral hover:text-white"}`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => switchMode("signup")}
            className={`rounded px-3 py-2 transition ${mode === "signup" ? "bg-primary text-background" : "text-neutral hover:text-white"}`}
          >
            Create account
          </button>
        </div>

        <form className="grid gap-3" onSubmit={submit}>
          <label className="grid gap-1 font-mono text-xs text-neutral">
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              className="rounded border border-border bg-background px-3 py-2 text-sm normal-case text-white outline-none transition focus:border-primary"
              placeholder="you@example.com"
            />
          </label>
          <label className="grid gap-1 font-mono text-xs text-neutral">
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              className="rounded border border-border bg-background px-3 py-2 text-sm text-white outline-none transition focus:border-primary"
              placeholder="Password"
            />
          </label>

          {message ? (
            <div className={`rounded border px-3 py-2 font-mono text-xs leading-5 ${messageColor}`}>
              {message}
            </div>
          ) : null}

          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
            <button
              type="submit"
              disabled={busy}
              className="rounded bg-primary px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-background transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Working..." : mode === "signup" ? "Create account" : "Sign in"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded border border-white/10 px-4 py-2 font-mono text-xs uppercase tracking-wider text-neutral transition hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue in local demo mode
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AuthStatus() {
  const configured = isSupabasePersistenceConfigured();
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(!configured);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

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
      setMessage("");
      if (nextSession?.user) setModalOpen(false);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [configured]);

  const signOut = async () => {
    setBusy(true);
    setMessage("");
    try {
      await signOutSupabase();
    } catch (error) {
      setMessage(error?.message || "Sign out failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!configured) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <AuthBadge>Local demo mode</AuthBadge>
        <span className="font-mono text-[0.58rem] uppercase tracking-wider text-neutral">
          Supabase env missing
        </span>
      </div>
    );
  }

  if (!authReady) {
    return (
      <div className="font-mono text-[0.62rem] uppercase tracking-wider text-neutral">
        Checking auth...
      </div>
    );
  }

  if (session?.user) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2 font-mono">
        <span className="max-w-[180px] truncate text-[0.68rem] lowercase text-neutral" title={session.user.email || ""}>
          {session.user.email}
        </span>
        <AuthBadge tone="supabase">Storage: Supabase</AuthBadge>
        <button
          type="button"
          onClick={signOut}
          disabled={busy}
          className="rounded border border-primary/20 px-3 py-1.5 text-[0.62rem] uppercase tracking-wider text-primary transition-colors hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Sign out
        </button>
        {message ? (
          <span className="basis-full text-right text-[0.58rem] normal-case tracking-normal text-amber-300">
            {message}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <AuthBadge>Local demo mode</AuthBadge>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="rounded border border-primary/25 px-3 py-1.5 font-mono text-[0.62rem] uppercase tracking-wider text-primary transition-colors hover:border-primary/60 hover:bg-primary/10"
      >
        Sign in
      </button>
      {modalOpen ? <AuthModal onClose={() => setModalOpen(false)} /> : null}
    </div>
  );
}
