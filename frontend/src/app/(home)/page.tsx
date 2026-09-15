import type { ReactNode } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import {
  buildKickoffCountdownItem,
  buildNflTickerItems,
  getChugFeed,
  getChugLeaderboard,
  getCurrentWeek,
  getMe,
  getMyPreferences,
  getMyWeek,
  getNflScoreboard,
  getStandings,
  getWeekMatchupContext,
  getWeeklyAwards,
  getWeeklyRecap,
  isNflGameLive,
  buildLeagueTickerItems,
  getActiveLeagueName,
  getChugDeadline,
  getWeekLeagueTicker,
  getWeekPowerRankings,
  listRivalries,
  listSeasons,
  resolveWeek,
  safeLatestSeason,
  type ChugDeadline,
  type ChugFeedEntry,
  type ChugLeaderboardRow,
  type Rivalry,
  type StandingsRow,
  type TickerItem,
  type WeekMatchupContextItem,
  type WeekPowerRanking,
  type WeeklyAwards,
  type WeeklyNarrative,
  type YourWeek,
} from "@/lib/api";
import { MovementBadge } from "@/components/MovementBadge";
import { ChugCountdownCard } from "@/components/ChugCountdownCard";
import { ChugDueCard } from "@/components/ChugDueCard";
import { ChugFeed } from "@/components/ChugFeed";
import { DraftCountdownCard } from "@/components/DraftCountdownCard";
import { GameDayRefresher } from "@/components/GameDayRefresher";
import { HomeCardDeck } from "@/components/HomeCardDeck";
import { HomePageBeta } from "@/components/HomePageBeta";
import { HomeWelcomeBackEntry } from "@/components/HomeWelcomeBackEntry";
import { LiveTicker } from "@/components/LiveTicker";
import { OpeningExperience } from "@/components/OpeningExperience";
import { WeekRecapSection } from "@/components/WeekRecapSection";
import { WeeklyRecapTeaser } from "@/components/WeeklyRecapTeaser";
import { findGamecastId, getLiveGames, withGamecastLinks } from "@/lib/gamecastApi";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";
import {
  DESTINATION_HREF,
  DESTINATIONS,
  LEAGUE_SUBNAV_ORDER,
  type DestinationKey,
} from "@/lib/navDestinations";

// Lower = shown first — same escalating hierarchy as the /weekend signs'
// tier-colored badges (MatchupCard.tsx's TIER_BADGE_CLASS).
const TIER_RANK: Record<string, number> = { Legendary: 0, Historic: 1, Developing: 2 };

// A week with nothing to award yet still comes back as a real
// WeeklyAwards object, every field null/empty rather than the request
// itself failing — this is what "no real data" looks like, used to
// decide whether to fall back to the previous week's awards below.
const EMPTY_WEEKLY_AWARDS: WeeklyAwards = {
  overachiever: null,
  meltdown: null,
  biggest_bench_crime: null,
  clutch: null,
  choke: null,
  boom_leaders: [],
  bust_leaders: [],
  game_of_the_week: null,
};

function hasAwardsData(awards: WeeklyAwards): boolean {
  return (
    awards.game_of_the_week !== null ||
    awards.overachiever !== null ||
    awards.meltdown !== null ||
    awards.biggest_bench_crime !== null ||
    awards.clutch !== null ||
    awards.choke !== null ||
    awards.boom_leaders.length > 0 ||
    awards.bust_leaders.length > 0
  );
}

export default async function HomePage() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;

  // getMe and listSeasons don't read each other's result — fetched
  // together instead of one-then-the-other, the first of three merges
  // in this function that cut its real sequential round-trips from
  // ~7 down to 3 (2026-09 load-time pass — this page runs on every
  // single fresh app open, so each hop removed here is felt everywhere).
  // getMe still has to be the thing that decides the early return below;
  // listSeasons's result just rides along for free.
  const [me, { seasons }] = await Promise.all([getMe(sessionCookie), listSeasons()]);

  // Mandatory front door: a signed-out visitor sees the Weekend League
  // opening/auth experience instead of the dashboard below, and none of
  // this page's other data gets fetched for them at all. See
  // OpeningExperience.tsx.
  if (!me) {
    const [nflGames, gamecastGames] = await Promise.all([getNflScoreboard(), getLiveGames()]);
    return (
      <OpeningExperience
        tickerItems={withGamecastLinks(buildNflTickerItems(nflGames), nflGames, gamecastGames)}
        isGameDay={isNflGameLive(nflGames)}
      />
    );
  }

  const season = safeLatestSeason(seasons);

  // Second merge: getCurrentWeek only ever needed `season` (known the
  // instant the batch above resolves), never anything from myWeek/
  // nflGames/etc — folded in here instead of its own later hop. Stays
  // "no real current week" (current_week: null) for exactly the same
  // no-season/no-active-league case resolveWeek's caller below already
  // handled, just resolved a hop earlier.
  const [myWeek, nflGames, gamecastGames, activeLeagueName, myPreferences, currentWeekRes] = await Promise.all([
    getMyWeek(sessionCookie),
    getNflScoreboard(),
    getLiveGames(),
    getActiveLeagueName(sessionCookie),
    getMyPreferences(sessionCookie),
    season !== null && me.active_league_id !== null
      ? getCurrentWeek(season)
      : Promise.resolve({ current_week: null as number | null }),
  ]);
  const isGameDay = isNflGameLive(nflGames);
  // Settings > Labs > "Try the new look" — see LabsSection.tsx and
  // Documentation/UX/06_Implementation_Roadmap.md section 0. HomePageBeta
  // gets the same fetched data as the legacy render below; it's a
  // separate component (not a threaded-through boolean) so the legacy
  // path stays completely untouched.
  const betaLayout = Boolean(myPreferences?.beta_layout);

  let week: number | null = null;
  let standings: StandingsRow[] = [];
  let weeklyAwards: WeeklyAwards | null = null;
  let weekPlayed = false;
  let weekMatchups: WeekMatchupContextItem[] = [];
  let topRivalries: Rivalry[] = [];
  let leagueTickerItems: TickerItem[] = [];
  let myChug: ChugLeaderboardRow | null = null;
  let chugDeadline: ChugDeadline | null = null;
  let powerRankings: WeekPowerRanking[] = [];
  let weeklyRecap: WeeklyNarrative | null = null;
  let weeklyRecapWeek: number | null = null;
  let weeklyAwardsWeek: number | null = null;
  let chugFeed: ChugFeedEntry[] = [];

  // Every one of these now requires real active-league membership
  // (require_league_access, 2026-09 audit) — a signed-in account with
  // no active league yet (just joined via email/Google, hasn't picked
  // a league on /leagues) sees the dashboard shell with none of this,
  // same as the "no season synced yet" case below, rather than a
  // crashed page from an unhandled 409.
  if (season !== null && me.active_league_id !== null) {
    week = resolveWeek(currentWeekRes.current_week);
    // Third merge: chugDeadline never depended on anything in THIS batch
    // either (only on myWeek.draft.status, already known from the batch
    // above) — it used to run as its own sequential hop after this
    // whole batch finished; now it's just one more entry in it, gated
    // the same "only once the draft's actually done" way as before (see
    // cards.chugCountdown below — no reason to hit ESPN's live
    // scoreboard for a league that hasn't drafted).
    const wantsPostDraftData = myWeek?.draft?.status === "complete";
    const [
      standingsRes,
      awardsRes,
      prevWeekAwardsRes,
      matchupContextRes,
      rivalriesRes,
      leagueTicker,
      chugRes,
      powerRankingsRes,
      chugDeadlineRes,
      weekRecapRes,
      prevWeekRecapRes,
      chugFeedRes,
    ] = await Promise.all([
      getStandings(season, sessionCookie),
      getWeeklyAwards(season, week, sessionCookie),
      // Same idea as the recap's own week/week-1 pair below: a fresh
      // week (Tue/Wed after rollover, before its own Thursday games)
      // has nothing real to award yet — falling back to the week that
      // just wrapped keeps real awards on screen right up until the new
      // week has its own (2026-09-15 ask: "weekly awards from the
      // previous week should be displayed until Thursday" — this is
      // data-driven rather than a hardcoded day, so it naturally holds
      // exactly until the new week's first real games start producing
      // award-worthy data, whenever that happens to land).
      week > 1 ? getWeeklyAwards(season, week - 1, sessionCookie) : Promise.resolve(EMPTY_WEEKLY_AWARDS),
      getWeekMatchupContext(season, week, sessionCookie),
      listRivalries(sessionCookie),
      getWeekLeagueTicker(season, week, sessionCookie),
      getChugLeaderboard(sessionCookie, season),
      getWeekPowerRankings(season, week, sessionCookie),
      wantsPostDraftData ? getChugDeadline(sessionCookie) : Promise.resolve(null),
      // Checks the active `week` itself, IN ADDITION to week-1 below —
      // not instead of it. Once a week's own real games are all final,
      // its recap becomes eligible immediately
      // (app/domain/narrative_engine.py's _resolve_weekly_kind), fully
      // independent of whether league_state.current_week (a separate,
      // sometimes-lagging counter — see that module's own docstring)
      // has rolled over past it yet. Real report, 2026-09-15: checking
      // only week-1 left the homepage showing nothing at all for the
      // entire stretch between "this week's games all went final" and
      // "the app's own current-week counter finally rolled over" —
      // querying `week` too covers exactly that gap, including week 1
      // itself (week - 1 would be 0, never valid).
      week !== null ? getWeeklyRecap(season, week, sessionCookie) : Promise.resolve({ narrative: null }),
      week !== null && week > 1 ? getWeeklyRecap(season, week - 1, sessionCookie) : Promise.resolve({ narrative: null }),
      getChugFeed(sessionCookie, season),
    ]);
    standings = standingsRes.standings;
    // Prefer the active week's own awards once it has any real data;
    // fall back to the week that just wrapped otherwise (see the
    // prevWeekAwardsRes fetch above).
    if (hasAwardsData(awardsRes)) {
      weeklyAwards = awardsRes;
      weeklyAwardsWeek = week;
    } else if (hasAwardsData(prevWeekAwardsRes)) {
      weeklyAwards = prevWeekAwardsRes;
      weeklyAwardsWeek = week - 1;
    }
    weekMatchups = matchupContextRes.matchups;
    powerRankings = powerRankingsRes.rankings;
    // Prefer the active week's own recap once eligible (see the
    // getWeeklyRecap comment above); fall back to the prior week's
    // once league_state.current_week has actually rolled over, and
    // `week` itself is a fresh, not-yet-recap-eligible week.
    if (weekRecapRes.narrative?.kind === "recap") {
      weeklyRecap = weekRecapRes.narrative;
      weeklyRecapWeek = week;
    } else if (prevWeekRecapRes.narrative?.kind === "recap") {
      weeklyRecap = prevWeekRecapRes.narrative;
      weeklyRecapWeek = week !== null ? week - 1 : null;
    }
    weekPlayed = standings.some((r) => r.wins + r.losses + r.ties > 0);
    topRivalries = [...rivalriesRes.rivalries]
      .sort((a, b) => TIER_RANK[a.tier ?? ""] - TIER_RANK[b.tier ?? ""])
      .slice(0, 3);
    leagueTickerItems = buildLeagueTickerItems(leagueTicker);
    if (leagueTickerItems.length === 0) {
      // No matchup has started yet — real NFL kickoff is still the more
      // honest "second ticker" than nothing at all for the entire
      // pre-kickoff stretch of a real game week (2026-09 reported).
      const countdownItem = buildKickoffCountdownItem(nflGames, week);
      if (countdownItem) leagueTickerItems = [countdownItem];
    }
    myChug = chugRes.leaderboard.find((row) => row.owner_id === me.owner_id) ?? null;
    chugDeadline = chugDeadlineRes;
    chugFeed = chugFeedRes.chugs;
  }

  // "Other" = every matchup except the logged-in owner's own (already
  // shown in the hero above). When logged out, myWeek is null and
  // nothing gets excluded — every matchup is "other".
  const otherMatchups = weekMatchups.filter((m) => m.matchup_id !== myWeek?.matchup?.matchup_id);
  const rivalryGamesThisWeek = weekMatchups.filter((m) => m.is_rivalry);

  const tickerItems = withGamecastLinks(
    buildTickerItems(nflGames, weeklyAwards, standings, weekPlayed, rivalryGamesThisWeek),
    nflGames,
    gamecastGames
  );

  // The homepage's cards. Six of them (yourWeek/standings/matchups/
  // rivalries/awards/discover) are owner-reorderable via HomeCardDeck
  // below (brought back 2026-09-04, reorder-only — see that
  // component's own comment); draftCountdown/gamecast/chug are
  // time-sensitive and stay pinned in a fixed spot instead. A card
  // only ever ends up in this map when it has something real to show
  // this week.
  const cards: Record<string, ReactNode> = {};

  cards.yourWeek = myWeek?.matchup ? (
      <YourWeekHero myWeek={myWeek} isGameDay={isGameDay} />
    ) : myWeek ? (
      <EmptyHero
        title={myWeek.team_name}
        message={
          // ESPN reports current_week as 0 during preseason — not a real
          // week, same convention as the Team page's fallback.
          myWeek.week === null || myWeek.week < 1
            ? "No matchup yet — the season hasn't started."
            : "No matchup this week (bye week or the schedule isn't set yet)."
        }
      />
    ) : (
      // Reaching this branch means /me/week itself failed even though
      // getMe (above) confirmed a valid session — in practice this is
      // almost always a signed-up-but-league-less account (email/Google
      // signup creates a bare user row with no owner_id until they join
      // or create a league on /leagues; see backend/app/routers/me.py's
      // 404 "No team found for this owner"), not a transient fetch
      // error. This used to say "try refreshing," which can never
      // resolve that case — a real dead end for exactly the audience
      // self-serve signup exists to open the door to. Pointing at
      // /leagues is right even in the rare genuine-transient-error case:
      // still a real, working next step, not a worse one.
      <EmptyHero
        title="Your Week"
        message="You're signed in, but not on a team yet."
        cta={{ href: "/leagues", label: "Join or create a league →" }}
      />
    );

  // Its own standalone card now, not a substitute for the Your Week
  // hero above (which used to show this in place of an EmptyHero when
  // there was no live matchup) — real, current state right now
  // (pre-draft, pre-season) deserves its own persistent spot on the
  // homepage rather than only appearing when the hero happens to have
  // nothing else to show. Same condition as before: a real draft date
  // set, draft not yet started.
  if (myWeek?.draft?.scheduled_start && myWeek.draft.status === "not_started") {
    cards.draftCountdown = (
      <DraftCountdownCard teamName={myWeek.team_name} scheduledStart={myWeek.draft.scheduled_start} />
    );
  } else if (chugDeadline?.deadline) {
    // Takes over the same top slot once the draft's done — Jeffrey's
    // Rule is relevant every week of the season from here on, not just
    // a one-time pre-draft moment. See ChugCountdownCard.tsx. deadline
    // is null (this card just doesn't render at all) until Week 1
    // actually finishes and the season's first real chug debt exists —
    // before that there's nothing owed by anyone yet, regardless of
    // what the calendar's next Monday happens to be (2026-09-12 report).
    cards.draftCountdown = <ChugCountdownCard deadline={chugDeadline.deadline} isPast={chugDeadline.is_past} />;
  }

  if (standings.length > 0) {
    cards.standings = (
      <section className="flex flex-col gap-2">
        <SectionHeader title="League Standings" href="/standings" />
        <ol
          className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]"
          style={panelGlowStyle(SECTION_COLORS.standings)}
        >
          {standings.slice(0, 5).map((row, i) => (
            <li key={row.team_id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm transition-colors">
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-4 shrink-0 text-black/50 tabular-nums dark:text-white/50">{i + 1}</span>
                <span className="truncate">{row.team_name}</span>
              </span>
              <span className="shrink-0 tabular-nums text-black/60 dark:text-white/60">
                {row.wins}-{row.losses}
                {row.ties ? `-${row.ties}` : ""}
              </span>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  if (powerRankings.length === 0 && !weekPlayed && season !== null) {
    // Power rank is a real, computed-from-actual-scores composite (see
    // app/domain/weekly_team_stats.py) — it has nothing to rank on
    // until the first real game of the season finishes, same reason
    // the dedicated /power-rankings page shows "no data yet" right
    // now. A silent missing card reads as broken; a real "not yet"
    // message doesn't, same call already made for the pre-kickoff
    // ticker fallback below.
    cards.powerRankings = (
      <section className="flex flex-col gap-2">
        <SectionHeader title="Power Rankings" href="/power-rankings" />
        <div
          className="neon-panel rounded-lg bg-black/[0.015] px-4 py-3 text-sm text-black/50 dark:bg-white/[0.03] dark:text-white/50"
          style={panelGlowStyle(SECTION_COLORS.powerRankings)}
        >
          Power rankings will appear here once this week&apos;s games have been played.
        </div>
      </section>
    );
  }

  if (powerRankings.length > 0) {
    cards.powerRankings = (
      <section className="flex flex-col gap-2">
        <SectionHeader title="Power Rankings" href="/power-rankings" />
        <ol
          className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]"
          style={panelGlowStyle(SECTION_COLORS.powerRankings)}
        >
          {powerRankings.slice(0, 5).map((row) => (
            <li
              key={row.team_id}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm transition-colors"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-4 shrink-0 font-bold text-black/50 tabular-nums dark:text-white/50">
                  {row.power_rank}
                </span>
                <span className="truncate">{row.team_name}</span>
              </span>
              <span className="shrink-0 text-xs tabular-nums">
                <MovementBadge movement={row.movement} />
              </span>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  if (otherMatchups.length > 0) {
    cards.matchups = (
      <section className="flex flex-col gap-2">
        {/* Lands on the carousel already positioned on another matchup
            (see MatchupCarousel.tsx) — swiping from there reaches every
            other matchup this week instantly, replacing the old
            dedicated week-list page this used to link to. */}
        <SectionHeader title="Other Matchups" href={`/matchups/${otherMatchups[0].matchup_id}`} />
        <ul
          className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]"
          style={panelGlowStyle(SECTION_COLORS.matchups)}
        >
          {otherMatchups.map((m) => {
            const started =
              m.home.score !== null && m.away.score !== null && !(m.home.score === 0 && m.away.score === 0);
            return (
              <li key={m.matchup_id}>
                <Link
                  href={`/matchups/${m.matchup_id}`}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm transition-colors hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex items-center gap-1.5">
                      {isGameDay && started && <span className="live-dot" aria-hidden />}
                      {m.is_game_of_the_week && <span title="Game of the Week">⭐</span>}
                      {m.is_rivalry && <span title={m.rivalry?.name}>{m.rivalry?.emoji ?? "⚔️"}</span>}
                      <span className="truncate">{m.home.team_name}</span>
                    </span>
                    <span className="truncate text-black/50 dark:text-white/50">{m.away.team_name}</span>
                  </span>
                  <span className="shrink-0 text-right tabular-nums text-black/70 dark:text-white/70">
                    <span className="block">{m.home.score !== null ? m.home.score.toFixed(1) : "—"}</span>
                    <span className="block">{m.away.score !== null ? m.away.score.toFixed(1) : "—"}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  // "Live Now" — every real NFL game currently in progress, linking
  // into its own Gamecast when one exists (findGamecastId, same join
  // the ticker above already uses — zero extra fetches, nflGames/
  // gamecastGames are both already fetched for this request). Hidden
  // entirely outside a live window (isGameDay), matching every other
  // live-only element on this page (GameDayRefresher, the ticker's
  // "Game Day" badge) — a quiet homepage on a non-game day stays quiet.
  const liveNflGames = isGameDay ? nflGames.filter((g) => g.state === "in") : [];
  if (liveNflGames.length > 0) {
    cards.gamecast = (
      <section className="flex flex-col gap-2">
        <SectionHeader title="Live Now" href="/gamecast" />
        <GamecastPreview games={liveNflGames} gamecastGames={gamecastGames} />
      </section>
    );
  }

  if (myChug) {
    cards.chug = <ChugDueCard summary={myChug} />;
  }

  if (rivalryGamesThisWeek.length > 0 || topRivalries.length > 0) {
    cards.rivalries = (
      <section className="flex flex-col gap-2">
        <SectionHeader title="Rivalries" href="/rivalries" />
        {rivalryGamesThisWeek.length > 0 ? (
          <ul
            className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]"
            style={panelGlowStyle(SECTION_COLORS.rivalries)}
          >
            {rivalryGamesThisWeek.map((m) => (
              <li key={m.matchup_id}>
                <Link
                  href={`/matchups/${m.matchup_id}`}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm transition-colors hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span>{m.rivalry?.emoji ?? "⚔️"}</span>
                    <span className="truncate font-medium">{m.rivalry?.name}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-black/50 dark:text-white/50">
                    {m.head_to_head.wins_home}-{m.head_to_head.wins_away}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <ul
            className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]"
            style={panelGlowStyle(SECTION_COLORS.rivalries)}
          >
            {topRivalries.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span>{r.emoji ?? "⚔️"}</span>
                  <span className="truncate font-medium">{r.name}</span>
                </span>
                <span className="shrink-0 tabular-nums text-black/50 dark:text-white/50">
                  {r.owner_a_name} {r.all_time_wins_a}-{r.all_time_wins_b} {r.owner_b_name}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  if (weeklyAwards && season !== null && week !== null) {
    cards.awards = (
      <section className="flex flex-col gap-2">
        <SectionHeader
          title={weeklyAwardsWeek === week ? "This Week's Awards" : `Week ${weeklyAwardsWeek} Awards`}
          href={`/seasons/${season}/awards`}
        />
        <AwardsPreview awards={weeklyAwards} />
        {season !== null && week !== null && (
          weeklyRecap && weeklyRecapWeek !== null ? (
            <WeeklyRecapTeaser recap={weeklyRecap} week={weeklyRecapWeek} />
          ) : (
            // Nothing generated yet (the scheduler's own week-settlement
            // job auto-generates this once the week is over — see
            // app/scheduler.py's _run_week_settlement_job — but a
            // brand-new week's write-up can still be worth a manual
            // nudge/regenerate). Same component the week's own page
            // already uses for this — commissioner-only, exactly like
            // there. Targets the active week itself — that's exactly
            // eligible the instant its games are all final, regardless
            // of whether current_week has rolled over yet.
            me.is_commissioner && <WeekRecapSection season={season} week={week} narrative={null} canGenerate />
          )
        )}
      </section>
    );
  }

  if (chugFeed.length > 0) {
    cards.chugFeed = <ChugFeed chugs={chugFeed} />;
  }

  cards.discover = <DiscoveryGrid />;

  if (betaLayout) {
    return (
      <HomeWelcomeBackEntry displayName={me.display_name} needsLeague={me.active_league_id === null}>
        <HomePageBeta
          myWeek={myWeek}
          isGameDay={isGameDay}
          tickerItems={tickerItems}
          leagueTickerItems={leagueTickerItems}
          activeLeagueName={activeLeagueName}
          standings={standings}
          powerRankings={powerRankings}
          season={season}
          otherMatchups={otherMatchups}
          currentWeek={week}
          rivalryGamesThisWeek={rivalryGamesThisWeek}
          topRivalries={topRivalries}
          weeklyAwards={weeklyAwards}
          weeklyAwardsWeek={weeklyAwardsWeek}
          weeklyRecap={weeklyRecap}
          weeklyRecapWeek={weeklyRecapWeek}
          isCommissioner={me.is_commissioner}
          chugFeed={chugFeed}
          liveNflGames={liveNflGames}
          gamecastGames={gamecastGames}
          draftCountdownOrChugCard={cards.draftCountdown ?? null}
        />
      </HomeWelcomeBackEntry>
    );
  }

  return (
    <HomeWelcomeBackEntry displayName={me.display_name} needsLeague={me.active_league_id === null}>
      <div className="flex flex-col gap-6">
        {/* Fixed behind everything, ignores PageShell's centered column so
            it washes the full viewport — three soft brand-colored glows,
            restrained compared to /weekend's full neon treatment per the
            brief ("neon as accent, not the whole design"). This is the
            fix for the homepage reading as a flat black-and-white screen. */}
        <div className="home-ambient" aria-hidden />
        {isGameDay && <GameDayRefresher />}

        <div className="rise-in">
          <div className="flex items-center gap-2">
            <span className={isGameDay ? "live-dot" : "live-dot live-dot--idle"} aria-hidden />
            <span className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
              The Weekend Live
            </span>
            {isGameDay && (
              <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-red-500 uppercase">
                Game Day
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-col gap-2">
            <LiveTicker items={tickerItems} fast={isGameDay} />
            {leagueTickerItems.length > 0 && (
              <div className="flex flex-col gap-1">
                {activeLeagueName && (
                  <span className="text-[10px] font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
                    {activeLeagueName}
                  </span>
                )}
                <LiveTicker items={leagueTickerItems} fast={isGameDay} />
              </div>
            )}
          </div>
        </div>

        {/* Leads the whole page, above even Your Week, whenever it's
            showing — real, time-sensitive content that's also temporary
            by nature, unlike every other card here. Draft Countdown
            occupies this slot pre-draft; the moment the draft is done it
            hands the same slot to Chug Countdown (Jeffrey's Rule), which
            then stays relevant every week for the rest of the season.
            Earning the top slot while it's relevant beats sitting below
            the fold underneath cards that are still there every week. */}
        {cards.draftCountdown}
        {cards.gamecast}
        {cards.chug}

        {/* Owner-reorderable: Your Week, Standings, Power Rankings,
            Matchups, Rivalries, Awards, Discover — same full-width
            `gap-6` stacking this page already used for Rivalries/
            Awards/Discover, on every breakpoint, so drag order behaves
            the same on mobile and desktop. See HomeCardDeck.tsx. */}
        <HomeCardDeck
          cards={{
            yourWeek: cards.yourWeek,
            standings: cards.standings,
            powerRankings: cards.powerRankings,
            matchups: cards.matchups,
            rivalries: cards.rivalries,
            awards: cards.awards,
            chugFeed: cards.chugFeed,
            discover: cards.discover,
          }}
        />
      </div>
    </HomeWelcomeBackEntry>
  );
}


function buildTickerItems(
  nflGames: Awaited<ReturnType<typeof getNflScoreboard>>,
  awards: WeeklyAwards | null,
  standings: StandingsRow[],
  weekPlayed: boolean,
  rivalryGamesThisWeek: WeekMatchupContextItem[]
): TickerItem[] {
  const items = buildNflTickerItems(nflGames);
  const text = (key: string, body: string) => items.push({ key, segments: [{ text: body }] });

  rivalryGamesThisWeek.slice(0, 2).forEach((m, i) => {
    text(`rivalry-${i}`, `⚔️ Rivalry Alert: ${m.rivalry?.name ?? `${m.home.team_name} vs ${m.away.team_name}`}`);
  });

  if (weekPlayed && awards) {
    if (awards.game_of_the_week) {
      text("gotw", `⭐ Game of the Week: ${awards.game_of_the_week.winner} won ${awards.game_of_the_week.score}`);
    }
    if (awards.overachiever) {
      text("overachiever", `📈 ${awards.overachiever.team_name} overachieved by +${awards.overachiever.diff.toFixed(1)}`);
    }
    if (awards.biggest_bench_crime) {
      text(
        "bench-crime",
        `💀 Biggest Bench Crime: ${awards.biggest_bench_crime.team_name} left ${awards.biggest_bench_crime.bench_player} on the bench`
      );
    }
    if (awards.boom_leaders[0]) {
      text("boom", `🔥 ${awards.boom_leaders[0].player_name} boomed for ${awards.boom_leaders[0].points_scored.toFixed(1)}`);
    }
  }

  if (standings[0]) {
    text("leader", `👑 ${standings[0].team_name} leads the league`);
  }

  if (items.length === 0) {
    text("empty", "The Weekend — check back once games kick off");
  }

  return items;
}

function YourWeekHero({ myWeek, isGameDay }: { myWeek: YourWeek; isGameDay: boolean }) {
  const m = myWeek.matchup!;
  const winning = m.my_score !== null && m.opponent_score !== null && m.my_score >= m.opponent_score;
  const isLive = m.started && isGameDay;

  return (
    <section
      className={`flex flex-col gap-3 rounded-xl bg-gradient-to-br from-neutral-900 via-black to-black p-4 text-white ${
        isLive ? "hero-live-glow border border-red-500/50" : "neon-panel"
      }`}
    >
      <div className="flex items-center justify-between">
        <span
          className="flex items-center gap-1.5 text-xs font-bold tracking-wide uppercase"
          style={{ color: isLive ? "rgba(255,255,255,0.5)" : "var(--your-week-color, var(--user-accent, var(--wl-accent)))" }}
        >
          Your Week{m.is_playoff ? " — Playoffs" : ""}
          {isLive && (
            <span className="flex items-center gap-1 rounded-full bg-red-500/15 px-1.5 py-0.5 text-red-400">
              <span className="live-dot" aria-hidden />
              Live
            </span>
          )}
        </span>
        {m.record && <span className="text-xs text-white/50">{m.record}</span>}
      </div>

      <div className="flex items-center justify-between gap-3">
        <TeamScoreBlock name={myWeek.team_name} score={m.my_score} projected={m.my_projected_total} lead={winning} />
        <span className="shrink-0 text-white/30">vs</span>
        <TeamScoreBlock
          name={m.opponent_team_name}
          score={m.opponent_score}
          projected={m.opponent_projected_total}
          lead={!winning}
          align="right"
        />
      </div>

      {m.win_probability !== null && (
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-xs text-white/50">
            <span>Win probability</span>
            <span>{m.win_probability}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-sky-400" style={{ width: `${m.win_probability}%` }} />
          </div>
        </div>
      )}

      <Link href={`/matchups/${m.matchup_id}`} className="text-sm text-sky-300 hover:underline">
        View full matchup →
      </Link>
    </section>
  );
}

function TeamScoreBlock({
  name,
  score,
  projected,
  lead,
  align = "left",
}: {
  name: string;
  score: number | null;
  projected: number;
  lead: boolean;
  align?: "left" | "right";
}) {
  return (
    <div className={`flex min-w-0 flex-col ${align === "right" ? "items-end text-right" : "items-start"}`}>
      <span className="max-w-[10rem] truncate text-sm text-white/70 sm:max-w-[14rem]">{name}</span>
      <span
        className={`score-pop text-2xl font-bold tabular-nums sm:text-3xl ${lead ? "text-white" : "text-white/60"}`}
      >
        {score !== null ? score.toFixed(1) : "—"}
      </span>
      <span className="text-xs text-white/40 tabular-nums">Proj {projected.toFixed(1)}</span>
    </div>
  );
}

function EmptyHero({
  title,
  message,
  cta,
}: {
  title: string;
  message: string;
  cta?: { href: string; label: string };
}) {
  return (
    <section
      className="neon-panel flex flex-col gap-1.5 rounded-xl p-4"
      style={{
        background: `linear-gradient(160deg, color-mix(in srgb, var(--your-week-color, var(--user-accent, var(--wl-accent))) 14%, transparent), color-mix(in srgb, var(--your-week-color, var(--user-accent, var(--wl-accent))) 2%, transparent))`,
        borderColor: `color-mix(in srgb, var(--your-week-color, var(--user-accent, var(--wl-accent))) 40%, transparent)`,
      }}
    >
      <span
        className="text-xs font-bold tracking-wide uppercase"
        style={{ color: "var(--your-week-color, var(--user-accent, var(--wl-accent)))" }}
      >
        Your Week
      </span>
      <span className="font-display text-lg font-semibold tracking-wide uppercase">{title}</span>
      <p className="text-sm text-black/50 dark:text-white/50">{message}</p>
      {cta && (
        <Link
          href={cta.href}
          className="mt-1 text-sm font-semibold"
          style={{ color: "var(--your-week-color, var(--user-accent, var(--wl-accent)))" }}
        >
          {cta.label}
        </Link>
      )}
    </section>
  );
}


type Tile = { emoji: string; label: string; accent: string; title: string; subtitle: string };

// One tile per real award field — every one of these is genuine
// computed data (app/domain/weekly_awards.py), not placeholder copy.
// Accent colors are thematic (hot/cold, good/bad), deliberately
// separate from the six section-nav colors (Standings/Matchups/etc.)
// so awards read as their own distinct "entertainment" category.
function buildAwardTiles(awards: WeeklyAwards): Tile[] {
  const tiles: Tile[] = [];

  if (awards.game_of_the_week) {
    tiles.push({
      emoji: "⭐",
      label: "Game of the Week",
      accent: "text-amber-500",
      title: awards.game_of_the_week.winner,
      subtitle: `Won ${awards.game_of_the_week.score}`,
    });
  }
  if (awards.boom_leaders[0]) {
    const b = awards.boom_leaders[0];
    tiles.push({
      emoji: "🔥",
      label: "Boom of the Week",
      accent: "text-orange-500",
      title: b.player_name,
      subtitle: `${b.points_scored.toFixed(1)} pts — ${b.team_name}`,
    });
  }
  if (awards.bust_leaders[0]) {
    const b = awards.bust_leaders[0];
    tiles.push({
      emoji: "🥶",
      label: "Bust of the Week",
      accent: "text-sky-500",
      title: b.player_name,
      subtitle: `${b.points_scored.toFixed(1)} pts — ${b.team_name}`,
    });
  }
  if (awards.biggest_bench_crime) {
    const bc = awards.biggest_bench_crime;
    tiles.push({
      emoji: "💀",
      label: "Biggest Bench Crime",
      accent: "text-slate-500",
      title: `${bc.bench_player} > ${bc.started_player}`,
      subtitle: `+${bc.points_diff.toFixed(1)} pts (${bc.severity}) — ${bc.team_name}`,
    });
  }
  if (awards.overachiever) {
    tiles.push({
      emoji: "📈",
      label: "Overachiever",
      accent: "text-emerald-500",
      title: awards.overachiever.team_name,
      subtitle: `+${awards.overachiever.diff.toFixed(1)} pts vs. expected`,
    });
  }
  if (awards.meltdown) {
    tiles.push({
      emoji: "📉",
      label: "Meltdown",
      accent: "text-red-500",
      title: awards.meltdown.team_name,
      subtitle: `${awards.meltdown.diff.toFixed(1)} pts vs. expected`,
    });
  }
  if (awards.clutch) {
    tiles.push({
      emoji: "🎯",
      label: "Clutch",
      accent: "text-teal-500",
      title: awards.clutch.team_name,
      subtitle: awards.clutch.reason,
    });
  }
  if (awards.choke) {
    tiles.push({
      emoji: "😬",
      label: "Choke",
      accent: "text-purple-500",
      title: awards.choke.team_name,
      subtitle: awards.choke.reason,
    });
  }

  return tiles;
}

export function AwardsPreview({ awards }: { awards: WeeklyAwards }) {
  const tiles = buildAwardTiles(awards);
  if (tiles.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {tiles.map((t, i) => (
        <div
          key={i}
          className="flex flex-col gap-0.5 rounded-lg border border-black/10 bg-black/[0.015] p-3 shadow-sm transition-transform active:scale-[0.98] dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none"
        >
          <span className={`flex items-center gap-1 text-[10px] font-semibold tracking-wide uppercase ${t.accent}`}>
            {t.emoji} {t.label}
          </span>
          <span className="truncate text-sm font-medium">{t.title}</span>
          <span className="truncate text-xs text-black/50 dark:text-white/50">{t.subtitle}</span>
        </div>
      ))}
    </div>
  );
}

// The homepage's "Live Now" card — every currently-live real NFL game,
// as compact score chips, each linking into its own Gamecast when one
// exists. Deliberately reuses nflGames/gamecastGames this page already
// fetched for its own ticker (no new data source), and the same
// findGamecastId join withGamecastLinks already relies on — this is
// just that same join applied to a card instead of a ticker item.
function GamecastPreview({
  games,
  gamecastGames,
}: {
  games: Awaited<ReturnType<typeof getNflScoreboard>>;
  gamecastGames: Awaited<ReturnType<typeof getLiveGames>>;
}) {
  return (
    <ul
      className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]"
      style={panelGlowStyle(SECTION_COLORS.gamecast)}
    >
      {games.map((g) => {
        const gamecastId = findGamecastId(g.home_team, g.away_team, gamecastGames);
        const row = (
          <>
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="live-dot" aria-hidden />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm">
                  {g.away_team ?? "—"} @ {g.home_team ?? "—"}
                </span>
                <span className="truncate text-xs text-black/50 dark:text-white/50">{g.status_detail}</span>
              </span>
            </span>
            <span className="shrink-0 text-right tabular-nums text-black/70 dark:text-white/70">
              <span className="block">{g.home_score ?? "—"}</span>
              <span className="block">{g.away_score ?? "—"}</span>
            </span>
          </>
        );
        return (
          <li key={g.id}>
            {gamecastId ? (
              <Link
                href={`/gamecast/${gamecastId}`}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm transition-colors hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10"
              >
                {row}
              </Link>
            ) : (
              <span className="flex items-center justify-between gap-3 px-3 py-2 text-sm">{row}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// Used to lead with a colored dot (a holdover from when every section
// had its own hardcoded hue) — dropped 2026-08-31 to match the
// approved mock's plain section labels exactly, now that there's
// nothing left for a per-section dot to distinguish.
function SectionHeader({ title, href }: { title: string; href: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 hover:underline">
      <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">{title}</h2>
    </Link>
  );
}

type DiscoveryTile = { href: string; label: string; description: string; color: string };

// One line of custom copy per tile — the one thing LEAGUE_SUBNAV_ORDER
// itself doesn't carry (a pill label is enough context in a nav row;
// a homepage tile wants a real description). Every League-family
// destination needs an entry here except the one excluded below, so a
// newly-added one (like Power Rankings was) doesn't silently show up
// with blank/missing copy.
const DISCOVER_DESCRIPTIONS: Partial<Record<DestinationKey, string>> = {
  standings: "Full league standings and records",
  rivalries: "All-time rivalry history and grudges",
  rules: "Scoring, roster, and league settings",
  powerRankings: "Who's actually good this week, plus Luck and Strength of Schedule",
  history: "Awards, trading cards, and the lifetime Chug leaderboard",
};

// Derived from LEAGUE_SUBNAV_ORDER (lib/navDestinations.ts) — the same
// list League's own sub-nav, Home's Discover tiles here, and
// /weekend's vacancy signs all read from now, instead of each keeping
// its own hand-copied subset that drifts out of sync the moment
// something new (like Power Rankings) gets added to just one of them.
// "league" is excluded here specifically: it's already a top-level tab
// on both PrimaryNav and BottomNav, so a Discover tile for it would be
// a redundant second way to reach the exact same place one tap away
// already. Everything else in LEAGUE_SUBNAV_ORDER is a genuine
// shortcut that would otherwise require detouring through League's own
// sub-nav first — that now includes "history" (Awards/Player Cards/
// Chug's old individual entries collapsed into it 2026-09-02), which
// gets a Discover tile the same as every other real destination in the
// list.
const DISCOVER_EXCLUDED = new Set<DestinationKey>(["league"]);

// Gamecast is a primary-nav destination on desktop (PrimaryNav.tsx) but
// isn't in the mobile bottom bar's fixed 5 slots (see
// lib/navDestinations.ts) — this tile is how a mobile visitor reaches
// it at all outside a live ticker link. Not derived from
// LEAGUE_SUBNAV_ORDER like the tiles below since Gamecast isn't a
// League-family destination.
const GAMECAST_TILE: DiscoveryTile = {
  href: "/gamecast",
  label: "Gamecast",
  description: "Live play-by-play for this week's real NFL games",
  color: DESTINATIONS.gamecast.color,
};

function DiscoveryGrid() {
  const tiles: DiscoveryTile[] = [
    GAMECAST_TILE,
    ...LEAGUE_SUBNAV_ORDER.filter((key) => !DISCOVER_EXCLUDED.has(key)).map((key) => ({
      href: DESTINATION_HREF[key]!,
      label: DESTINATIONS[key].label,
      description: DISCOVER_DESCRIPTIONS[key] ?? DESTINATIONS[key].label,
      color: DESTINATIONS[key].color,
    })),
  ];

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Discover</h2>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tiles.map((t) => (
          <DiscoveryTileCard key={t.href} {...t} />
        ))}
      </div>
    </section>
  );
}

function DiscoveryTileCard({ href, label, description, color }: DiscoveryTile) {
  return (
    <Link
      href={href}
      className="neon-panel flex flex-col gap-0.5 rounded-lg bg-black/[0.015] p-3 transition-all hover:bg-black/5 active:scale-[0.98] active:bg-black/10 dark:bg-white/[0.03] dark:hover:bg-white/5 dark:active:bg-white/10"
      style={panelGlowStyle(color)}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">
        {/* Reads --ring-color (set on the .neon-panel ancestor above,
            inherited down) rather than this tile's own `color` prop
            directly — that resolves to the tile's real destination
            color in Cosmic (via panelGlowStyle above) but the owner's
            own Border Animation/Accent Color in Calm, same as the
            moving ring around the tile, instead of a flat NAV_ACCENT
            dot that never matched what panelGlowStyle already made the
            ring do. */}
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: "var(--ring-color)", boxShadow: "0 0 5px var(--ring-color)" }}
          aria-hidden
        />
        {label}
      </span>
      <span className="truncate text-xs text-black/50 dark:text-white/50">{description}</span>
    </Link>
  );
}
