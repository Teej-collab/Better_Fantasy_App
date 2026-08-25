"use client";

import { useSyncExternalStore } from "react";

// Distinguishes a genuine app boot (hard navigation, reload, PWA launch)
// from ordinary client-side route changes within an already-running app —
// AppEntry.tsx and the home page's authenticated entry both need this to
// decide whether to play the full intro or just reveal the page instantly.
//
// A plain module-level variable is the right tool here, not React state or
// sessionStorage: it initializes fresh exactly once per real page load
// (this module only re-evaluates when the browser actually reloads the
// document) and then stays put across any number of soft, client-side
// navigations within that same running app — including navigating away
// from and back to a route whose component unmounts and remounts. That's
// the "played once per real page load, replays only on a true reload"
// behavior the entry sequence needs. sessionStorage would survive a hard
// reload too (wrong — the intro should replay then); a React state flag
// would reset on every remount (also wrong — it would replay on every
// soft nav back to '/').
let booted = false;

export function hasBootedThisPageLoad(): boolean {
  return booted;
}

export function markBootedThisPageLoad(): void {
  booted = true;
}

const noSubscription = () => () => {};
const alwaysNotBootedOnServer = () => false;

// AppEntry.tsx / HomeWelcomeBackEntry.tsx use this — not a plain
// `useLayoutEffect` + setState — to read the flag as their *initial*
// render decision without either a hydration mismatch (server has no
// concept of "this page load already booted") or the
// react-hooks/set-state-in-effect lint rule's cascading-render warning
// (calling setState synchronously inside an effect). useSyncExternalStore
// is the built-in tool for exactly this: a value that only exists
// client-side, safe to fall back to a fixed value during SSR, with no
// subscription needed since nothing external ever changes it after the
// component's first client render decides what to do with it.
export function useHasBootedSnapshot(): boolean {
  return useSyncExternalStore(noSubscription, hasBootedThisPageLoad, alwaysNotBootedOnServer);
}
