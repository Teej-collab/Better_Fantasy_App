import type { WeekMatchupContextItem } from "@/lib/api";

/**
 * The viewer's own team always reads on the left (2026-09-25 ask —
 * the homepage's Your Week card already puts "me" on the left, and the
 * full matchup page used to flip to the right whenever ESPN had the
 * viewer as the away team). Swaps home/away — and every home/away-keyed
 * field alongside them (head-to-head tallies, recent meetings, the
 * rivalry's all-time wins) — when the viewer owns the away side.
 * Matchups the viewer isn't in come back untouched.
 */
export function orientMatchupForViewer(m: WeekMatchupContextItem, viewerOwnerId: number): WeekMatchupContextItem {
  if (m.away.owner_id !== viewerOwnerId || m.home.owner_id === viewerOwnerId) return m;
  const h2h = m.head_to_head;
  return {
    ...m,
    home: m.away,
    away: m.home,
    rivalry: m.rivalry
      ? { ...m.rivalry, all_time_wins_home: m.rivalry.all_time_wins_away, all_time_wins_away: m.rivalry.all_time_wins_home }
      : null,
    head_to_head: {
      ...h2h,
      wins_home: h2h.wins_away,
      wins_away: h2h.wins_home,
      recent_meetings: h2h.recent_meetings.map((g) => ({
        ...g,
        home_won: !g.tie && !g.home_won,
        home_score: g.away_score,
        away_score: g.home_score,
      })),
    },
  };
}
