import { useEffect, useState } from "react";
import {
  getCurrentSupabaseSession,
  isSupabasePersistenceConfigured,
  onSupabaseAuthStateChange,
  signInWithEmail,
  signOutSupabase,
  signUpWithEmail,
} from "../services/supabaseStorage";

export default function AuthStatus() {
  const configured = isSupabasePersistenceConfigured();
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(!configured);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [configured]);

  const submitAuth = async (mode) => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setMessage("Email and password are required.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const result = mode === "signup"
        ? await signUpWithEmail(trimmedEmail, password)
        : await signInWithEmail(trimmedEmail, password);

      if (mode === "signup" && !result?.session) {
        setMessage("Check email to confirm sign-up before cloud sync.");
      } else {
        setPassword("");
      }
    } catch (error) {
      setMessage(error?.message || "Authentication failed.");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    setMessage("");
    try {
      await signOutSupabase();
      setPassword("");
    } catch (error) {
      setMessage(error?.message || "Sign out failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!configured) {
    return (
      <div className="flex flex-col items-end font-mono text-[0.62rem] uppercase tracking-wider text-amber-300">
        <span>Local demo mode</span>
        <span className="text-[0.55rem] text-neutral">Supabase env missing</span>
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
      <div className="flex items-center gap-3 font-mono text-[0.62rem] uppercase tracking-wider">
        <div className="flex flex-col items-end leading-tight">
          <span className="text-green-300">Storage: Supabase</span>
          <span className="max-w-[170px] truncate text-[0.55rem] lowercase text-neutral" title={session.user.email || ""}>
            {session.user.email}
          </span>
        </div>
        <button
          type="button"
          onClick={signOut}
          disabled={busy}
          className="rounded border border-primary/20 px-2 py-1 text-primary transition-colors hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 font-mono text-[0.62rem] uppercase tracking-wider">
      <div className="hidden flex-col items-end leading-tight xl:flex">
        <span className="text-amber-300">Local demo mode</span>
        <span className="text-[0.55rem] text-neutral">Sign in for cloud sync</span>
      </div>
      <input
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="email"
        className="w-36 rounded border border-border bg-background px-2 py-1 text-[0.65rem] normal-case text-white outline-none focus:border-primary"
      />
      <input
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="password"
        className="w-28 rounded border border-border bg-background px-2 py-1 text-[0.65rem] normal-case text-white outline-none focus:border-primary"
      />
      <button
        type="button"
        onClick={() => submitAuth("signin")}
        disabled={busy}
        className="rounded border border-primary/20 px-2 py-1 text-primary transition-colors hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Sign in
      </button>
      <button
        type="button"
        onClick={() => submitAuth("signup")}
        disabled={busy}
        className="rounded border border-white/10 px-2 py-1 text-neutral transition-colors hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        Sign up
      </button>
      {message ? (
        <span className="max-w-[180px] truncate text-[0.55rem] normal-case tracking-normal text-amber-300" title={message}>
          {message}
        </span>
      ) : null}
    </div>
  );
}
