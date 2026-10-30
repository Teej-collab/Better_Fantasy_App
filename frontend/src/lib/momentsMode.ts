"use client";

import { useSyncExternalStore } from "react";

// Which Lounge moments you want (2026-10-29), yours alone in this
// browser: everything, only plays for or against you, or only the big
// ones (the takeovers, the TV's touchdowns and your bets cashing).
// Mirrors mobile/src/lib/momentsMode.ts.
export type MomentsMode = "all" | "mine" | "big";

const KEY = "wl:lounge-moments-mode";
let current: MomentsMode = "all";
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === "all" || v === "mine" || v === "big") current = v;
  } catch {
    // Private mode: everything, as usual.
  }
}

export function useMomentsMode(): MomentsMode {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => {
      load();
      return current;
    },
    () => "all"
  );
}

export function setMomentsMode(mode: MomentsMode) {
  current = mode;
  try {
    window.localStorage.setItem(KEY, mode);
  } catch {
    // Not remembered; still applies now.
  }
  listeners.forEach((fn) => fn());
}
