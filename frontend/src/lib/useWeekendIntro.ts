"use client";

import { useEffect, useRef, useState } from "react";
import { useIntroSound } from "@/lib/useIntroSound";

// Shared by OpeningExperience.tsx (signed-out front door) and the
// authenticated app-entry sequence (AppEntry.tsx, HomeWelcomeBackEntry.tsx)
// — both need the exact same "dark -> WELCOME -> TO -> THE -> settled
// WEEKEND/League/tagline" build-up before branching into their own
// different final beat (Enter Here vs. Welcome Back). Extracted from
// OpeningExperience.tsx, which used to own this timing machinery outright,
// so both entry points share one implementation instead of two copies
// drifting apart.
//
// Also owns this sequence's sound effects (useIntroSound.ts) — a
// light-switch "click" per word (stadium lights coming on one at a
// time), then a can opening immediately followed by a pour once
// WEEKEND League itself appears — triggered from the exact same
// timeout callbacks that drive the visuals, so both stay in lockstep
// automatically. `sound` (default true) lets a consumer opt out of the
// audio entirely while keeping the same visual sequence — AppEntry.tsx
// does, since per the project owner this sound should only ever play
// on the actual sign-in screen and the "Welcome Back" reveal into
// Home, not on a reload of an arbitrary already-signed-in page.
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

export function useWeekendIntro({ sound = true }: { sound?: boolean } = {}) {
  const [stage, setStage] = useState<IntroStage>("dark");
  const [wordIndex, setWordIndex] = useState(0);
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);
  const { playLightSwitch, playCanThenPour } = useIntroSound(sound);

  useEffect(() => {
    // Every stage change happens inside a timeout callback, never
    // synchronously in the effect body itself — both the correct React
    // pattern (avoids a cascading render on mount) and what gives the
    // screen a genuine brief pure-dark beat before light 1 fires.
    const startTimeout = setTimeout(() => {
      // localStorage can throw (Safari private browsing with all
      // website data blocked, some locked-down PWA/webview contexts)
      // — this read used to be unguarded, so a throw here left `stage`
      // stuck at "dark" forever: the reveal effects below only ever
      // fire once `stage` reaches "final", so a page that can't read
      // localStorage never revealed the real app at all (no header, no
      // account menu, nothing but the dark intro background).
      let seenBefore = false;
      try {
        seenBefore = localStorage.getItem(SEEN_INTRO_KEY) === "1";
      } catch {
        // Can't tell — default to showing the intro rather than
        // leaving the page stuck.
      }

      if (prefersReducedMotion() || seenBefore) {
        // No sound here — this is deliberately the abbreviated path
        // (accessibility preference, or a repeat signed-out visitor),
        // so it skips the light-switch/can-opening/pour cues along
        // with the word-by-word buildup they're timed to, not just the
        // visuals.
        setStage("final");
        return;
      }

      setStage("word");
      playLightSwitch(); // WELCOME
      let i = 0;
      const advance = () => {
        i++;
        if (i < WORDS.length) {
          setWordIndex(i);
          playLightSwitch(); // TO, then THE — one "light" per word.
          timeouts.current.push(setTimeout(advance, WORD_INTERVALS_MS[i]));
        } else {
          timeouts.current.push(
            setTimeout(() => {
              setStage("final");
              playCanThenPour();
            }, WORD_INTERVALS_MS[WORDS.length - 1])
          );
        }
      };
      timeouts.current.push(setTimeout(advance, WORD_INTERVALS_MS[0]));
    }, INITIAL_DARK_BEAT_MS);

    timeouts.current.push(startTimeout);
    return () => {
      timeouts.current.forEach(clearTimeout);
      timeouts.current = [];
    };
    // playLightSwitch/playCanThenPour read stable refs internally
    // (useIntroSound.ts) — this effect is deliberately mount-only, same
    // as every other timer-driving effect in this file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function skip() {
    timeouts.current.forEach(clearTimeout);
    try {
      localStorage.setItem(SEEN_INTRO_KEY, "1");
    } catch {
      // Same storage-restricted contexts as above — skipping the
      // animation this once still works, it just won't be remembered.
    }
    setStage("final");
  }

  function markSeen() {
    try {
      localStorage.setItem(SEEN_INTRO_KEY, "1");
    } catch {
      // See skip() above.
    }
  }

  return { stage, wordIndex, skip, markSeen };
}
