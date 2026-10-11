import { useState } from 'react';

// The Lounge with no game on the TV: your own starters' big moments from
// any game — a touchdown, or a single jump of 5+ fantasy points — picked
// out by comparing each refresh of your matchup to the last one (the
// same numbers My Team shows). Mirrors frontend/src/lib/rosterMoments.ts.

export const BIG_PLAY_POINTS = 5;

type Starter = {
  player_id: number | string | null;
  player_name: string;
  position: string | null;
  pro_team: string | null;
  points_scored: number | null;
  raw_stats: Record<string, number> | null;
};

export type RosterMoment = {
  id: string;
  playerName: string;
  position: string | null;
  proTeam: string | null;
  points: number;
  touchdown: boolean;
  at: number;
};

// Every Sleeper touchdown stat (pass_td, rush_td, rec_td, def_td, kr_td…).
function touchdowns(stats: Record<string, number> | null): number {
  if (!stats) return 0;
  return Object.entries(stats).reduce((n, [k, v]) => (k.endsWith('_td') ? n + (Number(v) || 0) : n), 0);
}

/** New roster moments as `starters` refreshes; the first load only sets
 *  the baseline. `key` (the matchup) resets it. Off when `enabled` is
 *  false — with a game on the TV, its play-by-play covers moments.
 *  Compared while rendering (React's 'adjust state when a prop changes'
 *  pattern), keyed on the numbers themselves so re-renders are free. */
export function useRosterMoments(key: string | number | null, starters: Starter[] | null, enabled: boolean): RosterMoment[] {
  const [seen, setSeen] = useState<{ sig: string; key: string | number | null; byPlayer: Map<string, { points: number; tds: number }>; moments: RosterMoment[] }>({
    sig: '',
    key: null,
    byPlayer: new Map(),
    moments: [],
  });
  if (!starters || key === null) return seen.moments;
  const byPlayer = new Map(starters.filter((p) => p.player_id !== null).map((p) => [String(p.player_id), { points: p.points_scored ?? 0, tds: touchdowns(p.raw_stats) }]));
  const sig = `${key}|${[...byPlayer].map(([id, v]) => `${id}:${v.points}:${v.tds}`).join(',')}`;
  if (sig !== seen.sig) {
    const found: RosterMoment[] = [];
    if (seen.key === key && enabled) {
      const at = new Date().getTime();
      for (const p of starters) {
        const before = seen.byPlayer.get(String(p.player_id));
        const after = byPlayer.get(String(p.player_id));
        if (!before || !after) continue;
        const gained = after.points - before.points;
        const touchdown = after.tds > before.tds;
        if (!touchdown && gained < BIG_PLAY_POINTS) continue;
        found.push({ id: `${p.player_id}-${at}`, playerName: p.player_name, position: p.position, proTeam: p.pro_team, points: gained, touchdown, at });
      }
    }
    setSeen({ sig, key, byPlayer, moments: found.length ? [...seen.moments, ...found].slice(-20) : seen.moments });
  }
  return seen.moments;
}
