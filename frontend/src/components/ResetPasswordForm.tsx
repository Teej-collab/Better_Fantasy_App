"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { resetPassword } from "@/lib/authApi";

const FIELD_CLASS =
  "rounded-lg px-3 py-2.5 text-sm text-[color:var(--wl-text)] placeholder:text-[color:var(--wl-text-secondary)] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--user-accent,var(--wl-accent))]";
const FIELD_STYLE = { background: "var(--wl-bg)", border: "1px solid var(--wl-border)" };

// `token` comes from the page's own server-rendered searchParams (the
// link in the reset email) rather than a client-side useSearchParams()
// read — same reasoning app/(app)/login/page.tsx's own ?error= handling
// already uses this shape for.
export function ResetPasswordForm({ token }: { token: string | undefined }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    if (!token) {
      setError("This reset link is missing its token — request a new one.");
      return;
    }
    setBusy(true);
    try {
      await resetPassword(token, password);
      setDone(true);
      setTimeout(() => router.push("/login"), 2000);
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
          Choose a new password
        </h1>
      </div>

      {done ? (
        <p className="text-center text-sm text-[color:var(--wl-text-secondary)]">
          Password updated — signing you back in to sign in with it now…
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="reset-password" className="sr-only">
              New password
            </label>
            <input
              id="reset-password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={FIELD_CLASS}
              style={FIELD_STYLE}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="reset-confirm-password" className="sr-only">
              Confirm new password
            </label>
            <input
              id="reset-confirm-password"
              name="confirm-password"
              type="password"
              required
              autoComplete="new-password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
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
            {busy ? "…" : "Update password"}
          </button>
        </form>
      )}
    </div>
  );
}
