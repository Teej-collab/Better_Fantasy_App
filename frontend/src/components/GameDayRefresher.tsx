"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Matches the backend live-sync scheduler's own poll cadence
// (LIVE_SYNC_INTERVAL_MINUTES, app/scheduler.py) — refreshing the page
// more often than the backend actually pulls fresh scores from ESPN
// couldn't show anything newer, just waste requests.
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

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
