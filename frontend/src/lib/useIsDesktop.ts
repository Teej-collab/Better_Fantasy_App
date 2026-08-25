"use client";

import { useSyncExternalStore } from "react";

// Tailwind's `sm:` breakpoint (640px) is what every other mobile/
// desktop split in this app already keys off of at the CSS layer — no
// JS-level responsive check existed anywhere before this. Needed here
// specifically because the home dashboard renders a genuinely
// different *component* per breakpoint (HomeCardDeck's reorder-only
// list vs. HomeGridDesktop's resizable grid), not just different CSS
// on the same markup.
const DESKTOP_QUERY = "(min-width: 640px)";

function subscribe(callback: () => void) {
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getSnapshot() {
  return window.matchMedia(DESKTOP_QUERY).matches;
}

// Always "mobile" on the server (and matches what a real mobile visitor
// sees) — there's no viewport to measure during SSR, and guessing
// "desktop" would risk briefly mounting react-grid-layout (which needs
// a real measured container width) before hydration settles.
function getServerSnapshot() {
  return false;
}

// useSyncExternalStore, not useState+useEffect — this is exactly the
// case it exists for (subscribing to an external mutable source like a
// media query) and it avoids the "setState synchronously inside an
// effect" anti-pattern a naive useEffect-based version falls into.
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
