"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { getWeekMatchupContextClient, type WeekMatchupContextItem } from "@/lib/api";
import { WeekPlate } from "@/components/elite/Elite";
import { MatchupCarousel } from "@/components/matchups/MatchupCarousel";
import { orientMatchupForViewer } from "@/components/matchups/orientMatchup";
import { useOnAppRefresh } from "@/lib/usePullToRefresh";

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
  currentWeek,
}: {
  season: number;
  initialWeek: number;
  initialMatchups: WeekMatchupContextItem[];
  initialMatchupId: number;
  myOwnerId: number;
  // The league's live fantasy week (league_state.current_week, already
  // resolved to >= 1) — drives the Current / Past / Upcoming label so
  // paging back through old weeks never reads as "this week."
  currentWeek: number;
}) {
  const [week, setWeek] = useState(initialWeek);
  const [matchups, setMatchups] = useState(initialMatchups);
  // Your own game is always the first chip and slide; the rest follow in
  // the league's order.
  const ordered = useMemo(() => {
    const mine = (m: WeekMatchupContextItem) => m.home.owner_id === myOwnerId || m.away.owner_id === myOwnerId;
    return [...matchups.filter(mine), ...matchups.filter((m) => !mine(m))];
  }, [matchups, myOwnerId]);
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

  // Pull-to-refresh / live game-day ticks: re-pull the week on screen in
  // place. matchups is local state seeded once from initialMatchups, so
  // without this a live score here never moved after first render. A
  // failed background refresh keeps the scores already showing rather
  // than blanking them into an error.
  useOnAppRefresh(() =>
    getWeekMatchupContextClient(season, week)
      .then(({ matchups: raw }) => setMatchups(raw.map((m) => orientMatchupForViewer(m, myOwnerId))))
      .catch(() => {})
  );

  function goTo(nextWeek: number) {
    if (nextWeek < 1 || nextWeek > MAX_WEEK || nextWeek === week || isPending) return;
    setWeek(nextWeek);
    load(nextWeek);
  }

  return (
    <div className="flex flex-col gap-2.5">
      {/* The elite pass's LED week plate (2026-10-31), with the way back
          to this week under it when you've paged away. */}
      <div className="flex flex-col items-center gap-1.5">
        <WeekPlate
          label={`${season} · WEEK ${week}`}
          status={week === currentWeek ? "● CURRENT WEEK" : week < currentWeek ? "PAST WEEK" : "UPCOMING WEEK"}
          live={week === currentWeek}
          onPrev={() => goTo(week - 1)}
          onNext={() => goTo(week + 1)}
          prevDisabled={week <= 1 || isPending}
          nextDisabled={week >= MAX_WEEK || isPending}
        />
        {week !== currentWeek && (
          <button type="button" onClick={() => goTo(currentWeek)} disabled={isPending} className="text-xs font-semibold text-[#39ff14] disabled:opacity-50">
            Back to Week {currentWeek} →
          </button>
        )}
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
            matchups={ordered}
            initialMatchupId={targetMatchupId}
            myOwnerId={myOwnerId}
            onActiveMatchupChange={(m) => {
              focusOwnerIdRef.current = m.home.owner_id;
            }}
          />
        )}
      </div>
    </div>
  );
}
