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
import { TickerStrip } from "@/components/LiveTicker";
import { GameDayRefresher } from "@/components/GameDayRefresher";
import { LeagueTickerSlot } from "@/components/LeagueTickerSlot";

/**
 * The persistent site-wide ticker(s) — used only by app/(app)/layout.tsx,
 * i.e. every page except / (which renders its own richer, contextual
 * ticker — see app/(home)/page.tsx), /weekend (outside every route
 * group entirely, gets no ticker at all), and /chat (its own route
 * group, app/(chat)/layout.tsx — dropped on purpose so the
 * conversation list/thread gets the most vertical room available).
 * Two strips: real NFL scores
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

  let leagueItems: ReturnType<typeof buildLeagueTickerItems> = [];
  let leagueFast = isGameDay;
  if (latestSeason !== null) {
    const { current_week } = await getCurrentWeek(latestSeason);
    const week = resolveWeek(current_week);
    const ticker = await getWeekLeagueTicker(latestSeason, week, sessionCookie);
    const items = buildLeagueTickerItems(ticker);
    if (items.length > 0) {
      leagueItems = items;
    } else {
      // No matchup has started yet — real NFL kickoff is still the
      // more honest "second ticker" than nothing at all, so the strip
      // reads as "the league is live, here's when" instead of quietly
      // disappearing for the entire pre-kickoff stretch of a real game
      // week (2026-09 reported).
      const countdownItem = buildKickoffCountdownItem(nflGames, week);
      if (countdownItem) {
        leagueItems = [countdownItem];
        leagueFast = false;
      }
    }
  }

  return (
    <div className="wl-ticker-bar safe-px mx-auto flex w-full max-w-4xl flex-col gap-1.5 pt-3">
      {/* The Lounge's look (2026-10): two slim strips labelled NFL and
          LEAGUE. The labels also do what the old "This Week, Live"
          header did — make the league strip read as this week's
          games, not the matchup a page below might be showing. Both
          still auto-scroll, drag to find a game, and stay tappable. */}
      <div className={`overflow-hidden rounded-xl border bg-[#0d1016] ${isGameDay ? "border-red-500/50" : "border-white/10"}`}>
        <TickerStrip label="NFL" labelColor="#9aa3b2" items={nflTickerItems} fast={isGameDay} tint="rgba(255,255,255,0.03)" />
        {leagueItems.length > 0 && (
          <LeagueTickerSlot>
            <TickerStrip
              label="LEAGUE"
              labelColor="var(--user-accent, var(--wl-accent))"
              items={leagueItems}
              fast={leagueFast}
              tint="rgba(57,255,20,0.04)"
            />
          </LeagueTickerSlot>
        )}
      </div>
      {isGameDay && <GameDayRefresher />}
    </div>
  );
}
