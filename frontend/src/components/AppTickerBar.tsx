import {
  buildLeagueTickerItems,
  buildNflTickerItems,
  getCurrentWeek,
  getNflScoreboard,
  getWeekLeagueTicker,
  isNflGameLive,
  listSeasons,
  resolveWeek,
  safeLatestSeason,
} from "@/lib/api";
import { getLiveGames, withGamecastLinks } from "@/lib/gamecastApi";
import { LiveTicker } from "@/components/LiveTicker";
import { GameDayRefresher } from "@/components/GameDayRefresher";

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
  const latestSeason = safeLatestSeason(seasons);
  const nflTickerItems = withGamecastLinks(buildNflTickerItems(nflGames), nflGames, gamecastGames);

  let leagueTicker = null;
  if (latestSeason !== null) {
    const { current_week } = await getCurrentWeek(latestSeason);
    const week = resolveWeek(current_week);
    const ticker = await getWeekLeagueTicker(latestSeason, week);
    const items = buildLeagueTickerItems(ticker);
    if (items.length > 0) {
      leagueTicker = <LiveTicker items={items} fast={isGameDay} />;
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
