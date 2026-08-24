import {
  buildLeagueTickerItems,
  buildNflTickerItems,
  getCurrentWeek,
  getNflScoreboard,
  getWeekLeagueTicker,
  isNflGameLive,
  listSeasons,
  type NflGame,
  type TickerItem,
} from "@/lib/api";
import { findGamecastId, getLiveGames, type GamecastLiveGameSummary } from "@/lib/gamecastApi";
import { LiveTicker } from "@/components/LiveTicker";
import { GameDayRefresher } from "@/components/GameDayRefresher";

// Links an NFL ticker item to its Gamecast, when one exists for that
// game — matched by team-abbreviation pair (see findGamecastId).
// Additive only: an item with no Gamecast match is returned unchanged,
// so a Gamecast outage or empty live-games list never breaks the
// scoreboard ticker itself.
function withGamecastLinks(items: TickerItem[], nflGames: NflGame[], liveGameIds: GamecastLiveGameSummary[]): TickerItem[] {
  const byId = new Map(nflGames.map((g) => [g.id, g]));
  return items.map((item) => {
    const nflGame = byId.get(item.key);
    const gamecastId = nflGame ? findGamecastId(nflGame.home_team, nflGame.away_team, liveGameIds) : null;
    return gamecastId ? { ...item, href: `/gamecast/${gamecastId}` } : item;
  });
}

/**
 * The persistent site-wide ticker(s) — used only by app/(app)/layout.tsx,
 * i.e. every page except / (which renders its own richer, contextual
 * ticker — see app/(home)/page.tsx) and /weekend (outside both route
 * groups entirely, gets no ticker at all). Two strips: real NFL scores
 * (not the homepage's awards/rivalries/standings mix, since that only
 * makes sense in the homepage's own context), and — when the league
 * has a current week with real matchups — a second strip of this
 * week's own league scores plus each owner's own top scorer, from the
 * lightweight /ticker endpoint (app/domain/league_ticker.py).
 *
 * listSeasons()/getCurrentWeek() are the same calls NavBar.tsx already
 * makes for its own matchups link — Next's per-request fetch
 * memoization means adding them here doesn't cost a second round trip.
 *
 * Mounts GameDayRefresher during a live window the same way the
 * homepage does — without it, these tickers (unlike the homepage's)
 * were a one-time server-rendered snapshot that only ever changed on a
 * fresh navigation, so a score from an hour ago could sit there
 * indefinitely on a page nobody navigated away from.
 */
export async function AppTickerBar() {
  const [nflGames, { seasons }, gamecastGames] = await Promise.all([
    getNflScoreboard(),
    listSeasons(),
    getLiveGames(),
  ]);
  const isGameDay = isNflGameLive(nflGames);
  const latestSeason = seasons.length > 0 ? Math.max(...seasons) : null;
  const nflTickerItems = withGamecastLinks(buildNflTickerItems(nflGames), nflGames, gamecastGames);

  let leagueTicker = null;
  if (latestSeason !== null) {
    const { current_week } = await getCurrentWeek(latestSeason);
    const week = current_week && current_week >= 1 ? current_week : null;
    if (week !== null) {
      const ticker = await getWeekLeagueTicker(latestSeason, week);
      const items = buildLeagueTickerItems(ticker);
      if (items.length > 0) {
        leagueTicker = <LiveTicker items={items} fast={isGameDay} />;
      }
    }
  }

  return (
    <div className="safe-px mx-auto flex w-full max-w-4xl flex-col gap-2 pt-3">
      <LiveTicker items={nflTickerItems} fast={isGameDay} />
      {leagueTicker}
      {isGameDay && <GameDayRefresher />}
    </div>
  );
}
