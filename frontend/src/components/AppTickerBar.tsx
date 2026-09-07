import { cookies } from "next/headers";
import {
  buildKickoffCountdownItem,
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
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;

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
    const ticker = await getWeekLeagueTicker(latestSeason, week, sessionCookie);
    const items = buildLeagueTickerItems(ticker);
    if (items.length > 0) {
      leagueTicker = <LiveTicker items={items} fast={isGameDay} />;
    } else {
      // No matchup has started yet — real NFL kickoff is still the
      // more honest "second ticker" than nothing at all, so the strip
      // reads as "the league is live, here's when" instead of quietly
      // disappearing for the entire pre-kickoff stretch of a real game
      // week (2026-09 reported).
      const countdownItem = buildKickoffCountdownItem(nflGames, week);
      if (countdownItem) {
        leagueTicker = <LiveTicker items={[countdownItem]} fast={false} />;
      }
    }
  }

  return (
    <div className="safe-px mx-auto flex w-full max-w-4xl flex-col gap-1.5 pt-3">
      {/* This ticker used to carry no label at all anywhere it's shown
          (every (app) page except Home, which has its own richer,
          labeled version) — confusing on its own, and a real, specific
          problem on the matchup detail page: the league ticker's
          current-week scores can share a team name with a *past* week's
          matchup being viewed right below it, reading as "the score is
          stuck at 0" rather than "this is an unrelated, current game"
          (2026-08-31 audit). A small "This Week, Live" label makes the
          ticker legible as its own thing on every page it appears on,
          not just the one where the collision was actually noticed. */}
      <div className="flex items-center gap-1.5">
        <span className={isGameDay ? "live-dot" : "live-dot live-dot--idle"} aria-hidden />
        <span className="text-[10px] font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
          This Week, Live
        </span>
      </div>
      <LiveTicker items={nflTickerItems} fast={isGameDay} />
      {leagueTicker}
      {isGameDay && <GameDayRefresher />}
    </div>
  );
}
