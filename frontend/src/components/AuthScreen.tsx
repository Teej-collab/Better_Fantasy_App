"use client";

import { API_BASE_URL } from "@/lib/api";

/**
 * The brief this was built from describes an email/password form plus
 * "Continue with Apple"/"Continue with Google" — none of that exists in
 * this app. The only real auth provider is Discord OAuth, chosen
 * earlier specifically because it verifies real league membership
 * (owners.discord_user_id) — a security property email/password or a
 * generic social login wouldn't give for free. So this is one screen,
 * not a separate sign-in/create-account pair: Discord already handles
 * both (a first-time real member is recognized the same as a returning
 * one), there's no separate account-creation step to build.
 */
export function AuthScreen({ onBack }: { onBack: () => void }) {
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

        <p className="text-center text-sm text-[color:var(--wl-text-secondary)]">
          Sign in with Discord — if you&apos;re already a member of the league, you&apos;re in.
        </p>

        <a
          href={`${API_BASE_URL}/auth/discord/login`}
          className="flex items-center justify-center gap-2 rounded-full bg-[#5865F2] px-6 py-3 text-sm font-semibold text-white transition-transform hover:brightness-110 active:scale-95"
        >
          Enter the League →
        </a>

        <button
          onClick={onBack}
          className="text-center text-xs text-[color:var(--wl-text-secondary)] transition-colors hover:text-[color:var(--wl-text)]"
        >
          ← Back
        </button>
      </div>
    </div>
  );
}
