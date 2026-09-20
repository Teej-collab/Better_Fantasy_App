"use client";

import { useState, useTransition } from "react";
import { getWeekMatchupContextClient, type WeekMatchupContextItem } from "@/lib/api";
import { WeekScoreboardList } from "@/components/matchups/WeekScoreboardList";

// Real ESPN League > Scoreboard tab (reference video, 2026-09-15): a
// single week's matchups with ‹ / › arrows to page to any other week
// instantly, no page navigation. Replaces the old dedicated
// /seasons/[season]/weeks/[week] route's own week-picker (a full row of
// 17 pill links, one real navigation per week) — that whole route is
// gone now; this lives on /standings instead, right next to the
// standings it's most often checked alongside.
const MAX_WEEK = 17;

export function WeekScoreboardBrowser({
  season,
  initialWeek,
  initialMatchups,
}: {
  season: number;
  initialWeek: number;
  initialMatchups: WeekMatchupContextItem[];
}) {
  const [week, setWeek] = useState(initialWeek);
  const [matchups, setMatchups] = useState(initialMatchups);
  // Distinct from an empty `matchups` array — real report, 2026-09-20:
  // a failed fetch (a transient network blip, a 401 after the session
  // expired mid-visit, a 500) used to be swallowed into the exact same
  // "No matchups for this week" empty state a genuine bye week shows,
  // so a real failure looked identical to "nothing happened here" and
  // gave no way to tell the two apart or retry.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function load(targetWeek: number) {
    startTransition(async () => {
      try {
        const { matchups: next } = await getWeekMatchupContextClient(season, targetWeek);
        setMatchups(next);
        setLoadError(null);
      } catch (e) {
        setMatchups([]);
        // Kept visible (not swapped for a generic "something went
        // wrong") while this failure mode is still being tracked down —
        // real report, 2026-09-20: this used to show the exact same
        // empty state a genuine bye week does, with no way to tell a
        // real failure apart from "no games this week" at all.
        setLoadError(e instanceof Error ? e.message : "Unknown error");
      }
    });
  }

  function goTo(nextWeek: number) {
    if (nextWeek < 1 || nextWeek > MAX_WEEK || nextWeek === week) return;
    setWeek(nextWeek);
    load(nextWeek);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => goTo(week - 1)}
          disabled={week <= 1}
          aria-label="Previous week"
          className="rounded-full px-2 py-1 text-lg text-black/40 transition-colors hover:bg-black/5 hover:text-black disabled:pointer-events-none disabled:opacity-20 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white"
        >
          ‹
        </button>
        <span className="w-20 text-center text-sm font-semibold tracking-wide uppercase">Week {week}</span>
        <button
          type="button"
          onClick={() => goTo(week + 1)}
          disabled={week >= MAX_WEEK}
          aria-label="Next week"
          className="rounded-full px-2 py-1 text-lg text-black/40 transition-colors hover:bg-black/5 hover:text-black disabled:pointer-events-none disabled:opacity-20 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white"
        >
          ›
        </button>
      </div>

      <div className={isPending ? "opacity-50 transition-opacity" : "transition-opacity"}>
        {loadError ? (
          <div className="flex flex-col items-center gap-2 py-4 text-center text-sm">
            <p className="text-black/50 dark:text-white/50">Couldn&apos;t load Week {week} — try again.</p>
            <p className="font-mono text-xs text-black/30 dark:text-white/30">{loadError}</p>
            <button
              type="button"
              onClick={() => load(week)}
              className="rounded-full border px-3 py-1 text-xs font-medium"
              style={{ borderColor: "var(--wl-border)" }}
            >
              Retry
            </button>
          </div>
        ) : matchups.length === 0 ? (
          <p className="py-4 text-center text-sm text-black/50 dark:text-white/50">No matchups for this week.</p>
        ) : (
          <WeekScoreboardList matchups={matchups} />
        )}
      </div>
    </div>
  );
}
