import { useEffect, useState } from "react";
import AuthModal from "./AuthModal";
import {
  getCurrentSupabaseSession,
  isSupabasePersistenceConfigured,
  onSupabaseAuthStateChange,
  signOutSupabase,
} from "../services/supabaseStorage";

function AuthBadge({ tone = "local", children }) {
  const colors = tone === "supabase"
    ? "border-green-400/25 bg-green-400/10 text-green-300"
    : "border-amber-300/25 bg-amber-300/10 text-amber-300";

  return (
    <span className={`whitespace-nowrap rounded border px-2.5 py-1 font-mono text-[0.62rem] uppercase tracking-wider ${colors}`}>
      {children}
    </span>
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
    } catch {
      setMessage("Supabase unavailable. You can keep using local demo mode.");
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
        <AuthBadge tone="supabase">Storage: Supabase</AuthBadge>
        <span
          className="max-w-[190px] truncate rounded border border-white/10 bg-white/5 px-2.5 py-1 text-[0.68rem] lowercase text-neutral"
          title={session.user.email || ""}
        >
          {session.user.email}
        </span>
        <button
          type="button"
          onClick={signOut}
          disabled={busy}
          className="whitespace-nowrap rounded border border-primary/20 px-3 py-1.5 text-[0.62rem] uppercase tracking-wider text-primary transition-colors hover:border-primary/50 hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
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
        className="whitespace-nowrap rounded bg-primary px-3.5 py-1.5 font-mono text-[0.62rem] font-bold uppercase tracking-wider text-background transition hover:bg-primary/90"
      >
        Sign in
      </button>
      {modalOpen ? <AuthModal onClose={() => setModalOpen(false)} /> : null}
    </div>
  );
}
