"use client";

import { useEffect, useState } from "react";

/**
 * An honest, app-wide signal when the browser itself reports no
 * connectivity — pairs with sw.js's runtime cache for /api/backend/*
 * GETs (network-first, falling back to the last cached response): the
 * cache keeps data on screen through a dropped connection, this banner
 * is what tells the user that's what's happening, instead of the app
 * silently going stale with no explanation. The exact gap named in the
 * 2026-08-31 audit — "zero offline handling... a user in a stadium or
 * backyard with bad signal on Sunday."
 *
 * navigator.onLine only reflects "the OS thinks it has a link" (e.g.
 * still true on wifi with no real internet) — not perfect, but it's
 * the same signal every major browser and OS uses for this, and false
 * positives (says online, isn't really) just mean a fetch fails and
 * the sw.js cache fallback quietly covers it; this banner is a bonus
 * signal on top; the real resilience is the cache.
 *
 * Mounted once in the true root layout (app/layout.tsx), not per
 * route-group — connectivity isn't tied to any one page. Starts
 * optimistically "online" (matches server-rendered markup, avoiding a
 * hydration mismatch) and corrects itself from the real
 * navigator.onLine value the moment this effect runs.
 */
export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    // setTimeout(0), not a direct setState call in the effect body —
    // same lint-satisfying pattern used elsewhere in this app (e.g.
    // app/(app)/leagues/page.tsx's refresh effect) — still runs
    // effectively immediately on mount.
    const initial = setTimeout(() => setIsOffline(!navigator.onLine), 0);
    const goOnline = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      clearTimeout(initial);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 px-3 py-1.5 text-center text-xs font-medium text-red-400"
      style={{ background: "rgba(239,68,68,0.12)", borderBottom: "1px solid rgba(239,68,68,0.3)" }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" aria-hidden />
      You&apos;re offline — showing the last data that loaded
    </div>
  );
}
