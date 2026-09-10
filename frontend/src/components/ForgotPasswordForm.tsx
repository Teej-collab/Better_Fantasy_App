"use client";

import { useState } from "react";
import { forgotPassword } from "@/lib/authApi";

const FIELD_CLASS =
  "rounded-lg px-3 py-2.5 text-sm text-[color:var(--wl-text)] placeholder:text-[color:var(--wl-text-secondary)] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--user-accent,var(--wl-accent))]";
const FIELD_STYLE = { background: "var(--wl-bg)", border: "1px solid var(--wl-border)" };

// POST /auth/forgot-password always returns the same shape of message
// whether or not the account exists (or, for a Discord/Google-only
// account, a distinct-but-honest one) — this form just displays
// whatever that response says, never its own guess.
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { message } = await forgotPassword(email);
      setMessage(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="wl-auth-enter relative z-10 flex w-full max-w-sm flex-col gap-6 rounded-2xl p-8"
      style={{ background: "var(--wl-surface)", border: "1px solid var(--wl-border)" }}
    >
      <div className="flex flex-col items-center gap-1 text-center">
        <span className="text-xs font-semibold tracking-[0.25em] text-[color:var(--wl-text-secondary)] uppercase">
          Weekend League
        </span>
        <h1 className="font-display text-2xl font-semibold tracking-wide text-[color:var(--wl-text)] uppercase">
          Reset password
        </h1>
      </div>

      {message ? (
        <p className="text-center text-sm text-[color:var(--wl-text-secondary)]">{message}</p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <p className="text-center text-sm text-[color:var(--wl-text-secondary)]">
            Enter the email on your account and we&apos;ll send a link to reset your password.
          </p>
          <div className="flex flex-col gap-1">
            <label htmlFor="forgot-email" className="sr-only">
              Email
            </label>
            <input
              id="forgot-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={FIELD_CLASS}
              style={FIELD_STYLE}
            />
          </div>

          {error && <p className="text-center text-xs text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="rounded-full px-6 py-3.5 text-sm font-semibold transition-transform active:scale-[0.98] disabled:opacity-50"
            style={{ background: "var(--user-accent, var(--wl-accent))", color: "#06110a" }}
          >
            {busy ? "…" : "Send reset link"}
          </button>
        </form>
      )}

      <a
        href="/login"
        className="text-center text-xs text-[color:var(--wl-text-secondary)] transition-colors hover:text-[color:var(--wl-text)]"
      >
        ← Back to sign in
      </a>
    </div>
  );
}
