"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE_URL } from "@/lib/api";
import { completeSignIn, login, signup } from "@/lib/authApi";

// Shared by every text field in the email/password form below. Used
// to unconditionally strip the focus outline (focus:outline-none)
// with nothing put back in its place — a real keyboard-accessibility
// gap at the single most important funnel step in the app: getting
// signed in at all (2026-08-31 audit). focus-visible (not focus) so a
// mouse click still doesn't show a ring, only real keyboard focus.
const FIELD_CLASS =
  "rounded-lg px-3 py-2.5 text-sm text-[color:var(--wl-text)] placeholder:text-[color:var(--wl-text-secondary)] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--user-accent,var(--wl-accent))]";
const FIELD_STYLE = { background: "var(--wl-bg)", border: "1px solid var(--wl-border)" };

/**
 * The actual sign-in surface — Discord (primary; verifies real league
 * membership for free via owners.discord_user_id) or email/password
 * (Phase 5 of the multi-league migration, for anyone opening a league
 * beyond Discord). Shared by AuthScreen.tsx (the post-intro step of
 * the signed-out front door) and app/(app)/login/page.tsx (the direct
 * link Discord's own OAuth failure redirects to on
 * ?error=not_a_league_member) so both entry points render identically
 * instead of the second one being a bare, unstyled fallback.
 *
 * `onBack` is optional — AuthScreen passes it (there's a real "back"
 * step, the WEEKEND intro); login/page.tsx has nothing to go back to,
 * so it's simply omitted there rather than passing a no-op.
 *
 * `variant` — "signin" (default) is the full card above: Discord or
 * email, either sign in or create an account, landing on the dashboard
 * ("/") either way. "join"/"create" are for a visitor who already
 * stated that intent on EntryChoiceStage.tsx: Discord is skipped
 * entirely (it auto-links onto League #1's existing real-life members
 * via owners.discord_user_id — meaningless for someone starting or
 * joining a brand-new self-serve league) and the form goes straight to
 * account creation, landing on /leagues with that action already
 * expanded (leagues/page.tsx's #join-league / #create-league deep
 * links, the same ones WelcomeBackStage's post-login buttons use).
 */
export function SignInCard({
  onBack,
  variant = "signin",
}: {
  onBack?: () => void;
  variant?: "signin" | "join" | "create";
}) {
  const router = useRouter();
  const isIntentVariant = variant !== "signin";
  const [showEmailForm, setShowEmailForm] = useState(isIntentVariant);
  const [mode, setMode] = useState<"signin" | "signup">(isIntentVariant ? "signup" : "signin");
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
      router.push(variant === "join" ? "/leagues#join-league" : variant === "create" ? "/leagues#create-league" : "/");
      router.refresh();
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
          {variant === "join" ? "Join a League" : variant === "create" ? "Create a League" : "Welcome back"}
        </h1>
        {isIntentVariant && (
          <p className="mt-1 max-w-[16rem] text-xs text-[color:var(--wl-text-secondary)]">
            {variant === "join"
              ? "Create your account, then join with the invite code your commissioner shares."
              : "Create your account, then start your own league in a few taps."}
          </p>
        )}
      </div>

      {!showEmailForm ? (
        <>
          <a
            href={`${API_BASE_URL}/auth/discord/login`}
            target="_blank"
            rel="noopener"
            className="flex items-center justify-center gap-2.5 rounded-full bg-[#5865F2] px-6 py-3.5 text-sm font-semibold text-white transition-transform hover:brightness-110 active:scale-[0.98]"
          >
            <DiscordGlyph className="h-4.5 w-4.5" />
            Continue with Discord
          </a>

          {/* Google Sign-In is fully built (backend routes, GoogleGlyph
              below, get_or_create_user_for_google) but hidden here — no
              real GOOGLE_CLIENT_ID/SECRET are configured yet, so a live
              button would 500 for anyone who clicked it. Re-add this
              block once real credentials are wired into .env/Railway. */}

          <div className="flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1" style={{ background: "var(--wl-border)" }} />
            <span className="text-[10px] font-semibold tracking-widest text-[color:var(--wl-text-secondary)] uppercase">
              or
            </span>
            <span className="h-px flex-1" style={{ background: "var(--wl-border)" }} />
          </div>

          <button
            onClick={() => setShowEmailForm(true)}
            className="rounded-full py-3 text-center text-sm font-medium text-[color:var(--wl-text)] transition-colors"
            style={{ border: "1px solid var(--wl-border)" }}
          >
            Continue with email
          </button>
        </>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {!isIntentVariant && (
            <div className="flex justify-center gap-1 rounded-full p-1 text-xs" style={{ border: "1px solid var(--wl-border)" }}>
              <button
                type="button"
                onClick={() => setMode("signin")}
                className="flex-1 rounded-full py-1.5 font-medium transition-colors"
                style={
                  mode === "signin"
                    ? { background: "var(--user-accent, var(--wl-accent))", color: "#06110a" }
                    : { color: "var(--wl-text-secondary)" }
                }
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => setMode("signup")}
                className="flex-1 rounded-full py-1.5 font-medium transition-colors"
                style={
                  mode === "signup"
                    ? { background: "var(--user-accent, var(--wl-accent))", color: "#06110a" }
                    : { color: "var(--wl-text-secondary)" }
                }
              >
                Create account
              </button>
            </div>
          )}

          {mode === "signup" && (
            <div className="flex flex-col gap-1">
              <label htmlFor="signin-display-name" className="sr-only">
                Display name
              </label>
              <input
                id="signin-display-name"
                name="name"
                type="text"
                required
                autoComplete="name"
                placeholder="Display name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={FIELD_CLASS}
                style={FIELD_STYLE}
              />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label htmlFor="signin-email" className="sr-only">
              Email
            </label>
            <input
              id="signin-email"
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
          <div className="flex flex-col gap-1">
            <label htmlFor="signin-password" className="sr-only">
              Password
            </label>
            <input
              id="signin-password"
              name="password"
              type="password"
              required
              minLength={mode === "signup" ? 8 : undefined}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={FIELD_CLASS}
              style={FIELD_STYLE}
            />
          </div>
          {mode === "signin" && (
            <a
              href="/forgot-password"
              className="-mt-1.5 text-right text-xs text-[color:var(--wl-text-secondary)] transition-colors hover:text-[color:var(--wl-text)]"
            >
              Forgot password?
            </a>
          )}
          {mode === "signup" && (
            <div className="flex flex-col gap-1">
              <label htmlFor="signin-confirm-password" className="sr-only">
                Confirm password
              </label>
              <input
                id="signin-confirm-password"
                name="confirm-password"
                type="password"
                required
                autoComplete="new-password"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={FIELD_CLASS}
                style={FIELD_STYLE}
              />
            </div>
          )}

          {error && <p className="text-center text-xs text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="rounded-full px-6 py-3.5 text-sm font-semibold transition-transform active:scale-[0.98] disabled:opacity-50"
            style={{ background: "var(--user-accent, var(--wl-accent))", color: "#06110a" }}
          >
            {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>

          {!isIntentVariant && (
            <button
              type="button"
              onClick={() => setShowEmailForm(false)}
              className="text-center text-xs text-[color:var(--wl-text-secondary)] transition-colors hover:text-[color:var(--wl-text)]"
            >
              ← Use Discord instead
            </button>
          )}
        </form>
      )}

      {(!showEmailForm || isIntentVariant) && onBack && (
        <button
          onClick={onBack}
          className="text-center text-xs text-[color:var(--wl-text-secondary)] transition-colors hover:text-[color:var(--wl-text)]"
        >
          ← Back
        </button>
      )}
    </div>
  );
}

function DiscordGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M20.317 4.369A19.79 19.79 0 0 0 15.885 3c-.19.34-.412.8-.567 1.164a18.27 18.27 0 0 0-5.636 0A11.5 11.5 0 0 0 9.115 3a19.74 19.74 0 0 0-4.435 1.372C1.578 8.727.865 12.98 1.221 17.174a19.9 19.9 0 0 0 5.993 3.03c.483-.66.913-1.36 1.284-2.098a12.9 12.9 0 0 1-2.023-.973c.17-.124.336-.253.497-.386 3.898 1.793 8.126 1.793 11.977 0 .163.133.329.262.497.386-.645.386-1.322.71-2.026.974.371.737.8 1.437 1.284 2.097a19.86 19.86 0 0 0 6-3.03c.417-4.865-.708-9.079-2.987-12.805ZM8.68 14.611c-1.17 0-2.13-1.066-2.13-2.373 0-1.308.941-2.374 2.13-2.374 1.199 0 2.15 1.076 2.13 2.374 0 1.307-.94 2.373-2.13 2.373Zm6.64 0c-1.17 0-2.13-1.066-2.13-2.373 0-1.308.94-2.374 2.13-2.374 1.199 0 2.15 1.076 2.13 2.374 0 1.307-.93 2.373-2.13 2.373Z" />
    </svg>
  );
}

// Google's standard multi-color "G" mark — kept full brand color per
// Google's own Sign in with Google branding guidelines (only the
// button surface around it is themed to match this card).
function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C12.955 4 4 12.955 4 24s8.955 20 20 20s20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C39.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}
