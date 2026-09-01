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
 *
 * Sound off (`useWeekendIntro({ sound: false })`) — per the project
 * owner, final answer: the light-switch/can-opening/pour cues play
 * ONLY on the sign-in screen (OpeningExperience.tsx) and the "Welcome
 * Back" reveal into Home (HomeWelcomeBackEntry.tsx), never on a
 * reload/deep-link landing on any other signed-in page, which is every
 * route this component covers. Visuals are unaffected — same silent
 * buildup either way.
 *
 * Unlike OpeningExperience.tsx, this used to never call markSeen() —
 * so a visitor who always signs in via the header's direct Discord
 * link (AuthStatus.tsx), rather than clicking through the signed-out
 * "Enter Here" screen, had `wl_intro_seen` permanently unset and
 * replayed the full multi-second word-by-word buildup on *every*
 * reload/deep-link, forever. Now calls markSeen() the first time this
 * sequence completes, same as OpeningExperience does, so it only ever
 * plays in full once per browser. Two more escape hatches on top of
 * that: a visible "Skip intro" button (matching OpeningExperience's),
 * and an automatic skip whenever the URL carries an `error` param —
 * that's exactly the shape of Discord's own OAuth-failure redirect to
 * /login, and someone who just failed to sign in shouldn't have to
 * wait out an animation before they can even read why or retry.
 */
export function AppEntry({ children }: { children: ReactNode }) {
  const { stage, wordIndex, skip, markSeen } = useWeekendIntro({ sound: false });
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealedAfterBoot, setRevealedAfterBoot] = useState(false);

  // Already booted this JS runtime (an ordinary soft navigation, not a
  // fresh page load) — see appBoot.ts for why this is a
  // useSyncExternalStore snapshot rather than a useLayoutEffect + setState.
  const alreadyBooted = useHasBootedSnapshot();
  const revealed = alreadyBooted || revealedAfterBoot;

  // A failed-sign-in redirect (Discord's own ?error=not_a_league_member
  // on /login, or any future error-carrying deep link) skips the
  // animation outright — this is someone who needs to read what went
  // wrong and retry, not watch an intro. Reading window.location.search
  // directly (not useSearchParams()) deliberately avoids that hook's
  // Suspense-boundary requirement — this is a one-time mount check, not
  // something that needs to react to client-side URL changes.
  useEffect(() => {
    if (revealed || typeof window === "undefined") return;
    if (!new URLSearchParams(window.location.search).has("error")) return;
    skip();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed]);

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
        markSeen();
      }, REVEAL_TRANSITION_MS);
      return () => clearTimeout(revealTimeout);
    }, holdMs);
    return () => clearTimeout(holdTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      markSeen();
    }, MAX_BOOT_MS);
    return () => clearTimeout(failsafe);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          <>
            <button onClick={skip} className="wl-skip-intro safe-pt safe-px absolute top-0 right-0 z-10 text-xs">
              Skip intro →
            </button>
            <h1 key={wordIndex} className={`wl-word wl-word--${wordIndex} text-4xl sm:text-6xl ${anton.className}`}>
              {WORDS[wordIndex]}
            </h1>
          </>
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
