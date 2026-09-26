"use client";

import { useRef, useState, useTransition } from "react";
import { getWeekMatchupContextClient, type WeekMatchupContextItem } from "@/lib/api";
import { MatchupCarousel } from "@/components/matchups/MatchupCarousel";
import { orientMatchupForViewer } from "@/components/matchups/orientMatchup";

// Same 1-17 range and ‹ / › paging as Standings' Scoreboard tab
// (WeekScoreboardBrowser.tsx), but on the matchup screen itself: paging
// to another week lands on the same team's matchup that week (the
// left-hand team of whatever was on screen — the viewer's own team
// whenever they're looking at their own matchup), rather than dropping
// back to a week list first.
const MAX_WEEK = 17;

export function MatchupWeekBrowser({
  season,
  initialWeek,
  initialMatchups,
  initialMatchupId,
  myOwnerId,
}: {
  season: number;
  initialWeek: number;
  initialMatchups: WeekMatchupContextItem[];
  initialMatchupId: number;
  myOwnerId: number;
}) {
  const [week, setWeek] = useState(initialWeek);
  const [matchups, setMatchups] = useState(initialMatchups);
  const [targetMatchupId, setTargetMatchupId] = useState(initialMatchupId);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Whichever team is on the left of the matchup currently on screen —
  // kept in a ref (not state) since it only matters at the moment the
  // week changes, and the carousel reports it on every swipe.
  const focusOwnerIdRef = useRef<number | null>(
    initialMatchups.find((m) => m.matchup_id === initialMatchupId)?.home.owner_id ?? null
  );

  function load(targetWeek: number) {
    startTransition(async () => {
      try {
        const { matchups: raw } = await getWeekMatchupContextClient(season, targetWeek);
        const next = raw.map((m) => orientMatchupForViewer(m, myOwnerId));
        const focusOwnerId = focusOwnerIdRef.current;
        const target =
          next.find((m) => m.home.owner_id === focusOwnerId || m.away.owner_id === focusOwnerId) ?? next[0];
        setMatchups(next);
        setTargetMatchupId(target?.matchup_id ?? -1);
        setLoadError(null);
      } catch (e) {
        setMatchups([]);
        setLoadError(e instanceof Error ? e.message : "Unknown error");
      }
    });
  }

  function goTo(nextWeek: number) {
    if (nextWeek < 1 || nextWeek > MAX_WEEK || nextWeek === week || isPending) return;
    setWeek(nextWeek);
    load(nextWeek);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-wide uppercase">
          {season} — Week {week}
        </h1>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => goTo(week - 1)}
            disabled={week <= 1 || isPending}
            aria-label="Previous week"
            className="rounded-full px-3 py-1 text-xl text-black/40 transition-colors hover:bg-black/5 hover:text-black disabled:pointer-events-none disabled:opacity-20 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => goTo(week + 1)}
            disabled={week >= MAX_WEEK || isPending}
            aria-label="Next week"
            className="rounded-full px-3 py-1 text-xl text-black/40 transition-colors hover:bg-black/5 hover:text-black disabled:pointer-events-none disabled:opacity-20 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white"
          >
            ›
          </button>
        </div>
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
          // Keyed by week so the carousel remounts and jumps straight to
          // the target matchup — it only reads initialMatchupId on mount.
          <MatchupCarousel
            key={week}
            matchups={matchups}
            initialMatchupId={targetMatchupId}
            onActiveMatchupChange={(m) => {
              focusOwnerIdRef.current = m.home.owner_id;
            }}
          />
        )}
      </div>
    </div>
  );
}
