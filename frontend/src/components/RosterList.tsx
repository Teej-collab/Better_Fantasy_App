import type { RosterPlayer } from "@/lib/api";

/**
 * Row list (not a <table>) so it works on a phone without horizontal
 * scrolling — slot + name on the left (name truncates if long), points
 * on the right. showProjected is off for matchup box scores (final
 * score only matters there) and on for the team roster page (upcoming
 * or in-progress weeks care about projections too).
 */
export function RosterList({
  title,
  players,
  showProjected = false,
}: {
  title: string;
  players: RosterPlayer[];
  showProjected?: boolean;
}) {
  if (players.length === 0) return null;
  return (
    <div>
      <h2 className="mb-1 text-sm font-medium text-black/60 dark:text-white/60">{title}</h2>
      <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
        {players.map((p, i) => (
          <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <span className="w-16 shrink-0 text-xs text-black/50 dark:text-white/50">{p.lineup_slot}</span>
              <span className="truncate">{p.player_name}</span>
            </div>
            <div className="flex shrink-0 gap-3 tabular-nums">
              {showProjected && (
                <span className="text-black/50 dark:text-white/50">
                  {p.points_projected !== null ? Number(p.points_projected).toFixed(1) : "—"}
                </span>
              )}
              <span className="w-10 text-right font-medium">
                {p.points_scored !== null ? Number(p.points_scored).toFixed(1) : "—"}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
