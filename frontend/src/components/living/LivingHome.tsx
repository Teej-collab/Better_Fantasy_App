"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ChugCountdownCard } from "@/components/ChugCountdownCard";
import { LeagueActivityFeed } from "@/components/LeagueActivityFeed";
import { WeeklyRecapTeaser } from "@/components/WeeklyRecapTeaser";
import { YourWeekCard } from "@/components/YourWeekCard";
import {
  ByePlannerCard,
  ClaimResultsCard,
  DeadlinesCard,
  FreeAgentsCard,
  InjuryReportCard,
  KickoffCard,
  LeagueScoreboardCard,
  LoungeCard,
  NextOpponentCard,
  PlayersNowCard,
  PositionEdgeCard,
  PowerMoveCard,
  ProjectionReportCard,
  RivalryResultCard,
  StandingsMoveCard,
  TradesCard,
  WaiversCountdownCard,
  WeekEndedCard,
  WhatIfCard,
} from "@/components/living/LivingCards";
import { Kicker, Panel } from "@/components/living/LivingParts";
import {
  GameWindowsCard,
  HeadStartCard,
  LineupFixCard,
  MatchupsAliveCard,
  OpponentIntelCard,
  StartSitCard,
  SwingPlayersCard,
  TonightGamesCard,
  TouchdownFeedCard,
  TurningPointsCard,
  WatchPartiesCard,
  WeatherCard,
  WhatYouNeedCard,
  type WinProbHistory,
} from "@/components/living/LivingTools";
import { WeekendBetsCard } from "@/components/living/WeekendBetsCard";
import type {
  ChatConversation,
  ChugDeadline,
  KeeperRules,
  LeagueActivityItem,
  MatchupContextSide,
  MyFreeAgent,
  MyTeam,
  MyWaiverClaims,
  NflGame,
  PlayoffOdds,
  PowerRankTrendTeam,
  StandingsRow,
  WaiverClaim,
  WatchPartyRoomsResponse,
  WeekMatchupContext,
  WeekMatchupContextItem,
  WeeklyNarrative,
  YourWeek,
} from "@/lib/api";
import type { Bet } from "@/lib/betsApi";
import { findGamecastId, type GamecastLiveGameSummary } from "@/lib/gamecastApi";
import {
  dayName,
  etDayHour,
  homePhase,
  inBetsWeekend,
  isStarter,
  nextEt,
  PHASE_COLOR,
  setHomeLayout,
  sideFor,
  startersPlayingToday,
  untilText,
  type HomePhase,
} from "@/lib/livingHome";
import type { Trade, TradeSettings } from "@/lib/tradesApi";
import { useOnAppRefresh } from "@/lib/usePullToRefresh";
import { startVisibleInterval } from "@/lib/visibleInterval";

// The Living Home on the website (2026-10-20): the same screen as the
// app's mobile/src/components/living/LivingHome.tsx, built from the saved
// Living Home layout — one screen that follows the fantasy week. The
// server page hands over what it already fetched for the classic home;
// the rest is fetched here through the /api/backend proxy.

const RECAP_GOLD = "#f5b942";
const SURFACE =
  "neon-panel bg-gradient-to-br from-[var(--wl-surface)] via-[var(--wl-bg)] to-[var(--wl-bg)]";
const LIVE_SURFACE =
  "hero-live-glow border border-red-500/50 bg-gradient-to-br from-[var(--wl-surface)] via-[var(--wl-bg)] to-[var(--wl-bg)]";

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`/api/backend${path}`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    // A card that can't load just doesn't show.
    return null;
  }
}

// GET through the /api/backend proxy; null path = not needed right now.
// Refetches on pull-to-refresh / game-day ticks, and every `pollMs`
// while the tab is visible.
function useBackend<T>(path: string | null, pollMs?: number): T | null {
  const [data, setData] = useState<{ path: string; value: T } | null>(null);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    const load = () =>
      getJson<T>(path).then((value) => {
        if (!cancelled && value !== null) setData({ path, value });
      });
    void load();
    const stop = pollMs ? startVisibleInterval(() => void load(), pollMs) : null;
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [path, pollMs]);
  useOnAppRefresh(() =>
    path
      ? getJson<T>(path).then((value) => {
          if (value !== null) setData({ path, value });
        })
      : undefined,
  );
  return data && data.path === path ? data.value : null;
}

// The clock, ticking each minute (countdowns, which day it is).
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// The claims settled by the most recent waiver run (same as the app's
// lib/waiverClaims.ts lastRun).
function lastRun(claims: WaiverClaim[]): WaiverClaim[] {
  const settled = claims
    .filter((c) => c.status !== "pending" && c.status !== "cancelled" && c.processed_at)
    .sort((a, b) => b.processed_at!.localeCompare(a.processed_at!));
  if (settled.length === 0) return [];
  const newest = new Date(settled[0].processed_at!).getTime();
  return settled.filter((c) => newest - new Date(c.processed_at!).getTime() < 60 * 60 * 1000);
}

// Last week's matchup in the Your Week card's own shape, so recap day
// can show last week's final in exactly the same card.
function lastWeekAsYourWeek(
  last: { item: WeekMatchupContextItem; me: MatchupContextSide; them: MatchupContextSide },
  week: number,
  base: YourWeek,
): YourWeek {
  const { item, me, them } = last;
  return {
    ...base,
    week,
    team_name: me.team_name,
    power_rank: me.power_rank,
    matchup: {
      ...base.matchup!,
      matchup_id: item.matchup_id,
      is_playoff: item.is_playoff,
      started: true,
      record: me.record,
      my_owner_name: me.owner_name,
      my_logo_url: me.logo_url,
      my_result_streak: me.result_streak,
      my_yet_to_play: 0,
      my_in_play: 0,
      my_score: me.score,
      my_projected_total: me.projected_total ?? me.score ?? 0,
      opponent_team_id: them.team_id,
      opponent_team_name: them.team_name,
      opponent_power_rank: them.power_rank,
      opponent_owner_name: them.owner_name,
      opponent_logo_url: them.logo_url,
      opponent_record: them.record,
      opponent_result_streak: them.result_streak,
      opponent_yet_to_play: 0,
      opponent_in_play: 0,
      opponent_score: them.score,
      opponent_projected_total: them.projected_total ?? them.score ?? 0,
      win_probability: me.win_probability,
    },
  };
}

function greeting(name: string | null, now: Date): string {
  const h = now.getHours();
  const part = h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening";
  return name ? `${part}, ${name}` : part;
}

function sameEtDate(iso: string | null, now: Date): boolean {
  if (!iso) return false;
  const a = etDayHour(new Date(iso));
  const b = etDayHour(now);
  return a.day === b.day && Math.abs(new Date(iso).getTime() - now.getTime()) < 24 * 3600_000;
}

export function LivingHome({
  me,
  season,
  week,
  myWeek,
  nflGames,
  gamecastGames,
  standings,
  weekMatchups,
  weeklyRecap,
  weeklyRecapWeek,
  chugDeadline,
  activeLeagueName,
  leagueActivity,
  isGameDay,
}: {
  me: { display_name: string | null; is_commissioner: boolean; owner_id: number };
  season: number;
  week: number;
  myWeek: YourWeek;
  nflGames: NflGame[];
  gamecastGames: GamecastLiveGameSummary[];
  standings: StandingsRow[];
  weekMatchups: WeekMatchupContextItem[];
  weeklyRecap: WeeklyNarrative | null;
  weeklyRecapWeek: number | null;
  chugDeadline: ChugDeadline | null;
  activeLeagueName: string | null;
  leagueActivity: LeagueActivityItem[];
  isGameDay: boolean;
}) {
  const router = useRouter();
  const now = useNow();
  const teamId = myWeek.team_id;
  const live = nflGames.some((g) => g.state === "in");
  const myTeam = useBackend<MyTeam>("/me/team", live ? 60_000 : undefined);
  const roster = myTeam?.roster ?? [];
  const claims = useBackend<MyWaiverClaims>("/me/team/waivers");
  const trend = useBackend<{ teams: PowerRankTrendTeam[] }>(`/seasons/${season}/power-rankings/trend`)?.teams ?? [];
  const odds = useBackend<{ odds: PlayoffOdds | null }>(`/seasons/${season}/playoffs/odds?team=${teamId}`)?.odds ?? null;
  const freeAgents = useBackend<{ players: MyFreeAgent[] }>("/me/team/free-agents")?.players ?? [];
  const trades = useBackend<{ trades: Trade[] }>("/trades/mine")?.trades ?? [];
  const tradeSettings = useBackend<TradeSettings>("/trades/settings");
  const keeperRules = useBackend<KeeperRules>("/keepers/rules");
  const conversations = useBackend<{ conversations: ChatConversation[] }>("/chat/conversations")?.conversations ?? [];
  const betsData = useBackend<{ enabled: boolean; bets: Bet[] }>(inBetsWeekend(now) ? "/bets" : null, 30_000);
  const bets = betsData?.bets ?? [];

  const phase: HomePhase = homePhase({ now, myWeek, games: nflGames, roster });
  const lastWeek = phase === "recap" && week > 1 ? week - 1 : null;
  const lastContext = useBackend<WeekMatchupContext>(lastWeek !== null ? `/seasons/${season}/weeks/${lastWeek}/matchup-context` : null);
  // Wednesday: everyone's moves from the overnight waiver run.
  const waiverActivity =
    useBackend<{ items: LeagueActivityItem[] }>(phase === "waivers" ? `/seasons/${season}/activity?limit=40` : null)?.items ?? [];
  const m = myWeek.matchup;
  const gameTime = phase === "sweat" || phase === "live" || phase === "final";
  const history = useBackend<WinProbHistory>(
    gameTime && m ? `/seasons/${season}/matchups/${m.matchup_id}/win-prob-history` : null,
    phase === "final" ? undefined : 30_000,
  );
  const rooms = useBackend<WatchPartyRoomsResponse>(phase === "live" ? "/watch-party/rooms" : null, 30_000);

  const refreshAll = () => router.refresh();
  const gamecastFor = (home: string | null, away: string | null) => findGamecastId(home, away, gamecastGames);

  const color = PHASE_COLOR[phase];
  const mine = sideFor(weekMatchups, teamId);
  const name = me.display_name;
  const day = dayName(now);
  const unread = conversations.reduce((sum, c) => sum + (c.unread_count ?? 0), 0);

  // Who to root for this week, from the What-If engine. Tuesday–Saturday
  // it's your playoff odds and what this week's result does to them;
  // Sunday–Monday, the other games to root for.
  const whatIfHalf = etDayHour(now).day <= 1 ? "root" : "odds";
  const whatIf = odds ? <WhatIfCard odds={odds} teamId={teamId} standings={standings} half={whatIfHalf} /> : null;
  const turning =
    history && mine ? <TurningPointsCard history={history} meIsHome={mine.item.home.team_id === teamId} opponent={mine.them.owner_name} /> : null;
  // Your bets, Thursday morning to Monday night, on whatever the mood is.
  const betsCard = inBetsWeekend(now) && betsData ? <WeekendBetsCard bets={bets} games={nflGames} enabled={betsData.enabled} /> : null;
  const tonightGames = nflGames.filter((g) => (g.state === "pre" || g.state === "in") && sameEtDate(g.date, now));

  // Recap day: last week's final until Wednesday's waivers start the new week.
  const last = phase === "recap" && lastContext ? sideFor(lastContext.matchups, teamId) : null;

  let header: { kicker: string; title: string; live?: boolean; right?: string };
  let body: ReactNode;

  switch (phase) {
    // Your matchup is decided and the week hasn't flipped yet.
    case "final": {
      const my = m?.my_score ?? 0;
      const their = m?.opponent_score ?? 0;
      const won = my > their;
      const tie = my === their;
      const closest =
        weekMatchups
          .filter((x) => x.home.score != null && x.away.score != null)
          .map((x) => {
            const homeWon = (x.home.score ?? 0) >= (x.away.score ?? 0);
            return {
              label: `${homeWon ? x.home.owner_name : x.away.owner_name} over ${homeWon ? x.away.owner_name : x.home.owner_name}`,
              margin: Math.abs((x.home.score ?? 0) - (x.away.score ?? 0)),
            };
          })
          .sort((a, b) => a.margin - b.margin)[0] ?? null;
      header = {
        kicker: `${day} · Final`,
        title: tie ? `A tie in Week ${week}` : won ? `You won Week ${week}` : `Week ${week} got away`,
      };
      body = (
        <>
          <div className="-mt-1 flex justify-center">
            <Link href="/chat" className="flex min-h-11 items-center rounded-full px-5 text-sm font-bold text-[#0b0e13]" style={{ backgroundColor: color }}>
              {won ? "Talk trash in the chat" : "Face the chat"}
            </Link>
          </div>
          <StandingsMoveCard standings={standings} matchups={weekMatchups} teamId={teamId} week={week} />
          {mine && <ProjectionReportCard me={mine.me} matchups={weekMatchups} />}
          {mine && <RivalryResultCard item={mine.item} teamId={teamId} />}
          <WeekEndedCard me={mine?.me ?? null} closest={closest} />
          {betsCard}
          {turning}
          <LeagueScoreboardCard matchups={weekMatchups} teamId={teamId} title="Around the league" />
        </>
      );
      break;
    }

    // Tuesday after the flip: last week's story and the week ahead.
    case "recap": {
      header = { kicker: "Tuesday · Recap day", title: greeting(name, now) };
      body = (
        <>
          <PowerMoveCard trend={trend} teamId={teamId} />
          {whatIf}
          {m && <NextOpponentCard matchup={m} item={mine?.item ?? null} teamId={teamId} />}
          <InjuryReportCard lastWeek={last?.me.roster ?? []} roster={roster} title="Injuries from Sunday" />
          <WaiversCountdownCard claims={claims} now={now} color="#4cc3ff" />
          <FreeAgentsCard players={freeAgents} by="last" title="Free agents who went off last week" color="#4cc3ff" />
        </>
      );
      break;
    }

    // Wednesday: what the 3 AM run did, and the matchup ahead.
    case "waivers": {
      const run = lastRun(claims?.claims ?? []).filter((c) => now.getTime() - new Date(c.processed_at!).getTime() < 36 * 3600_000);
      const bigAdd = leagueActivity.find((a) => a.kind === "roster" && a.source === "waiver");
      const othersMoves = waiverActivity.filter(
        (a) =>
          a.kind === "roster" &&
          a.source === "waiver" &&
          a.owner_id !== me.owner_id &&
          now.getTime() - new Date(a.timestamp).getTime() < 36 * 3600_000,
      );
      header = { kicker: "Wednesday · Waivers cleared", title: `Week ${week} starts now` };
      body = (
        <>
          <ClaimResultsCard run={run} color={color} others={othersMoves} />
          {bigAdd && bigAdd.kind === "roster" && bigAdd.added_player_name && (
            <Panel>
              <Kicker>Biggest add of the night</Kicker>
              <p className="text-sm">
                {bigAdd.owner_name} claimed {bigAdd.added_player_name}
                {bigAdd.dropped_player_name ? ` (dropped ${bigAdd.dropped_player_name})` : ""}
              </p>
            </Panel>
          )}
          {claims?.priority && (
            <p className="-mt-1.5 px-1 text-[13px] text-[#8790a0]">
              You&apos;re #{claims.priority.rank} of {claims.priority.of} in the waiver order now.
            </p>
          )}
          {whatIf}
          {mine && <PositionEdgeCard me={mine.me} them={mine.them} />}
          <TradesCard trades={trades} teamId={teamId} color={color} />
          <FreeAgentsCard players={freeAgents} by="projected" title="Best still available" color={color} />
          <ByePlannerCard roster={roster} week={week} />
          {leagueActivity.length > 0 && <LeagueActivityFeed items={leagueActivity.slice(0, 4)} href="/activity" />}
        </>
      );
      break;
    }

    // A game today with one of your starters in it.
    case "lock": {
      const today = startersPlayingToday(roster, now);
      const theirsToday = (mine?.them.roster ?? []).filter(
        (p) => isStarter(p.lineup_slot) && p.game_status === "scheduled" && sameEtDate(p.game_time, now),
      );
      header = {
        kicker: `${day} · ${etDayHour(now).hour < 17 ? "First lock today" : "First lock tonight"}`,
        title: "Lineup check",
      };
      body = (
        <>
          <KickoffCard players={today} now={now} color={color} title="Locks in" />
          <LineupFixCard roster={roster} slots={myTeam?.roster_slots ?? null} week={week} color={color} onChanged={refreshAll} />
          {betsCard}
          <WeatherCard games={nflGames} roster={roster} />
          {mine && theirsToday.length > 0 && (
            <OpponentIntelCard them={mine.them} players={theirsToday} title={`${mine.them.owner_name} starts today`} />
          )}
          <TonightGamesCard games={tonightGames} title="On today" findGamecastId={gamecastFor} />
          {whatIf}
          <LoungeCard title="Tonight in the Lounge" body="Watch the game with your league" />
        </>
      );
      break;
    }

    // Thursday through Sunday before your players' games, each day its
    // own screen. Monday shares The sweat's cards.
    case "thu":
    case "fri":
    case "sat":
    case "sun": {
      const upcoming = roster.filter((p) => isStarter(p.lineup_slot) && !p.is_locked && p.game_time && new Date(p.game_time) > now);
      header = {
        kicker: phase === "sun" ? "Sunday morning" : day,
        title: upcoming.length > 0 ? `${upcoming.length} of your starters still to play` : "Get your lineup right",
      };
      const headStart = m && m.started ? <HeadStartCard matchup={m} /> : null;
      const edge = mine ? <PositionEdgeCard me={mine.me} them={mine.them} /> : null;
      const kickoff = <KickoffCard players={upcoming} now={now} color={color} title="Your next kickoff" />;
      if (phase === "thu") {
        body = (
          <>
            <TonightGamesCard games={tonightGames} title="Tonight" findGamecastId={gamecastFor} />
            {betsCard}
            {whatIf}
            {edge}
            <LoungeCard title="Tonight in the Lounge" body="Watch the game with your league" />
          </>
        );
      } else if (phase === "fri") {
        body = (
          <>
            {headStart}
            <TonightGamesCard games={tonightGames} title="Tonight" findGamecastId={gamecastFor} />
            {betsCard}
            {whatIf}
            {edge}
            <LoungeCard title="League Lounge" body="Hang out with the league before Sunday" />
          </>
        );
      } else if (phase === "sat") {
        body = (
          <>
            {headStart}
            <LineupFixCard roster={roster} slots={myTeam?.roster_slots ?? null} week={week} color={color} onChanged={refreshAll} />
            <StartSitCard roster={roster} context={mine?.me ?? null} week={week} onChanged={refreshAll} />
            <WeatherCard games={nflGames} roster={roster} />
            <InjuryReportCard lastWeek={[]} roster={roster.filter((p) => isStarter(p.lineup_slot))} title="Final injury report" />
            {kickoff}
            {betsCard}
            {whatIf}
            {edge}
            {mine && <OpponentIntelCard them={mine.them} title={`${mine.them.owner_name}'s hurt starters`} />}
          </>
        );
      } else {
        body = (
          <>
            {kickoff}
            {headStart}
            <TonightGamesCard games={tonightGames} title="On today" findGamecastId={gamecastFor} />
            {betsCard}
            {whatIf}
            {edge}
            <LoungeCard title="League Lounge" body="Watch the early games together" />
          </>
        );
      }
      break;
    }

    // Games on with your players in them.
    case "live": {
      const liveGames = nflGames.filter((g) => g.state === "in");
      const margin = (m?.my_score ?? 0) - (m?.opponent_score ?? 0);
      const onNow = (mine?.me.roster ?? [])
        .filter((p) => isStarter(p.lineup_slot) && p.game_status === "in_progress")
        .sort((a, b) => (b.points_scored ?? 0) - (a.points_scored ?? 0));
      header = {
        kicker: `Live · ${day}`,
        title: margin >= 0 ? "You're ahead" : "Chasing it",
        live: true,
        right: `${liveGames.length} game${liveGames.length === 1 ? "" : "s"} on now`,
      };
      body = (
        <>
          {mine && <SwingPlayersCard me={mine.me} them={mine.them} />}
          <PlayersNowCard players={onNow} title="Your players right now" />
          {betsCard}
          {mine && <TouchdownFeedCard me={mine.me} them={mine.them} />}
          {whatIf}
          {mine && <GameWindowsCard me={mine.me} them={mine.them} now={now} />}
          <LeagueScoreboardCard matchups={weekMatchups} teamId={teamId} title="Around the league · live" live />
          <TonightGamesCard games={liveGames} title="Live now" findGamecastId={gamecastFor} />
          {rooms && <WatchPartiesCard rooms={[...(rooms.party_rooms ?? []), rooms.open_room]} />}
          <LoungeCard title="League Lounge" body="Watch the games together" />
        </>
      );
      break;
    }

    // Monday (or Sunday night) with your matchup still undecided. Monday
    // before the night game shows the same cards.
    case "mon":
    case "sweat": {
      const margin = (m?.my_score ?? 0) - (m?.opponent_score ?? 0);
      header = {
        kicker: `${etDayHour(now).day === 1 ? "Monday Night" : `${day} night`} · The sweat`,
        title: margin >= 0 ? "Hold on tonight" : "It comes down to tonight",
      };
      body = (
        <>
          {mine && <WhatYouNeedCard me={mine.me} them={mine.them} winProbability={m?.win_probability ?? null} />}
          {turning}
          <TonightGamesCard games={tonightGames} title="Tonight" findGamecastId={gamecastFor} />
          {betsCard}
          <MatchupsAliveCard matchups={weekMatchups} teamId={teamId} />
          {whatIf}
          {mine && <TouchdownFeedCard me={mine.me} them={mine.them} />}
          <LoungeCard title="Sweat it together" body="The Lounge is open for tonight's game" />
        </>
      );
      break;
    }
  }

  // Your Week leads every day, with the week's recap right under it on
  // the days about last week (a countdown takes its place before the
  // recap is out on a final week). On days about the week ahead, the
  // recap moves below that day's cards.
  const recapFirst = phase === "final" || phase === "recap" || phase === "waivers";
  const recapWeek = phase === "final" ? (weeklyRecapWeek === week ? weeklyRecapWeek : null) : weeklyRecapWeek;
  const recapCard =
    weeklyRecap && recapWeek !== null ? (
      <WeeklyRecapTeaser recap={weeklyRecap} season={season} week={recapWeek} isCommissioner={me.is_commissioner} />
    ) : null;
  const recapCountdown =
    phase === "final" && !recapCard ? (
      <Panel tint={RECAP_GOLD}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <Kicker color={RECAP_GOLD}>Week {week} recap</Kicker>
            <span className="text-sm">The recap and awards drop at noon PT</span>
            <span className="text-xs text-[#8790a0]">You&apos;ll get a push the moment it&apos;s out.</span>
          </div>
          <span className="shrink-0 text-[13px] text-[#8790a0]">in {untilText(nextEt(2, 15, now), now)}</span>
        </div>
      </Panel>
    ) : null;

  return (
    <div className="flex flex-col gap-3.5">
      <header className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            {header.live && <span className="live-dot" aria-hidden />}
            <Kicker color={header.live ? "#ef4444" : color}>{header.kicker}</Kicker>
          </span>
          {header.right ? (
            <span className="text-[13px] text-[#8790a0]">{header.right}</span>
          ) : unread > 0 ? (
            <Link href="/chat" className="rounded-full bg-[#39ff14]/15 px-2.5 py-1 text-xs font-bold text-[#39ff14]">
              {unread > 99 ? "99+" : unread} unread
            </Link>
          ) : null}
        </div>
        <h1 className="text-2xl font-bold text-[#eceef1]">{header.title}</h1>
      </header>

      {last && lastWeek !== null ? (
        <YourWeekCard myWeek={lastWeekAsYourWeek(last, lastWeek, myWeek)} isGameDay={false} leagueName={activeLeagueName} surfaceClass={SURFACE} />
      ) : m ? (
        <YourWeekCard myWeek={myWeek} isGameDay={isGameDay} leagueName={activeLeagueName} surfaceClass={m.started && isGameDay ? LIVE_SURFACE : SURFACE} />
      ) : (
        <Panel>
          <span className="text-[13px] text-[#8790a0]">No matchup this week.</span>
        </Panel>
      )}
      {recapCountdown}
      {recapFirst && recapCard}
      {body}
      {!recapFirst && recapCard}
      {chugDeadline?.deadline && <ChugCountdownCard deadline={chugDeadline.deadline} isPast={chugDeadline.is_past} mine={chugDeadline.mine} />}
      <DeadlinesCard trade={tradeSettings} keeper={keeperRules} now={now} />
      <button
        type="button"
        onClick={() => {
          setHomeLayout("classic");
          router.refresh();
        }}
        className="self-center py-3 text-xs text-[#8790a0] hover:text-[#eceef1]"
      >
        Switch to the classic home
      </button>
    </div>
  );
}

// On the classic home: the way back to the Living Home.
export function TryLivingHomeButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        setHomeLayout("living");
        router.refresh();
      }}
      className="self-center py-3 text-xs text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white"
    >
      Try the Living Home
    </button>
  );
}
