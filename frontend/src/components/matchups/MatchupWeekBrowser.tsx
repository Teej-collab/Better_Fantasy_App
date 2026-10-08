"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { getWeekMatchupContextClient, type WeekMatchupContextItem } from "@/lib/api";
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
      {/* One pill-shaped week stepper instead of a big heading with faint
          arrows off to the side — the arrows sit inside the pill as real
          buttons so it reads at a glance as "tap to change weeks." */}
      <div className="flex items-center justify-between gap-3">
        <div
          className="flex w-fit min-w-0 items-center gap-1 rounded-full p-1"
          style={{ background: "var(--wl-surface)", border: "1px solid var(--wl-border)" }}
        >
          <button
            type="button"
            onClick={() => goTo(week - 1)}
            disabled={week <= 1 || isPending}
            aria-label={`Previous week (Week ${week - 1})`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/5 text-xl leading-none transition-colors hover:bg-black/10 active:scale-95 disabled:pointer-events-none disabled:opacity-25 dark:bg-white/10 dark:hover:bg-white/20"
          >
            ‹
          </button>
          <h1 className="flex min-w-0 items-baseline gap-2 px-3 font-display tracking-wide uppercase">
            <span className="text-xs font-semibold text-black/50 dark:text-white/50">{season}</span>
            <span className="text-lg font-semibold whitespace-nowrap">Week {week}</span>
          </h1>
          <button
            type="button"
            onClick={() => goTo(week + 1)}
            disabled={week >= MAX_WEEK || isPending}
            aria-label={`Next week (Week ${week + 1})`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/5 text-xl leading-none transition-colors hover:bg-black/10 active:scale-95 disabled:pointer-events-none disabled:opacity-25 dark:bg-white/10 dark:hover:bg-white/20"
          >
            ›
          </button>
        </div>
        {/* Right side of the same row as the week stepper. Off the current
            week, the "back" link stacks under the status pill so the row
            stays one line even on a phone. */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          {week === currentWeek ? (
            <span
              className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-wide uppercase"
              style={{
                color: "var(--user-accent, var(--wl-accent))",
                background: "color-mix(in srgb, var(--user-accent, var(--wl-accent)) 14%, transparent)",
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--user-accent, var(--wl-accent))" }}
                aria-hidden
              />
              Current week
            </span>
          ) : (
            <>
              <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-[11px] font-bold tracking-wide text-black/50 uppercase dark:bg-white/10 dark:text-white/60">
                {week < currentWeek ? "Past week" : "Upcoming week"}
              </span>
              <button
                type="button"
                onClick={() => goTo(currentWeek)}
                disabled={isPending}
                className="text-xs font-semibold disabled:opacity-50"
                style={{ color: "var(--user-accent, var(--wl-accent))" }}
              >
                Back to Week {currentWeek} →
              </button>
            </>
          )}
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
            matchups={ordered}
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
