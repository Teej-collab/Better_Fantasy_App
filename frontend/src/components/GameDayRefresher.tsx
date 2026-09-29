"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { dispatchAppRefresh } from "@/lib/usePullToRefresh";

// The NFL ticker's scores come from a direct, uncached fetch to ESPN's
// public scoreboard on every request (app/providers/nfl_scoreboard.py),
// not from the backend's own live-sync scheduler — so there's no
// scheduler cadence to match here. Lined up with the live ticker's own
// scroll duration instead (.live-ticker-track--fast, globals.css) —
// roughly one fresh set of scores per lap of the ticker.
const REFRESH_INTERVAL_MS = 45 * 1000;

// Client components holding live fantasy scores (matchups, My Team,
// the standings scoreboard) refetch on a faster beat than the full
// server re-render above: the backend recomputes points every ~20s
// (scheduler.py's weekly compute), so waiting 45s here threw most of
// that away. These are small JSON fetches through /api/backend, far
// cheaper than a full router.refresh() render, which is why only this
// half got faster.
const CLIENT_REFRESH_INTERVAL_MS = 15 * 1000;

/**
 * Renders nothing — only mounted while a real NFL game is live (see
 * isNflGameLive, lib/api.ts), and just calls router.refresh() on an
 * interval so the server-rendered data (scores, ticker, win
 * probability) actually updates without the user having to reload.
 * Also fires the app-refresh event (usePullToRefresh.ts) so client
 * components holding their own copy of live data — matchup scores, the
 * standings scoreboard — refetch on the same beat instead of sitting
 * frozen at whatever the page first rendered.
 * Outside a live game this component isn't rendered at all, so there's
 * no background polling the rest of the time.
 *
 * Paused whenever the tab/PWA isn't actually visible — a user who
 * backgrounds the app during a live game shouldn't keep firing a
 * full-page refresh every 45s for however many hours of football
 * remain (2026-09 battery audit, P0-1). Refreshes once immediately on
 * return to visible so the gap doesn't show up as stale data.
 */
export function GameDayRefresher() {
  const router = useRouter();

  useEffect(() => {
    let serverId: ReturnType<typeof setInterval> | null = null;
    let clientId: ReturnType<typeof setInterval> | null = null;

    function stop() {
      if (serverId !== null) clearInterval(serverId);
      if (clientId !== null) clearInterval(clientId);
      serverId = clientId = null;
    }

    function startOrStop() {
      if (document.visibilityState === "visible") {
        if (serverId === null) {
          router.refresh();
          void dispatchAppRefresh();
          serverId = setInterval(() => router.refresh(), REFRESH_INTERVAL_MS);
          clientId = setInterval(() => void dispatchAppRefresh(), CLIENT_REFRESH_INTERVAL_MS);
        }
      } else {
        stop();
      }
    }

    startOrStop();
    document.addEventListener("visibilitychange", startOrStop);
    return () => {
      document.removeEventListener("visibilitychange", startOrStop);
      stop();
    };
  }, [router]);

  return null;
}
