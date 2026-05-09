import "./StorageStatus.css";

export default function StorageStatus({ mode = "local", email, onSignIn }) {
  if (mode === "supabase") {
    return (
      <div className="storage-status storage-status--supabase">
        <span className="storage-dot storage-dot--green" />
        <span className="storage-label">Storage: Supabase</span>
        {email ? <span className="storage-email">{email}</span> : null}
      </div>
    );
  }

  if (mode === "fallback") {
    return (
      <div className="storage-status storage-status--fallback">
        <span className="storage-dot storage-dot--amber" />
        <span className="storage-label">Local fallback</span>
        <span className="storage-note">Supabase unavailable - data saved locally</span>
      </div>
    );
  }

  return (
    <div className="storage-status storage-status--local">
      <span className="storage-dot storage-dot--amber" />
      <span className="storage-label">Local demo mode</span>
      {onSignIn ? (
        <button type="button" className="storage-signin-btn" onClick={onSignIn}>
          Sign in to sync
        </button>
      ) : null}
    </div>
  );
}
