"use client";

import { useEffect, useState } from "react";
import { Anton, Satisfy } from "next/font/google";
import { AuthScreen } from "@/components/AuthScreen";
import { EntryChoiceStage, type EntryChoice } from "@/components/EntryChoiceStage";
import { LiveTicker } from "@/components/LiveTicker";
import { LeagueWordmark } from "@/components/LeagueWordmark";
import { GameDayRefresher } from "@/components/GameDayRefresher";
import { WORDS, useWeekendIntro } from "@/lib/useWeekendIntro";
import { markBootedThisPageLoad } from "@/lib/appBoot";
import type { TickerItem } from "@/lib/api";

const anton = Anton({ weight: "400", subsets: ["latin"] });
const satisfy = Satisfy({ weight: "400", subsets: ["latin"] });

const ENTER_TRANSITION_MS = 900;

type PostIntroStage = "entering" | "choice" | "auth" | null;

/**
 * The mandatory front door for a signed-out visitor (app/page.tsx
 * renders this instead of the dashboard when there's no session).
 * Darkness -> WELCOME / TO / THE, one at a time -> the WEEKEND / League
 * wordmark -> tagline -> Enter Here -> a transition into
 * EntryChoiceStage (Sign In / Join a League / Create a League) ->
 * AuthScreen, pre-set to the chosen intent.
 *
 * Skips straight to the settled final state (no word-by-word build-up)
 * for prefers-reduced-motion and for anyone who's already seen the
 * intro before (localStorage — the one client-side flag this app
 * needed that it didn't already have a mechanism for). The nav bar
 * underneath is fully covered by this fixed overlay, but a
 * keyboard/screen-reader user could still reach it without seeing it —
 * `inert` removes it from both while this is mounted.
 *
 * The ticker (real NFL scores, same LiveTicker.tsx the signed-in
 * dashboard uses) runs the whole time this screen is up — per the
 * brief, "this gives the landing page life even before someone signs
 * in." It drops away once Enter Here is clicked; AuthScreen itself
 * stays clean per the brief's own "the form itself should be clean."
 */
export function OpeningExperience({ tickerItems, isGameDay }: { tickerItems: TickerItem[]; isGameDay: boolean }) {
  const { stage, wordIndex, skip, markSeen } = useWeekendIntro();
  const [postStage, setPostStage] = useState<PostIntroStage>(null);
  const [entryChoice, setEntryChoice] = useState<EntryChoice>("signin");

  useEffect(() => {
    // This front door is only ever shown at the start of a real page load
    // (a signed-out visitor has no authenticated route to soft-navigate
    // back from), so there's no remount-without-reload case to guard
    // against the way AppEntry.tsx has to — marking booted here just
    // keeps the flag accurate in case Enter Here leads somewhere that
    // checks it.
    markBootedThisPageLoad();
    const nav = document.getElementById("site-nav");
    nav?.setAttribute("inert", "");
    return () => nav?.removeAttribute("inert");
  }, []);

  function skipIntro() {
    skip();
  }

  function enter() {
    markSeen();
    setPostStage("entering");
    setTimeout(() => setPostStage("choice"), ENTER_TRANSITION_MS);
  }

  if (postStage === "auth") {
    return <AuthScreen variant={entryChoice} onBack={() => setPostStage("choice")} />;
  }

  if (postStage === "choice") {
    return (
      <div className="wl-gate flex items-center justify-center px-6">
        <div className="wl-ambient wl-ambient--lit" aria-hidden />
        <EntryChoiceStage
          onChoose={(choice) => {
            setEntryChoice(choice);
            setPostStage("auth");
          }}
          onBack={() => setPostStage(null)}
        />
      </div>
    );
  }

  const showFinal = stage === "final" || postStage === "entering";
  const entering = postStage === "entering";

  return (
    // A real flex column, not a centered block with an absolutely
    // positioned ticker layered over it — the centered content is a
    // flex-1 region that shares the viewport with a genuine trailing
    // flex child for the ticker, so on a short mobile viewport the two
    // can never overlap; the browser lays them out, nothing is guessed.
    <div className="wl-gate flex flex-col">
      <div className={`wl-ambient ${stage !== "dark" ? "wl-ambient--lit" : ""}`} aria-hidden />

      {/* Light-spill bloom that ignites from the sign on Enter and
          overtakes the frame — the "walking through the door" beat. */}
      {entering && <div className="wl-bloom" aria-hidden />}

      {stage === "word" && (
        <>
          <button
            onClick={skipIntro}
            className="wl-skip-intro safe-pt safe-px absolute top-0 right-0 z-10 text-xs"
          >
            Skip intro →
          </button>
          {/* Not itself the unlock — any tap anywhere already claims
              it (useIntroSound.ts) — just an invitation for an early
              one so more of the sequence plays with sound. */}
          <p className="safe-pt safe-px absolute top-0 left-0 z-10 text-xs text-white/40">🔈 Tap for sound</p>
        </>
      )}

      <div
        className={`wl-scene relative z-10 flex flex-1 flex-col items-center justify-center gap-4 px-6 py-8 text-center sm:gap-5 ${
          entering ? "wl-scene--entering" : ""
        }`}
      >
        {stage === "word" && (
          <h1
            key={wordIndex}
            className={`wl-word wl-word--${wordIndex} text-4xl sm:text-6xl ${anton.className}`}
          >
            {WORDS[wordIndex]}
          </h1>
        )}

        {showFinal && (
          <>
            <h1 className={`wl-weekend text-5xl sm:text-8xl ${anton.className}`}>WEEKEND</h1>
            <div className="wl-league-wrap -mt-1 sm:-mt-2">
              <LeagueWordmark className={satisfy.className} />
            </div>
            <p className="wl-tagline max-w-[16rem] text-sm sm:max-w-sm sm:text-base">
              Sit back. Relax. Dive into the League.
            </p>
            <button
              onClick={enter}
              disabled={entering}
              className="wl-enter-sign mt-3 px-8 py-3.5 text-sm font-bold sm:mt-4 sm:py-3 sm:text-base"
            >
              Enter Here
            </button>
          </>
        )}
      </div>

      <div className="safe-pb relative z-10 px-3 sm:px-8">
        <LiveTicker items={tickerItems} fast={isGameDay} />
      </div>
      {/* The signed-in dashboard and the persistent app ticker both
          auto-refresh during a live window (GameDayRefresher) — this
          screen never had it, so a signed-out visitor's ticker (this
          is what a phone sits on if it isn't signed in) was a single
          snapshot from whenever the page first loaded and never
          updated no matter how long they sat on it. */}
      {isGameDay && <GameDayRefresher />}
    </div>
  );
}
