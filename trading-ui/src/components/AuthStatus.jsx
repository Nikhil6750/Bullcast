import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getCurrentSupabaseSession,
  getSupabaseConfigStatus,
  onSupabaseAuthStateChange,
  signOutSupabase,
} from "../services/supabaseStorage";
import { clearLocalDemoMode } from "../services/entryState";
import "./AuthStatus.css";

export default function AuthStatus({ user: userProp = null, onSignOut }) {
  const navigate = useNavigate();
  const [configStatus] = useState(() => getSupabaseConfigStatus());
  const [sessionUser, setSessionUser] = useState(userProp);
  const [signingOut, setSigningOut] = useState(false);
  const user = userProp || sessionUser;

  useEffect(() => {
    setSessionUser(userProp);
  }, [userProp]);

  useEffect(() => {
    if (!configStatus.supabaseConfigured) return undefined;

    let active = true;
    getCurrentSupabaseSession().then((session) => {
      if (!active) return;
      setSessionUser(session?.user ?? null);
    });

    const unsubscribe = onSupabaseAuthStateChange((_event, session) => {
      setSessionUser(session?.user ?? null);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [configStatus.supabaseConfigured]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      if (onSignOut) {
        await onSignOut();
      } else {
        await signOutSupabase();
      }
      clearLocalDemoMode();
      setSessionUser(null);
      navigate("/login");
    } finally {
      setSigningOut(false);
    }
  }

  if (user) {
    return (
      <div className="auth-status">
        <div className="auth-storage-badge auth-storage-badge--synced">
          <span className="auth-dot auth-dot--green" />
          Storage: Supabase
        </div>
        <span className="auth-email" title={user.email}>
          {user.email}
        </span>
        <button
          className="auth-btn auth-btn--signout"
          onClick={handleSignOut}
          disabled={signingOut}
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="auth-status">
      <div className="auth-storage-badge auth-storage-badge--local">
        <span className="auth-dot auth-dot--amber" />
        Local demo mode
      </div>
      <button
        className="auth-btn auth-btn--signin"
        onClick={() => navigate("/login")}
      >
        Sign in
      </button>
    </div>
  );
}
