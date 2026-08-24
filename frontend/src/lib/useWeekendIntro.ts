"use client";

import { useEffect, useRef, useState } from "react";

// Shared by OpeningExperience.tsx (signed-out front door) and the
// authenticated app-entry sequence (AppEntry.tsx, HomeWelcomeBackEntry.tsx)
// — both need the exact same "dark -> WELCOME -> TO -> THE -> settled
// WEEKEND/League/tagline" build-up before branching into their own
// different final beat (Enter Here vs. Welcome Back). Extracted from
// OpeningExperience.tsx, which used to own this timing machinery outright,
// so both entry points share one implementation instead of two copies
// drifting apart.
export const WORDS = ["WELCOME", "TO", "THE"];
// Each word ignites a little quicker than the last — an accelerating
// cadence that builds anticipation toward WEEKEND instead of a metronomic
// repeat.
const WORD_INTERVALS_MS = [1300, 1150, 1000];
const INITIAL_DARK_BEAT_MS = 300;
const SEEN_INTRO_KEY = "wl_intro_seen";

export type IntroStage = "dark" | "word" | "final";

// True if the user should see the abbreviated/instant form of the intro:
// their OS's own reduced-motion preference (unconditional — always
// respected regardless of the app's own setting, see globals.css), or
// Settings > Appearance > Animations = Reduced (mirrored into the
// wl_motion cookie the same way neon intensity/accent color are — see
// app/layout.tsx's APPEARANCE_SCRIPT). Checking both here is what makes
// the entry sequence honor the *existing* animation setting instead of
// only the OS-level one, which is all this sequence checked before it
// could ever be seen by a signed-in visitor with their own opinion set in
// Settings.
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
  return /(?:^|; )wl_motion=reduced(?:;|$)/.test(document.cookie);
}

export function useWeekendIntro() {
  const [stage, setStage] = useState<IntroStage>("dark");
  const [wordIndex, setWordIndex] = useState(0);
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    // Every stage change happens inside a timeout callback, never
    // synchronously in the effect body itself — both the correct React
    // pattern (avoids a cascading render on mount) and what gives the
    // screen a genuine brief pure-dark beat before light 1 fires.
    const startTimeout = setTimeout(() => {
      const seenBefore = localStorage.getItem(SEEN_INTRO_KEY) === "1";

      if (prefersReducedMotion() || seenBefore) {
        setStage("final");
        return;
      }

      setStage("word");
      let i = 0;
      const advance = () => {
        i++;
        if (i < WORDS.length) {
          setWordIndex(i);
          timeouts.current.push(setTimeout(advance, WORD_INTERVALS_MS[i]));
        } else {
          timeouts.current.push(setTimeout(() => setStage("final"), WORD_INTERVALS_MS[WORDS.length - 1]));
        }
      };
      timeouts.current.push(setTimeout(advance, WORD_INTERVALS_MS[0]));
    }, INITIAL_DARK_BEAT_MS);

    timeouts.current.push(startTimeout);
    return () => {
      timeouts.current.forEach(clearTimeout);
      timeouts.current = [];
    };
  }, []);

  function skip() {
    timeouts.current.forEach(clearTimeout);
    localStorage.setItem(SEEN_INTRO_KEY, "1");
    setStage("final");
  }

  function markSeen() {
    localStorage.setItem(SEEN_INTRO_KEY, "1");
  }

  return { stage, wordIndex, skip, markSeen };
}
