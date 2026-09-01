"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Anton, Satisfy } from "next/font/google";
import { LeagueWordmark } from "@/components/LeagueWordmark";
import { WelcomeBackStage } from "@/components/WelcomeBackStage";
import { WORDS, useWeekendIntro } from "@/lib/useWeekendIntro";
import { markBootedThisPageLoad, useHasBootedSnapshot } from "@/lib/appBoot";

const anton = Anton({ weight: "400", subsets: ["latin"] });
const satisfy = Satisfy({ weight: "400", subsets: ["latin"] });

// The ceremonial hold on "Welcome Back" before auto-continuing into the
// dashboard — lets the can-opening-then-pour sound (useIntroSound.ts)
// play out over the wordmark before the reveal transition begins. Only
// ever applied on a slow (first-ever, full-buildup) entry now — see
// FAST_HOLD_MS below and the 2026-09-01 audit note on why this used to
// apply unconditionally.
const EXTENDED_HOLD_MS = 3600;
// Applied instead of EXTENDED_HOLD_MS whenever useWeekendIntro's `fast`
// is true (reduced motion, a repeat visit, or an explicit skip click) —
// there's no ceremony left to protect for a visitor whose screen never
// even played the word-by-word buildup; holding them on a static logo
// for another 1.1-3.6s on every single hard load was pure dead time,
// the single largest finding in the 2026-09-01 re-audit (8.45s to real
// content on Home, every visit, not just first-time onboarding). Not
// zero — an instant cut still reads as a glitch — just short enough
// that the REVEAL_TRANSITION_MS fade below is the only thing a
// returning visitor actually waits through.
const FAST_HOLD_MS = 150;
const REVEAL_TRANSITION_MS = 900;
// Absolute backstop — see AppEntry.tsx's identical constant/effect for
// why: the real dashboard must never stay hidden behind the splash
// indefinitely, no matter what could theoretically wedge `stage`. The
// word-by-word buildup alone (useWeekendIntro.ts) takes ~3.75s before
// EXTENDED_HOLD_MS and REVEAL_TRANSITION_MS even start.
const MAX_BOOT_MS = 12000;

/**
 * The authenticated counterpart to OpeningExperience.tsx — (home)/page.tsx
 * wraps its already-fully-rendered dashboard JSX in this instead of
 * returning it directly, for the "Welcome Back, TJ" boot sequence. Because
 * (home)/page.tsx is a server component that already resolved auth and
 * built the entire dashboard from real data before this ever reaches the
 * browser, there's no client-side fetch to race against the animation
 * here (unlike AppEntry.tsx, which covers every OTHER route and doesn't
 * have that luxury) — `children` is simply revealed once the intro
 * finishes, nothing is ever fetched twice.
 *
 * Skipped entirely on a soft client-side navigation back to '/' within an
 * already-running app (hasBootedThisPageLoad()) — only a genuine page
 * load/reload/PWA-launch plays this. Pull-to-refresh (usePullToRefresh.ts)
 * deliberately does NOT replay this sequence — it just re-fetches data
 * in place, so refreshing never reads as the app restarting.
 *
 * `needsLeague` ((home)/page.tsx passes `me.active_league_id === null`)
 * holds the sequence open on the final "Welcome Back" beat instead of
 * auto-continuing into the dashboard — see WelcomeBackStage.tsx's own
 * needsLeague branch for the actual Join/Create buttons. Both the
 * auto-hold timer and the MAX_BOOT_MS failsafe are skipped in this
 * case; the only way past this screen is the real Join/Create links
 * (a normal navigation, which unmounts this component) or its "Skip
 * for now" escape hatch (handleSkip below).
 *
 * A persistent "Skip" control (handleSkip, rendered unconditionally
 * below — not just during needsLeague) is available the entire time
 * this is on screen, word-buildup or hold alike — there used to be no
 * way at all to get past this screen faster once past the initial
 * ~300ms dark beat, the 2026-09-01 re-audit's other half of the same
 * finding.
 */
export function HomeWelcomeBackEntry({
  displayName,
  needsLeague = false,
  children,
}: {
  displayName: string | null;
  needsLeague?: boolean;
  children: ReactNode;
}) {
  const { stage, wordIndex, fast, skip, markSeen } = useWeekendIntro();
  const [revealing, setRevealing] = useState(false);
  const [revealedAfterBoot, setRevealedAfterBoot] = useState(false);

  // Already booted this JS runtime (an ordinary soft navigation back to
  // '/', not a fresh page load) — see appBoot.ts for why this is a
  // useSyncExternalStore snapshot rather than a useLayoutEffect + setState
  // (avoids both a hydration mismatch and the react-hooks/set-state-in-effect
  // lint rule).
  const alreadyBooted = useHasBootedSnapshot();
  const revealed = alreadyBooted || revealedAfterBoot;

  useEffect(() => {
    if (revealed || stage !== "final" || needsLeague) return;
    const holdMs = fast ? FAST_HOLD_MS : EXTENDED_HOLD_MS;
    const holdTimeout = setTimeout(() => {
      setRevealing(true);
      const revealTimeout = setTimeout(() => {
        setRevealedAfterBoot(true);
        markBootedThisPageLoad();
        // This used to never run on the normal (non-skip) completion
        // path — AppEntry.tsx's equivalent effect always has, but this
        // one didn't, so wl_intro_seen never got persisted from an
        // ordinary Home visit and every single hard reload replayed the
        // full word-by-word buildup AND the full EXTENDED_HOLD_MS hold
        // forever, not just on a visitor's first-ever visit. This is
        // the real reason the 2026-09-01 re-audit measured 8.45s on
        // Home on *every* load, not just first-time onboarding.
        markSeen();
      }, REVEAL_TRANSITION_MS);
      return () => clearTimeout(revealTimeout);
    }, holdMs);
    return () => clearTimeout(holdTimeout);
    // markSeen isn't memoized (a fresh closure every render, same as
    // useWeekendIntro's other returned functions) — including it here
    // would restart this timeout on every unrelated re-render instead
    // of ever letting it complete. Same omission AppEntry.tsx's
    // identical effect already makes for the same reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, revealed, needsLeague, fast]);

  useEffect(() => {
    if (revealed) return;
    const nav = document.getElementById("site-nav");
    nav?.setAttribute("inert", "");
    return () => nav?.removeAttribute("inert");
  }, [revealed]);

  useEffect(() => {
    if (revealed || needsLeague) return;
    const failsafe = setTimeout(() => {
      setRevealedAfterBoot(true);
      markBootedThisPageLoad();
      markSeen();
    }, MAX_BOOT_MS);
    return () => clearTimeout(failsafe);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed, needsLeague]);

  // A plain event handler, not an effect — fine to setState directly.
  // Used both by the persistent "Skip" corner link below (any time, any
  // stage) and passed to WelcomeBackStage as its "Skip for now" link
  // when needsLeague is true. Calls the hook's own skip() first — stops
  // the word-by-word buildup immediately if it's still running, and
  // marks this browser as having seen the intro (so even a hard reload
  // right after gets the fast path, not just this one visit).
  function handleSkip() {
    skip();
    setRevealing(true);
    setTimeout(() => {
      setRevealedAfterBoot(true);
      markBootedThisPageLoad();
    }, REVEAL_TRANSITION_MS);
  }

  if (revealed) return <>{children}</>;

  const showFinal = stage === "final";

  return (
    <div className="wl-gate flex flex-col items-center justify-center">
      <div className={`wl-ambient ${stage !== "dark" ? "wl-ambient--lit" : ""}`} aria-hidden />
      {revealing && <div className="wl-bloom" aria-hidden />}

      {stage === "word" && (
        // Not a button — any tap anywhere on this screen already
        // unlocks sound (see useIntroSound.ts), this just invites an
        // early one so more of the sequence has a chance to play with
        // it instead of none, on a page load with no other gesture.
        <p className="safe-pt safe-px absolute top-0 left-0 z-10 text-xs text-white/40">🔈 Tap for sound</p>
      )}

      {/* Available through the whole sequence, word-buildup or hold
          alike — not just during "word" the way OpeningExperience's/
          AppEntry.tsx's own skip link is. needsLeague has its own
          equivalent inside WelcomeBackStage instead (a second one here
          would be a redundant, confusing double control on that
          screen). */}
      {!needsLeague && !revealing && (
        <button
          onClick={handleSkip}
          className="wl-skip-intro safe-pt safe-px absolute top-0 right-0 z-10 text-xs"
        >
          Skip →
        </button>
      )}

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
            <WelcomeBackStage
              displayName={displayName}
              needsLeague={needsLeague}
              onSkip={needsLeague ? handleSkip : undefined}
            />
          </>
        )}
      </div>
    </div>
  );
}
