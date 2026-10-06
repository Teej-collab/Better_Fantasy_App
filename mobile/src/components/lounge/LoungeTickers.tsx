import { TickerStrips } from '@/components/TickerStrips';
import { clockLabel, useDelayedValue } from '@/lib/loungeLive';
import { useLeagueTicker, useNflScoreboard, useSeasonWeek } from '@/lib/queries';
import { buildLeagueTickerItems, buildNflTickerItems } from '@/lib/ticker';
import type { LiveGame, NflGame } from '@/lib/types';

// The Lounge's two slim strips: NFL scores, and (signed into a league)
// this week's league scores. The game on the room's TV shows its
// delayed score — the same moment the TV is at — and the league strip
// lags by the room's delay too, so fantasy points from the TV's game
// never land before the play does.
export function LoungeTickers({ tvGame, delaySeconds }: { tvGame: LiveGame | null; delaySeconds: number }) {
  const games = useNflScoreboard().data ?? [];
  const { season = null, week = null } = useSeasonWeek().data ?? {};
  const league = useDelayedValue(useLeagueTicker(season, week).data, delaySeconds) ?? [];

  const nflItems = buildNflTickerItems(games.map((g) => withTvScore(g, tvGame)));
  const leagueItems = buildLeagueTickerItems(league);

  // The same strips as every other screen (TickerStrips), so they can be
  // swiped too — taps off, so a game doesn't pull you out of the room.
  return <TickerStrips nfl={nflItems} league={leagueItems} fast interactive={false} framed={false} />;
}

function withTvScore(g: NflGame, tv: LiveGame | null): NflGame {
  if (!tv || g.id !== tv.game_id) return g;
  return {
    ...g,
    home_score: String(tv.home_team.score),
    away_score: String(tv.away_team.score),
    state: tv.status === 'final' ? 'post' : tv.status === 'scheduled' ? 'pre' : 'in',
    status_detail: clockLabel(tv),
  };
}
