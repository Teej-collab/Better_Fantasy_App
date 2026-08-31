"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE_URL } from "@/lib/api";
import { completeSignIn, login, signup } from "@/lib/authApi";

/**
 * Discord stays the primary path (it verifies real league membership
 * for free — owners.discord_user_id — a property email/password never
 * gives). Email/password is a second, independent way to get a real
 * Weekend account (Phase 5 of the multi-league migration — see backend
 * TODO.md's PHASE 9 entry), for anyone opening a league beyond Discord.
 * Unlike Discord (one screen handles both first-time and returning
 * members), email/password genuinely needs a Sign in/Create account
 * toggle — a first-time visitor needs a display name and a password
 * confirmation Discord never asked for.
 */
export function AuthScreen({ onBack }: { onBack: () => void }) {
  const router = useRouter();
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "signup" && password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }

    setBusy(true);
    try {
      const { token } = mode === "signup" ? await signup(email, password, displayName) : await login(email, password);
      await completeSignIn(token);
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wl-gate flex items-center justify-center px-6">
      <div className="wl-ambient wl-ambient--lit" aria-hidden />

      <div className="wl-auth-enter relative z-10 flex w-full max-w-sm flex-col gap-6 rounded-2xl border border-white/10 bg-white/[0.04] p-8 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="text-xs font-semibold tracking-[0.25em] text-[color:var(--wl-text-secondary)] uppercase">
            Weekend League
          </span>
          <h1 className="text-2xl font-semibold text-[color:var(--wl-text)]">Welcome back.</h1>
        </div>

        {!showEmailForm ? (
          <>
            <p className="text-center text-sm text-[color:var(--wl-text-secondary)]">
              Sign in with Discord — if you&apos;re already a member of the league, you&apos;re in.
            </p>

            <a
              href={`${API_BASE_URL}/auth/discord/login`}
              target="_blank"
              rel="noopener"
              className="flex items-center justify-center gap-2 rounded-full bg-[#5865F2] px-6 py-3 text-sm font-semibold text-white transition-transform hover:brightness-110 active:scale-95"
            >
              Enter the League →
            </a>

            <button
              onClick={() => setShowEmailForm(true)}
              className="text-center text-xs text-[color:var(--wl-text-secondary)] transition-colors hover:text-[color:var(--wl-text)]"
            >
              Or continue with email
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex justify-center gap-1 rounded-full border border-white/10 p-1 text-xs">
              <button
                type="button"
                onClick={() => setMode("signin")}
                className={`flex-1 rounded-full py-1.5 font-medium transition-colors ${
                  mode === "signin" ? "bg-white/10 text-[color:var(--wl-text)]" : "text-[color:var(--wl-text-secondary)]"
                }`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => setMode("signup")}
                className={`flex-1 rounded-full py-1.5 font-medium transition-colors ${
                  mode === "signup" ? "bg-white/10 text-[color:var(--wl-text)]" : "text-[color:var(--wl-text-secondary)]"
                }`}
              >
                Create account
              </button>
            </div>

            {mode === "signup" && (
              <input
                type="text"
                required
                placeholder="Display name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-[color:var(--wl-text)] placeholder:text-[color:var(--wl-text-secondary)] focus:outline-none focus:border-white/30"
              />
            )}
            <input
              type="email"
              required
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-[color:var(--wl-text)] placeholder:text-[color:var(--wl-text-secondary)] focus:outline-none focus:border-white/30"
            />
            <input
              type="password"
              required
              minLength={mode === "signup" ? 8 : undefined}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-[color:var(--wl-text)] placeholder:text-[color:var(--wl-text-secondary)] focus:outline-none focus:border-white/30"
            />
            {mode === "signup" && (
              <input
                type="password"
                required
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-[color:var(--wl-text)] placeholder:text-[color:var(--wl-text-secondary)] focus:outline-none focus:border-white/30"
              />
            )}

            {error && <p className="text-center text-xs text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-white/90 px-6 py-3 text-sm font-semibold text-black transition-transform hover:brightness-95 active:scale-95 disabled:opacity-50"
            >
              {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
            </button>

            <button
              type="button"
              onClick={() => setShowEmailForm(false)}
              className="text-center text-xs text-[color:var(--wl-text-secondary)] transition-colors hover:text-[color:var(--wl-text)]"
            >
              ← Use Discord instead
            </button>
          </form>
        )}

        {!showEmailForm && (
          <button
            onClick={onBack}
            className="text-center text-xs text-[color:var(--wl-text-secondary)] transition-colors hover:text-[color:var(--wl-text)]"
          >
            ← Back
          </button>
        )}
      </div>
    </div>
  );
}
