// The home tickers' items, built the same way as the web's
// (frontend/src/lib/api.ts buildNflTickerItems / buildLeagueTickerItems
// / buildKickoffCountdownItem, and (home)/page.tsx buildTickerItems).
import { nflTeamColor } from '@/lib/nflTeams';
import type { LeagueTickerItem, NflGame, StandingsRow, WeekMatchupContextItem, WeeklyAwards } from '@/lib/types';

export type TickerSegment = { text: string; color?: string };
// `game` (an NFL game's teams) opens its Gamecast when tapped;
// `matchupId` opens that league matchup.
export type TickerItem = {
  key: string;
  segments: TickerSegment[];
  game?: { home: string; away: string };
  matchupId?: number;
};

function team(abbr: string): TickerSegment {
  const color = nflTeamColor(abbr);
  return color ? { text: abbr, color } : { text: abbr };
}

export function buildNflTickerItems(games: NflGame[]): TickerItem[] {
  const items: TickerItem[] = [];
  for (const g of games) {
    if (!g.home_team || !g.away_team) continue;
    const game = { home: g.home_team, away: g.away_team };
    if (g.state === 'in') {
      items.push({
        key: g.id,
        game,
        segments: [
          team(g.away_team),
          { text: ` ${g.away_score} — ` },
          team(g.home_team),
          { text: ` ${g.home_score} (${g.status_detail ?? 'Live'})` },
        ],
      });
    } else if (g.state === 'post') {
      items.push({
        key: g.id,
        game,
        segments: [team(g.away_team), { text: ` ${g.away_score} — ` }, team(g.home_team), { text: ` ${g.home_score} Final` }],
      });
    } else {
      items.push({
        key: g.id,
        game,
        segments: [team(g.away_team), { text: ' @ ' }, team(g.home_team), { text: ` — ${g.status_detail ?? 'Upcoming'}` }],
      });
    }
  }
  return items;
}

// NFL scores, then league storylines: rivalry games, and once games
// have been played, the week's headline awards and the league leader.
export function buildTickerItems(
  games: NflGame[],
  awards: WeeklyAwards | null,
  standings: StandingsRow[],
  weekPlayed: boolean,
  rivalryGames: WeekMatchupContextItem[],
): TickerItem[] {
  const items = buildNflTickerItems(games);
  const text = (key: string, body: string) => items.push({ key, segments: [{ text: body }] });

  rivalryGames.slice(0, 2).forEach((m, i) => {
    text(`rivalry-${i}`, `⚔️ Rivalry Alert: ${m.rivalry?.name ?? `${m.home.team_name} vs ${m.away.team_name}`}`);
  });

  if (weekPlayed && awards) {
    if (awards.game_of_the_week) {
      text(
        'gotw',
        `⭐ Game of the Week: ${awards.game_of_the_week.winner} ${awards.game_of_the_week.tie ? 'tied' : 'won'} ${awards.game_of_the_week.score}`,
      );
    }
    if (awards.overachiever) {
      text('overachiever', `📈 ${awards.overachiever.team_name} overachieved by +${awards.overachiever.diff.toFixed(1)}`);
    }
    if (awards.biggest_bench_crime) {
      text(
        'bench-crime',
        `💀 Biggest Bench Crime: ${awards.biggest_bench_crime.team_name} left ${awards.biggest_bench_crime.bench_player} on the bench`,
      );
    }
    if (awards.boom_leaders[0]) {
      text('boom', `🔥 ${awards.boom_leaders[0].player_name} boomed for ${awards.boom_leaders[0].points_scored.toFixed(1)}`);
    }
  }

  if (standings[0]) text('leader', `👑 ${standings[0].team_name} leads the league`);
  if (items.length === 0) text('empty', 'The Weekend — check back once games kick off');
  return items;
}

function leagueSide(name: string, score: number | null, top: LeagueTickerItem['home_top_scorer']): string {
  const scoreText = score !== null ? score.toFixed(1) : '—';
  const topText = top ? ` (⭐ ${top.player_name} ${top.points_scored.toFixed(1)})` : '';
  return `${name} ${scoreText}${topText}`;
}

export function buildLeagueTickerItems(items: LeagueTickerItem[]): TickerItem[] {
  return items.map((m) => ({
    key: `league-${m.matchup_id}`,
    matchupId: m.matchup_id,
    segments: [
      {
        text: `${leagueSide(m.home_team_name, m.home_score, m.home_top_scorer)} vs ${leagueSide(m.away_team_name, m.away_score, m.away_top_scorer)}`,
      },
    ],
  }));
}

function formatCountdown(targetIso: string): string {
  const diffMs = new Date(targetIso).getTime() - Date.now();
  if (diffMs <= 0) return 'now';
  const days = Math.floor(diffMs / 86_400_000);
  const hours = Math.floor((diffMs % 86_400_000) / 3_600_000);
  if (days >= 1) return `in ${days} day${days > 1 ? 's' : ''}${hours > 0 ? ` ${hours}h` : ''}`;
  const minutes = Math.floor((diffMs % 3_600_000) / 60_000);
  if (hours >= 1) return `in ${hours}h ${minutes}m`;
  return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

// Before any league matchup starts, the second ticker counts down to
// the week's first real kickoff instead of sitting empty.
export function buildKickoffCountdownItem(games: NflGame[], week: number): TickerItem | null {
  const upcoming = games
    .filter((g): g is NflGame & { date: string } => g.state === 'pre' && g.date !== null)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];
  if (!upcoming) return null;
  return { key: 'kickoff-countdown', segments: [{ text: `Week ${week} kicks off ${formatCountdown(upcoming.date)}` }] };
}
