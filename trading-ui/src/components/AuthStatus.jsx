import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getCurrentSupabaseSession,
  isSupabasePersistenceConfigured,
  onSupabaseAuthStateChange,
  signOutSupabase,
} from "../services/supabaseStorage";
import "./AuthStatus.css";

function StorageBadge({ mode }) {
  const isSynced = mode === "supabase";

  return (
    <span
      className={`auth-storage-badge ${isSynced ? "auth-storage-badge--synced" : "auth-storage-badge--local"}`}
    >
      <span className={`auth-dot ${isSynced ? "auth-dot--green" : "auth-dot--amber"}`} />
      {isSynced ? "Storage: Supabase" : "Local demo mode"}
    </span>
  );
}

export default function AuthStatus() {
  const navigate = useNavigate();
  const configured = isSupabasePersistenceConfigured();
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(!configured);
  const [busy, setBusy] = useState(false);

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

  const handleSignOut = async () => {
    setBusy(true);
    try {
      await signOutSupabase();
      setSession(null);
    } finally {
      setBusy(false);
    }
  };

  if (!authReady) {
    return (
      <div className="auth-status" aria-live="polite">
        <StorageBadge mode="local" />
      </div>
    );
  }

  if (session?.user) {
    return (
      <div className="auth-status">
        <StorageBadge mode="supabase" />
        <span className="auth-email" title={session.user.email || ""}>
          {session.user.email || "Signed in"}
        </span>
        <button
          type="button"
          className="auth-btn auth-btn--signout"
          onClick={handleSignOut}
          disabled={busy}
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="auth-status">
      <StorageBadge mode="local" />
      <button
        type="button"
        className="auth-btn auth-btn--signin"
        onClick={() => navigate("/login")}
      >
        Sign in
      </button>
    </div>
  );
}
