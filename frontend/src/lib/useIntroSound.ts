"use client";

import { useEffect, useRef } from "react";

const LIGHT_SWITCH_SRC = "/audio/light-switch.m4a";
const CAN_OPENING_SRC = "/audio/can-opening.m4a";
const POUR_SRC = "/audio/intro-pour.m4a";

// Can opening runs ~1.1s — the pour starts right as it finishes, not
// layered on top of it. AppEntry.tsx/HomeWelcomeBackEntry.tsx's
// EXTENDED_HOLD_MS is sized to let both play out (can + this delay +
// the ~2.4s pour) before the reveal transition begins.
const CAN_OPENING_DURATION_MS = 1100;

/**
 * Sound effects for the boot/intro sequence (useWeekendIntro.ts) —
 * shared by AppEntry.tsx, HomeWelcomeBackEntry.tsx, and
 * OpeningExperience.tsx, all three of which already share that one
 * timing hook. A light-switch "click" per word as WELCOME / TO / THE
 * ignite (like stadium lights coming on one at a time), then a can
 * opening immediately followed by a pour once the WEEKEND League
 * wordmark itself appears.
 *
 * Browsers block audio-with-sound autoplay until the document has had
 * a genuine user gesture — but AppEntry.tsx/HomeWelcomeBackEntry.tsx's
 * boot sequence plays entirely automatically on page load, with no
 * button of its own to tap. Two things work around that as best as a
 * web page can:
 *
 * 1. introAudioUnlock.ts's app-wide warm-up listener (mounted once in
 *    RootLayout, every route) claims the *first* gesture on any fresh
 *    page load — a tap on the nav, a link, anywhere — for an audio
 *    unlock, before the boot sequence even gets a chance to need one.
 *    Once *any* gesture-triggered play succeeds on a document, that
 *    whole document stays unlocked for the rest of its lifetime
 *    (Chrome/Safari both work this way), so this alone can make a
 *    *later* reload's boot sequence play with sound even though
 *    nothing was tapped during the sequence itself that time.
 * 2. Failing that, this hook arms its own one-time listener for a tap
 *    *during* the sequence (same pattern WeekendLanding.tsx already
 *    uses for its own pour/jazz sounds) and replays whichever sound
 *    most recently got blocked the moment that happens — everything
 *    from that tap onward then plays normally too.
 *
 * On a visitor's very first-ever cold load on this origin, with zero
 * interaction anywhere during the sequence, sound still won't play —
 * that's an unconditional browser policy no web page can override, not
 * a bug. It should stop being silent well before long, though.
 *
 * `enabled` (default true) — AppEntry.tsx (the boot sequence that
 * replays on a reload of ANY signed-in page — team, chat, matchups,
 * every route it wraps) passes false: per the project owner, this
 * sound should only ever play on the actual sign-in screen
 * (OpeningExperience.tsx) and the "Welcome Back" reveal into Home
 * (HomeWelcomeBackEntry.tsx), not on a reload of an arbitrary page.
 * Still always called (React's rules of hooks — no conditional hook
 * calls), just skips creating/preloading the three audio files
 * entirely when disabled, so AppEntry.tsx's every-route reach doesn't
 * mean fetching audio nobody will ever hear on most page loads.
 */
export function useIntroSound(enabled: boolean = true) {
  const lightSwitchRef = useRef<HTMLAudioElement | null>(null);
  const canRef = useRef<HTMLAudioElement | null>(null);
  const pourRef = useRef<HTMLAudioElement | null>(null);
  const pendingRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const lightSwitch = new Audio(LIGHT_SWITCH_SRC);
    const can = new Audio(CAN_OPENING_SRC);
    const pour = new Audio(POUR_SRC);
    lightSwitch.preload = "auto";
    can.preload = "auto";
    pour.preload = "auto";
    lightSwitchRef.current = lightSwitch;
    canRef.current = can;
    pourRef.current = pour;

    const retryPending = () => {
      pendingRef.current?.();
      pendingRef.current = null;
    };
    window.addEventListener("pointerdown", retryPending, { once: true });
    window.addEventListener("keydown", retryPending, { once: true });
    return () => {
      window.removeEventListener("pointerdown", retryPending);
      window.removeEventListener("keydown", retryPending);
    };
  }, [enabled]);

  function playLightSwitch() {
    const el = lightSwitchRef.current;
    if (!el) return;
    el.currentTime = 0;
    el.volume = 0.5;
    el.play().catch(() => {
      pendingRef.current = playLightSwitch;
    });
  }

  function playCanThenPour() {
    const can = canRef.current;
    const pour = pourRef.current;
    if (!can || !pour) return;
    can.currentTime = 0;
    can.volume = 0.7;
    can.play().catch(() => {
      pendingRef.current = playCanThenPour;
    });
    window.setTimeout(() => {
      pour.currentTime = 0;
      pour.volume = 0.7;
      pour.play().catch(() => {});
    }, CAN_OPENING_DURATION_MS);
  }

  return { playLightSwitch, playCanThenPour };
}
