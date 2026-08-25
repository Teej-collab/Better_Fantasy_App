"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Anton, Satisfy } from "next/font/google";
import { LeagueWordmark } from "@/components/LeagueWordmark";
import { WelcomeBackStage } from "@/components/WelcomeBackStage";
import { WORDS, useWeekendIntro } from "@/lib/useWeekendIntro";
import { markBootedThisPageLoad, useHasBootedSnapshot } from "@/lib/appBoot";

const anton = Anton({ weight: "400", subsets: ["latin"] });
const satisfy = Satisfy({ weight: "400", subsets: ["latin"] });

const WELCOME_HOLD_MS = 1100;
const REVEAL_TRANSITION_MS = 900;
// Never let a slow/failed auth check hold the boot sequence hostage —
// past this, proceed as if unauthenticated (the page underneath already
// has its own, independent auth gating; this component only controls
// entry *timing*, never access).
const AUTH_CHECK_TIMEOUT_MS = 3000;
// Absolute backstop: whatever else could theoretically wedge the intro
// (useWeekendIntro's `stage` never reaching "final", a future bug in
// either effect below), the real page — header, account menu, all of
// it — must never stay hidden behind the splash indefinitely. Well
// past every other timing constant here combined.
const MAX_BOOT_MS = 6000;

type AuthState = "checking" | "authenticated" | "unauthenticated";

/**
 * The app-entry boot sequence for every route except '/' (its own
 * server-rendered entry, see (home)/page.tsx + HomeWelcomeBackEntry.tsx).
 * Mounted once in (app)/layout.tsx, wrapping every other route: team,
 * matchups, standings, chat, Gamecast, etc. /weekend is its own sibling
 * route group with its own chrome-free atmosphere and is never wrapped
 * by (app)/layout.tsx at all, so it never renders this — no separate
 * skip check needed here for it.
 *
 * Exists specifically for deep links that land somewhere other than
 * Home — a push notification opening straight into a Gamecast, for
 * instance (see frontend/public/sw.js's notificationclick handler,
 * which navigates directly to the notification's own url, never
 * through '/' first). Next.js has already resolved *where* to go
 * (`children` is that route's own already-server-rendered content,
 * gamecast/team page and all) — this component only decides *when* to
 * reveal it, racing the intro animation against a same-origin /auth/me
 * check (the same one AuthStatus.tsx already uses, chosen specifically
 * because it works around Safari's ITP cross-site cookie blocking that
 * a direct browser->backend fetch would hit).
 *
 * Skipped entirely — reveals `children` immediately, no animation — for
 * any soft client-side navigation within an already-running app
 * (hasBootedThisPageLoad()), so ordinary nav (Home -> Matchups ->
 * Awards -> Home) stays instant. Only a genuine page load, reload, or
 * PWA launch plays this. Pull-to-refresh (usePullToRefresh.ts)
 * deliberately does NOT replay this sequence — it just re-fetches data
 * in place, so refreshing never reads as the app restarting.
 */
export function AppEntry({ children }: { children: ReactNode }) {
  const { stage, wordIndex } = useWeekendIntro();
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealedAfterBoot, setRevealedAfterBoot] = useState(false);

  // Already booted this JS runtime (an ordinary soft navigation, not a
  // fresh page load) — see appBoot.ts for why this is a
  // useSyncExternalStore snapshot rather than a useLayoutEffect + setState.
  const alreadyBooted = useHasBootedSnapshot();
  const revealed = alreadyBooted || revealedAfterBoot;

  useEffect(() => {
    if (revealed) return;
    let cancelled = false;
    const timeout = setTimeout(() => {
      if (!cancelled) setAuthState((s) => (s === "checking" ? "unauthenticated" : s));
    }, AUTH_CHECK_TIMEOUT_MS);

    fetch("/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((me: { display_name: string | null } | null) => {
        if (cancelled) return;
        setDisplayName(me?.display_name ?? null);
        setAuthState(me ? "authenticated" : "unauthenticated");
      })
      .catch(() => {
        if (!cancelled) setAuthState("unauthenticated");
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (revealed || stage !== "final" || authState === "checking") return;
    const holdMs = authState === "authenticated" ? WELCOME_HOLD_MS : 0;
    const holdTimeout = setTimeout(() => {
      setRevealing(true);
      const revealTimeout = setTimeout(() => {
        setRevealedAfterBoot(true);
        markBootedThisPageLoad();
      }, REVEAL_TRANSITION_MS);
      return () => clearTimeout(revealTimeout);
    }, holdMs);
    return () => clearTimeout(holdTimeout);
  }, [stage, authState, revealed]);

  useEffect(() => {
    if (revealed) return;
    const nav = document.getElementById("site-nav");
    nav?.setAttribute("inert", "");
    return () => nav?.removeAttribute("inert");
  }, [revealed]);

  useEffect(() => {
    if (revealed) return;
    const failsafe = setTimeout(() => {
      setRevealedAfterBoot(true);
      markBootedThisPageLoad();
    }, MAX_BOOT_MS);
    return () => clearTimeout(failsafe);
  }, [revealed]);

  if (revealed) return <>{children}</>;

  const showFinal = stage === "final";

  return (
    <div className="wl-gate flex flex-col items-center justify-center">
      <div className={`wl-ambient ${stage !== "dark" ? "wl-ambient--lit" : ""}`} aria-hidden />
      {revealing && <div className="wl-bloom" aria-hidden />}

      <div
        className={`wl-scene relative z-10 flex flex-col items-center justify-center gap-4 px-6 py-8 text-center sm:gap-5 ${
          revealing ? "wl-scene--entering" : ""
        }`}
      >
        {stage === "word" && (
          <h1 key={wordIndex} className={`wl-word wl-word--${wordIndex} text-4xl sm:text-6xl ${anton.className}`}>
            {WORDS[wordIndex]}
          </h1>
        )}

        {showFinal && (
          <>
            <h1 className={`wl-weekend text-5xl sm:text-8xl ${anton.className}`}>WEEKEND</h1>
            <div className="wl-league-wrap -mt-1 sm:-mt-2">
              <LeagueWordmark className={satisfy.className} />
            </div>
            {authState === "authenticated" && <WelcomeBackStage displayName={displayName} />}
          </>
        )}
      </div>
    </div>
  );
}
