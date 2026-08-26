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
 * Browsers block audio-with-sound autoplay until the visitor has
 * interacted with the page at all — same constraint
 * WeekendLanding.tsx already works around for its own pour/jazz
 * sounds. Each play attempt here is a best-effort `.play().catch(() =>
 * {})`: on a visitor's very first, cold load this may not produce
 * sound at all (nothing to do about that — it's the browser's policy,
 * not a bug), but once this origin has any autoplay trust (which
 * browsers grant per-origin over time, and which a standalone
 * installed PWA is often more lenient about than a fresh browser tab)
 * it plays normally.
 */
export function useIntroSound() {
  const lightSwitchRef = useRef<HTMLAudioElement | null>(null);
  const canRef = useRef<HTMLAudioElement | null>(null);
  const pourRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const lightSwitch = new Audio(LIGHT_SWITCH_SRC);
    const can = new Audio(CAN_OPENING_SRC);
    const pour = new Audio(POUR_SRC);
    lightSwitch.preload = "auto";
    can.preload = "auto";
    pour.preload = "auto";
    lightSwitchRef.current = lightSwitch;
    canRef.current = can;
    pourRef.current = pour;
  }, []);

  function playLightSwitch() {
    const el = lightSwitchRef.current;
    if (!el) return;
    el.currentTime = 0;
    el.volume = 0.5;
    el.play().catch(() => {});
  }

  function playCanThenPour() {
    const can = canRef.current;
    const pour = pourRef.current;
    if (!can || !pour) return;
    can.currentTime = 0;
    can.volume = 0.7;
    can.play().catch(() => {});
    window.setTimeout(() => {
      pour.currentTime = 0;
      pour.volume = 0.7;
      pour.play().catch(() => {});
    }, CAN_OPENING_DURATION_MS);
  }

  return { playLightSwitch, playCanThenPour };
}
