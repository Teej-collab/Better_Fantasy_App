import { useDelayedValue } from '@/lib/loungeLive';
import { orientMatchupForViewer } from '@/lib/matchups';
import { useBets, useMatchup, useMatchupContext, useMe, useMyWeek } from '@/lib/queries';
import type { Bet, LiveGame, RosterPlayer, WeekMatchupContextItem } from '@/lib/types';

// Everything "Your Sweat" (mockups 1 and 3) shows — your matchup, both
// lineups, your open bets, and the rest of the league — held back by the
// room's delay so fantasy points from the TV's game don't land before
// the play does on the TV.
export type LoungeSweat = {
  ready: boolean;
  myTeamName: string | null;
  opponentName: string | null;
  myScore: number;
  opponentScore: number;
  myProjected: number | null;
  opponentProjected: number | null;
  winPct: number | null;
  myStarters: RosterPlayer[];
  opponentStarters: RosterPlayer[];
  openBets: Bet[];
  league: WeekMatchupContextItem[];
};

const BENCH = new Set(['BE', 'IR']);

export function useLoungeSweat(delaySeconds: number): LoungeSweat {
  const me = useMe().data;
  const week = useDelayedValue(useMyWeek().data, delaySeconds);
  const matchupId = week?.matchup?.matchup_id ?? 0;
  const detailQuery = useMatchup(matchupId);
  const detail = useDelayedValue(matchupId ? detailQuery.data : undefined, delaySeconds);
  const bets = useDelayedValue(useBets().data, delaySeconds);
  const league = useDelayedValue(useMatchupContext(week?.season ?? null, week?.week ?? null).data, delaySeconds);

  const oriented = detail ? orientMatchupForViewer(detail, me?.owner_id ?? null) : null;
  const m = week?.matchup ?? null;
  return {
    ready: !!m,
    myTeamName: week?.team_name ?? null,
    opponentName: m?.opponent_team_name ?? null,
    myScore: m?.my_score ?? 0,
    opponentScore: m?.opponent_score ?? 0,
    myProjected: m?.my_projected_total ?? null,
    opponentProjected: m?.opponent_projected_total ?? null,
    winPct: m?.win_probability ?? null,
    myStarters: (oriented?.home.roster ?? []).filter((p) => !BENCH.has(p.lineup_slot ?? '')),
    opponentStarters: (oriented?.away.roster ?? []).filter((p) => !BENCH.has(p.lineup_slot ?? '')),
    openBets: (bets?.bets ?? []).filter((b) => b.status === 'open'),
    league: league?.matchups ?? [],
  };
}

/** Your starters playing in the TV's game. */
export function startersInGame(starters: RosterPlayer[], game: LiveGame | null): RosterPlayer[] {
  if (!game) return [];
  const teams = new Set([game.home_team.abbr, game.away_team.abbr]);
  return starters.filter((p) => p.pro_team && teams.has(p.pro_team));
}

/** "on the field" when the player's team has the ball (skill players). */
export function onField(player: RosterPlayer, game: LiveGame | null): boolean {
  return !!game && game.status === 'in_progress' && player.pro_team === game.possession_team_abbr && player.position !== 'DEF' && player.position !== 'K';
}

/** Short name: "Patrick Mahomes" → "Mahomes". */
export function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : name;
}
