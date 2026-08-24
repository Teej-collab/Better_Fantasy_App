"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Anton, Satisfy } from "next/font/google";
import { LeagueWordmark } from "@/components/LeagueWordmark";
import { WelcomeBackStage } from "@/components/WelcomeBackStage";
import { WORDS, useWeekendIntro } from "@/lib/useWeekendIntro";
import { markBootedThisPageLoad, useBootGeneration, useHasBootedSnapshot } from "@/lib/appBoot";

const anton = Anton({ weight: "400", subsets: ["latin"] });
const satisfy = Satisfy({ weight: "400", subsets: ["latin"] });

const WELCOME_HOLD_MS = 1100;
const REVEAL_TRANSITION_MS = 900;

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
 * load/reload/PWA-launch plays this, or a pull-to-refresh
 * (usePullToRefresh.ts), which bumps useBootGeneration() below to force
 * a clean remount that replays the sequence without a real page reload.
 */
export function HomeWelcomeBackEntry({ displayName, children }: { displayName: string | null; children: ReactNode }) {
  const generation = useBootGeneration();
  return (
    <HomeWelcomeBackEntryInner key={generation} displayName={displayName}>
      {children}
    </HomeWelcomeBackEntryInner>
  );
}

function HomeWelcomeBackEntryInner({ displayName, children }: { displayName: string | null; children: ReactNode }) {
  const { stage, wordIndex } = useWeekendIntro();
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
    if (revealed || stage !== "final") return;
    const holdTimeout = setTimeout(() => {
      setRevealing(true);
      const revealTimeout = setTimeout(() => {
        setRevealedAfterBoot(true);
        markBootedThisPageLoad();
      }, REVEAL_TRANSITION_MS);
      return () => clearTimeout(revealTimeout);
    }, WELCOME_HOLD_MS);
    return () => clearTimeout(holdTimeout);
  }, [stage, revealed]);

  useEffect(() => {
    if (revealed) return;
    const nav = document.getElementById("site-nav");
    nav?.setAttribute("inert", "");
    return () => nav?.removeAttribute("inert");
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
            <WelcomeBackStage displayName={displayName} />
          </>
        )}
      </div>
    </div>
  );
}
