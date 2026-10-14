"use client";

import { useEffect } from "react";

const KEY = "wl_session_refreshed_at";
const DAY_MS = 24 * 60 * 60 * 1000;

// Rolls a signed-in browser's session forward once a day (see
// app/auth/refresh/route.ts), so regular visitors stay signed in. Renders
// nothing. The timestamp is only a throttle: if storage is unavailable
// it refreshes on every page load, which is harmless.
export function SessionKeeper() {
  useEffect(() => {
    let last = 0;
    try {
      last = Number(localStorage.getItem(KEY)) || 0;
    } catch {
      // Storage blocked: fall through and refresh.
    }
    if (Date.now() - last < DAY_MS) return;
    fetch("/auth/refresh", { method: "POST" })
      .then((res) => {
        if (!res.ok) return;
        try {
          localStorage.setItem(KEY, String(Date.now()));
        } catch {
          // Ignore.
        }
      })
      .catch(() => {});
  }, []);
  return null;
}
