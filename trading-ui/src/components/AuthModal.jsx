import { useEffect, useState } from "react";
import { signInWithEmail, signUpWithEmail } from "../services/supabaseStorage";

function friendlyAuthMessage(error) {
  const message = String(error?.message || error || "").toLowerCase();

  if (message.includes("invalid login")) return "Invalid login credentials.";
  if (message.includes("email not confirmed")) return "Email not confirmed. Check your inbox and confirm your account.";
  if (message.includes("password") && (message.includes("6") || message.includes("six"))) {
    return "Password must be at least 6 characters.";
  }
  if (message.includes("supabase") || message.includes("fetch") || message.includes("network")) {
    return "Supabase unavailable. Continue in local demo mode or try again shortly.";
  }

  return "Authentication failed. Check your email and password, then try again.";
}

export default function AuthModal({ onClose }) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("neutral");

  const isSignup = mode === "signup";

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const resetFeedback = () => {
    setMessage("");
    setMessageTone("neutral");
  };

  const switchMode = (nextMode) => {
    setMode(nextMode);
    resetFeedback();
  };

  const submit = async (event) => {
    event.preventDefault();
    const trimmedEmail = email.trim();

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
      onClose();
    } catch (error) {
      setMessage(friendlyAuthMessage(error));
      setMessageTone("error");
    } finally {
      setBusy(false);
    }
  };

  const feedbackStyle = messageTone === "success"
    ? "border-green-400/25 bg-green-400/10 text-green-300"
    : messageTone === "error"
      ? "border-red-400/25 bg-red-400/10 text-red-300"
      : "border-white/10 bg-white/5 text-neutral";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4 py-6 backdrop-blur-md"
      onMouseDown={onClose}
      role="presentation"
    >
      <section
        className="relative max-h-[92vh] w-full max-w-[420px] overflow-y-auto rounded-lg border border-white/10 bg-[#08080d] p-6 shadow-2xl shadow-black/60"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close auth modal"
          className="absolute right-4 top-4 rounded border border-white/10 px-2 py-1 font-mono text-xs text-neutral transition hover:border-white/25 hover:text-white"
        >
          Close
        </button>

        <div className="mb-6 pr-16">
          <p className="mb-2 font-mono text-[0.62rem] uppercase tracking-[0.24em] text-primary">
            Bullcast
          </p>
          <h2 className="font-display text-3xl leading-none tracking-wide text-white" id="auth-modal-title">
            Sign in to Bullcast
          </h2>
          <p className="mt-3 font-mono text-xs leading-5 text-neutral">
            Sync your journal securely with Supabase, or continue in local demo mode.
          </p>
        </div>

        <div className="mb-5 grid grid-cols-2 rounded-md border border-white/10 bg-black/30 p-1 font-mono text-xs uppercase tracking-wider">
          <button
            type="button"
            onClick={() => switchMode("signin")}
            className={`rounded px-3 py-2 transition ${!isSignup ? "bg-primary text-background" : "text-neutral hover:text-white"}`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => switchMode("signup")}
            className={`rounded px-3 py-2 transition ${isSignup ? "bg-primary text-background" : "text-neutral hover:text-white"}`}
          >
            Create account
          </button>
        </div>

        <form className="grid gap-4" onSubmit={submit}>
          <label className="grid gap-2 font-mono text-xs uppercase tracking-wider text-neutral">
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              className="w-full rounded-md border border-white/10 bg-[#050508] px-3 py-3 text-sm normal-case tracking-normal text-white outline-none transition placeholder:text-neutral/45 focus:border-primary focus:ring-1 focus:ring-primary/40"
            />
          </label>

          <label className="grid gap-2 font-mono text-xs uppercase tracking-wider text-neutral">
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={isSignup ? "new-password" : "current-password"}
              placeholder="Password"
              className="w-full rounded-md border border-white/10 bg-[#050508] px-3 py-3 text-sm normal-case tracking-normal text-white outline-none transition placeholder:text-neutral/45 focus:border-primary focus:ring-1 focus:ring-primary/40"
            />
          </label>

          {message ? (
            <div className={`rounded-md border px-3 py-3 font-mono text-xs leading-5 ${feedbackStyle}`}>
              {message}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="mt-1 w-full rounded-md bg-primary px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider text-background transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Working..." : isSignup ? "Create account" : "Sign in"}
          </button>

          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="w-full rounded-md border border-white/10 px-4 py-3 font-mono text-xs uppercase tracking-wider text-neutral transition hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Continue in local demo mode
          </button>
        </form>

        <div className="mt-5 rounded-md border border-amber-300/15 bg-amber-300/5 px-3 py-3 font-mono text-[0.68rem] leading-5 text-amber-200/90">
          Local demo data stays in this browser. Sign in to enable cloud sync.
        </div>

        <div className="mt-5 text-center font-mono text-xs text-neutral">
          {isSignup ? "Already have an account?" : "New here?"}{" "}
          <button
            type="button"
            onClick={() => switchMode(isSignup ? "signin" : "signup")}
            className="text-primary transition hover:text-primary/80"
          >
            {isSignup ? "Sign in" : "Create account"}
          </button>
        </div>
      </section>
    </div>
  );
}
