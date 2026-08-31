import type { RosterPlayer } from "@/lib/api";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";

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
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-black/60 dark:text-white/60">{title}</h2>
        <div className="flex gap-3 text-xs text-black/40 dark:text-white/40">
          {showProjected && <span className="w-10 text-right">Proj</span>}
          <span className="w-10 text-right">Final</span>
        </div>
      </div>
      <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
        {players.map((p, i) => (
          <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <span className="w-16 shrink-0 text-xs text-black/50 dark:text-white/50">{p.lineup_slot}</span>
              <PlayerHeadshot playerId={p.player_id} proTeam={p.pro_team} name={p.player_name} size={28} />
              <span className="truncate">{p.player_name}</span>
              {p.is_boom && (
                <span title="Boom performance" aria-hidden>
                  {"\u{1F525}"}
                </span>
              )}
              {p.is_bust && (
                <span title="Bust performance" aria-hidden>
                  {"\u{1F976}"}
                </span>
              )}
            </div>
            <div className="flex shrink-0 gap-3 tabular-nums">
              {showProjected && (
                <span className="w-10 text-right text-black/50 dark:text-white/50">
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
