"use client";

import { useEffect, useRef, useState } from "react";
import { Anton, Satisfy } from "next/font/google";
import { AuthScreen } from "@/components/AuthScreen";
import { LiveTicker } from "@/components/LiveTicker";

const anton = Anton({ weight: "400", subsets: ["latin"] });
const satisfy = Satisfy({ weight: "400", subsets: ["latin"] });

const WORDS = ["WELCOME", "TO", "THE"];
const WORD_INTERVAL_MS = 1300;
const INITIAL_DARK_BEAT_MS = 300;
const SEEN_INTRO_KEY = "wl_intro_seen";
const ENTER_TRANSITION_MS = 900;

type Stage = "dark" | "word" | "final" | "entering" | "auth";

/**
 * The mandatory front door for a signed-out visitor (app/page.tsx
 * renders this instead of the dashboard when there's no session).
 * Darkness -> WELCOME / TO / THE, one at a time -> the WEEKEND / League
 * wordmark -> tagline -> Enter Here -> a transition into AuthScreen.
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
export function OpeningExperience({ tickerItems, isGameDay }: { tickerItems: string[]; isGameDay: boolean }) {
  const [stage, setStage] = useState<Stage>("dark");
  const [wordIndex, setWordIndex] = useState(0);
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const nav = document.getElementById("site-nav");
    nav?.setAttribute("inert", "");
    return () => nav?.removeAttribute("inert");
  }, []);

  useEffect(() => {
    // Every stage change happens inside a timeout callback, never
    // synchronously in the effect body itself — both because that's the
    // correct React pattern (avoids a cascading render on mount) and
    // because it gives the screen a genuine brief pure-dark beat before
    // light 1 fires, matching section 4's "the screen begins almost
    // completely black."
    const startTimeout = setTimeout(() => {
      const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const seenBefore = localStorage.getItem(SEEN_INTRO_KEY) === "1";

      if (prefersReduced || seenBefore) {
        setStage("final");
        return;
      }

      setStage("word");
      let i = 0;
      const advance = () => {
        i++;
        if (i < WORDS.length) {
          setWordIndex(i);
          timeouts.current.push(setTimeout(advance, WORD_INTERVAL_MS));
        } else {
          timeouts.current.push(setTimeout(() => setStage("final"), WORD_INTERVAL_MS));
        }
      };
      timeouts.current.push(setTimeout(advance, WORD_INTERVAL_MS));
    }, INITIAL_DARK_BEAT_MS);

    timeouts.current.push(startTimeout);
    return () => {
      timeouts.current.forEach(clearTimeout);
      timeouts.current = [];
    };
  }, []);

  function skipIntro() {
    timeouts.current.forEach(clearTimeout);
    localStorage.setItem(SEEN_INTRO_KEY, "1");
    setStage("final");
  }

  function enter() {
    localStorage.setItem(SEEN_INTRO_KEY, "1");
    setStage("entering");
    setTimeout(() => setStage("auth"), ENTER_TRANSITION_MS);
  }

  if (stage === "auth") {
    return <AuthScreen onBack={() => setStage("final")} />;
  }

  const showFinal = stage === "final" || stage === "entering";

  return (
    // A real flex column, not a centered block with an absolutely
    // positioned ticker layered over it — the centered content is a
    // flex-1 region that shares the viewport with a genuine trailing
    // flex child for the ticker, so on a short mobile viewport the two
    // can never overlap; the browser lays them out, nothing is guessed.
    <div className="wl-gate flex flex-col">
      <div className={`wl-ambient ${stage !== "dark" ? "wl-ambient--lit" : ""}`} aria-hidden />

      {stage === "word" && (
        <button
          onClick={skipIntro}
          className="wl-skip-intro safe-pt safe-px absolute top-0 right-0 z-10 text-xs"
        >
          Skip intro →
        </button>
      )}

      <div
        className={`wl-scene relative z-10 flex flex-1 flex-col items-center justify-center gap-4 px-6 py-8 text-center sm:gap-5 ${
          stage === "entering" ? "wl-scene--entering" : ""
        }`}
      >
        {stage === "word" && (
          <h1 key={wordIndex} className={`wl-word text-4xl sm:text-6xl ${anton.className}`}>
            {WORDS[wordIndex]}
          </h1>
        )}

        {showFinal && (
          <>
            <h1 className={`wl-weekend text-5xl sm:text-8xl ${anton.className}`}>WEEKEND</h1>
            <p className={`wl-league -mt-1 text-2xl sm:-mt-2 sm:text-4xl ${satisfy.className}`}>League</p>
            <p className="wl-tagline max-w-[16rem] text-sm sm:max-w-sm sm:text-base">
              Sit back. Relax. Dive into the League.
            </p>
            <button
              onClick={enter}
              disabled={stage === "entering"}
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
    </div>
  );
}
