"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// The NFL ticker's scores come from a direct, uncached fetch to ESPN's
// public scoreboard on every request (app/providers/nfl_scoreboard.py),
// not from the backend's own live-sync scheduler — so there's no
// scheduler cadence to match here. Lined up with the live ticker's own
// scroll duration instead (.live-ticker-track--fast, globals.css,
// 46s) — close enough that a full lap of the ticker is a fresh lap.
const REFRESH_INTERVAL_MS = 45 * 1000;

/**
 * Renders nothing — only mounted on the homepage while it's a live NFL
 * game window (see getIsGameDay), and just calls router.refresh() on
 * an interval so the server-rendered data (scores, ticker, win
 * probability) actually updates without the user having to reload.
 * Outside a game window this component isn't rendered at all, so
 * there's no background polling the rest of the time.
 */
export function GameDayRefresher() {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [router]);

  return null;
}
