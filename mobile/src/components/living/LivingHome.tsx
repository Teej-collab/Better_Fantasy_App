import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { TickerStrips } from '@/components/TickerStrips';
import { useTabScrollRef } from '@/components/TabFrame';
import { RecapCard } from '@/components/home/RecapCard';
import { ChugCountdownCard } from '@/components/home/CountdownCard';
import { ActivityCard } from '@/components/home/FeedCards';
import { YourWeekCard } from '@/components/home/YourWeekCard';
import { LiveNowCard } from '@/components/home/LeagueCards';
import {
  ClaimResultsCard,
  KickoffCard,
  Kicker,
  LoungeCard,
  Panel,
  PlayersNowCard,
  useNow,
  WaiversCountdownCard,
  WeekEndedCard,
} from '@/components/living/LivingCards';
import { HeadStartCard, LineupFixCard, OpponentIntelCard, StartSitCard, WeatherCard } from '@/components/living/LineupTools';
import { WeekendBetsCard } from '@/components/living/WeekendBetsCard';
import {
  GameWindowsCard,
  MatchupsAliveCard,
  SwingPlayersCard,
  TonightGamesCard,
  TouchdownFeedCard,
  TurningPointsCard,
  WatchPartiesCard,
  WhatYouNeedCard,
} from '@/components/living/LiveTools';
import {
  ByePlannerCard,
  DeadlinesCard,
  FreeAgentsCard,
  InjuryReportCard,
  LeagueScoreboardCard,
  NextOpponentCard,
  PositionEdgeCard,
  PowerMoveCard,
  ProjectionReportCard,
  RivalryResultCard,
  StandingsMoveCard,
  TradesCard,
  WhatIfCard,
} from '@/components/living/WeekCards';
import { Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { Colors, Radius, SectionColors, Spacing, withAlpha } from '@/constants/theme';
import { useAppearance } from '@/lib/appearance';
import {
  dayName,
  etDayHour,
  homePhase,
  inBetsWeekend,
  isStarter,
  nextEt,
  PHASE_COLOR,
  sideFor,
  startersPlayingToday,
  untilText,
  type HomePhase,
} from '@/lib/livingHome';
import {
  queryClient,
  useActiveLeagueName,
  useBets,
  useChatConversations,
  useChugDeadline,
  useFreeAgents,
  useGamecastIdFinder,
  useHomeAwards,
  useHomeRecap,
  useKeeperRules,
  useLeagueActivity,
  useLeagueTicker,
  useMatchupContext,
  useMe,
  useMyTeam,
  useMyTrades,
  useMyWeek,
  useNflScoreboard,
  usePlayoffOdds,
  usePowerRankingsTrend,
  useSeasonWeek,
  useStandings,
  useTradeSettings,
  useWaiverClaims,
  useWatchPartyRooms,
  useWinProbHistory,
} from '@/lib/queries';
import type { MatchupContextSide, WeekMatchupContextItem, YourWeek } from '@/lib/types';
import { buildKickoffCountdownItem, buildLeagueTickerItems, buildTickerItems } from '@/lib/ticker';
import { lastRun } from '@/lib/waiverClaims';
import { useTabBarScroll } from '@/lib/tabBar';

// Last week's matchup in the Your Week card's own shape, so recap day
// can show last week's final in exactly the same card.
function lastWeekAsYourWeek(
  last: { item: WeekMatchupContextItem; me: MatchupContextSide; them: MatchupContextSide },
  week: number,
  season: number,
  teamId: number,
): YourWeek {
  const { item, me, them } = last;
  return {
    season,
    week,
    team_id: teamId,
    team_name: me.team_name,
    power_rank: me.power_rank,
    draft: null,
    matchup: {
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
  const part = h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
  return name ? `${part}, ${name}` : part;
}

function sameEtDate(iso: string | null, now: Date): boolean {
  if (!iso) return false;
  const a = etDayHour(new Date(iso));
  const b = etDayHour(now);
  return a.day === b.day && Math.abs(new Date(iso).getTime() - now.getTime()) < 24 * 3600_000;
}

/**
 * The living home screen (2026-10-13, testers only): one screen that
 * follows the fantasy week — the result once it's final, recap day on
 * Tuesday, waiver results Wednesday, lineup checks and kickoff
 * countdowns before games, the live score on game day and the sweat on
 * Monday night. Each day's cards are listed in the switch below.
 */
export function LivingHome() {
  const scrollRef = useTabScrollRef<ScrollView>();
  const tabBarScroll = useTabBarScroll();
  const now = useNow();
  const me = useMe().data ?? null;
  const appearance = useAppearance();
  const leagueName = useActiveLeagueName().data ?? null;
  const seasonWeek = useSeasonWeek();
  const season = seasonWeek.data?.season ?? null;
  const week = seasonWeek.data?.week ?? null;
  const myWeek = useMyWeek();
  const games = useNflScoreboard().data ?? [];
  const findGamecastId = useGamecastIdFinder();
  const myTeam = useMyTeam().data ?? null;
  const roster = myTeam?.roster ?? [];
  const claims = useWaiverClaims().data ?? null;
  const standings = useStandings(season).data?.standings ?? [];
  const context = useMatchupContext(season, week).data ?? null;
  const awards = useHomeAwards(season, week).data ?? null;
  const recap = useHomeRecap(season, week).data ?? null;
  const activity = useLeagueActivity(season, 4).data ?? [];
  const leagueTicker = useLeagueTicker(season, week).data ?? [];
  const conversations = useChatConversations().data ?? [];
  const chug = useChugDeadline(myWeek.data?.draft?.status === 'complete').data ?? null;
  const trend = usePowerRankingsTrend(season).data ?? [];
  const teamId = myWeek.data?.team_id ?? null;
  const odds = usePlayoffOdds(season, teamId).data ?? null;
  const freeAgents = useFreeAgents(undefined, '').data ?? [];
  const trades = useMyTrades().data ?? [];
  const tradeSettings = useTradeSettings().data ?? null;
  const keeperRules = useKeeperRules().data ?? null;
  const betsData = useBets().data;
  const bets = betsData?.bets ?? [];
  const rooms = useWatchPartyRooms().data ?? null;
  const [refreshing, setRefreshing] = useState(false);

  const phase: HomePhase = homePhase({ now, myWeek: myWeek.data ?? null, games, roster });
  const lastWeek = phase === 'recap' && week !== null && week > 1 ? week - 1 : null;
  const lastContext = useMatchupContext(lastWeek !== null ? season : null, lastWeek).data ?? null;
  // Wednesday: everyone's moves from the overnight waiver run.
  const waiverActivity = useLeagueActivity(phase === 'waivers' ? season : null, 40).data ?? [];
  const m = myWeek.data?.matchup ?? null;
  const history = useWinProbHistory(phase === 'sweat' || phase === 'live' || phase === 'final' ? season : null, m?.matchup_id ?? null).data ?? null;

  async function onRefresh() {
    setRefreshing(true);
    await queryClient.invalidateQueries();
    setRefreshing(false);
  }

  if (myWeek.isPending) return <LoadingState />;
  // Only a 404 means "no team": anything else (2026-10-22: ESPN blocking
  // the server turned /me/week into a 500) is a failed load, not an
  // invitation to join a league you're already in.
  const noTeam = myWeek.error instanceof ApiError && myWeek.error.status === 404;
  if (!myWeek.data && !noTeam) {
    return <MessageState message="Couldn't load your week. Try again in a minute." actionLabel="Try again" onAction={() => void myWeek.refetch()} />;
  }
  if (!myWeek.data || teamId === null) {
    return <MessageState message="You're signed in, but not on a team yet. Join or create a league to get started." />;
  }

  const color = PHASE_COLOR[phase];
  const weekMatchups = context?.matchups ?? [];
  const mine = sideFor(weekMatchups, teamId);
  const name = me?.display_name ?? null;
  const day = dayName(now);
  const live = games.some((g) => g.state === 'in');
  const unread = conversations.reduce((sum, c) => sum + (c.unread_count ?? 0), 0);

  // The NFL and league tickers across the top, same as the classic home.
  const weekPlayed = standings.some((r) => r.wins + r.losses + r.ties > 0);
  const tickerItems = buildTickerItems(games, awards?.awards ?? null, standings, weekPlayed, weekMatchups.filter((x) => x.is_rivalry));
  let leagueTickerItems = buildLeagueTickerItems(leagueTicker);
  if (leagueTickerItems.length === 0 && week !== null) {
    const countdown = buildKickoffCountdownItem(games, week);
    if (countdown) leagueTickerItems = [countdown];
  }

  // Who to root for this week, from the What-If engine (Your Week up top
  // already covers the matchup itself).
  // Tuesday–Saturday it's your playoff odds and what this week's result
  // does to them; Sunday–Monday, the other games to root for.
  const whatIfHalf = etDayHour(now).day <= 1 ? 'root' : 'odds';
  const whatIf = odds ? <WhatIfCard odds={odds} teamId={teamId} standings={standings} half={whatIfHalf} /> : null;
  const turning =
    history && mine ? <TurningPointsCard history={history} meIsHome={mine.item.home.team_id === teamId} opponent={mine.them.owner_name} /> : null;
  // Your bets, Thursday morning to Monday night, on whatever the mood is.
  const betsCard = inBetsWeekend(now) ? <WeekendBetsCard bets={bets} games={games} enabled={betsData?.enabled ?? false} /> : null;
  const tonightGames = games.filter((g) => (g.state === 'pre' || g.state === 'in') && sameEtDate(g.date, now));

  // Recap day: last week's final until Wednesday's waivers start the new week.
  const last = phase === 'recap' && lastContext ? sideFor(lastContext.matchups, teamId) : null;

  let header: { kicker: string; title: string; live?: boolean; right?: string };
  let body: ReactNode;

  switch (phase) {
    // Your matchup is decided and the week hasn't flipped yet.
    case 'final': {
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
          <View style={styles.buttons}>
            <Pressable style={[styles.button, { backgroundColor: color }]} onPress={() => router.navigate('/chat')} accessibilityRole="button">
              <Text style={styles.buttonText}>{won ? 'Talk trash in the chat' : 'Face the chat'}</Text>
            </Pressable>
          </View>
          {week !== null && <StandingsMoveCard standings={standings} matchups={weekMatchups} teamId={teamId} week={week} />}
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
    case 'recap': {
      header = { kicker: 'Tuesday · Recap day', title: greeting(name, now) };
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
    case 'waivers': {
      const run = lastRun(claims?.claims ?? []).filter((c) => now.getTime() - new Date(c.processed_at!).getTime() < 36 * 3600_000);
      const bigAdd = activity.find((a) => a.kind === 'roster' && a.source === 'waiver');
      const othersMoves = waiverActivity.filter(
        (a) =>
          a.kind === 'roster' &&
          a.source === 'waiver' &&
          a.owner_id !== me?.owner_id &&
          now.getTime() - new Date(a.timestamp).getTime() < 36 * 3600_000,
      );
      header = { kicker: 'Wednesday · Waivers cleared', title: `Week ${week} starts now` };
      body = (
        <>
          <ClaimResultsCard run={run} color={color} others={othersMoves} />
          {bigAdd && bigAdd.kind === 'roster' && bigAdd.added_player_name && (
            <Panel>
              <Kicker>Biggest add of the night</Kicker>
              <Text style={styles.body}>
                {bigAdd.owner_name} claimed {bigAdd.added_player_name}
                {bigAdd.dropped_player_name ? ` (dropped ${bigAdd.dropped_player_name})` : ''}
              </Text>
            </Panel>
          )}
          {claims?.priority && (
            <Text style={styles.note}>
              You&apos;re #{claims.priority.rank} of {claims.priority.of} in the waiver order now.
            </Text>
          )}
          {whatIf}
          {mine && <PositionEdgeCard me={mine.me} them={mine.them} />}
          <TradesCard trades={trades} teamId={teamId} color={color} />
          <FreeAgentsCard players={freeAgents} by="projected" title="Best still available" color={color} />
          {week !== null && <ByePlannerCard roster={roster} week={week} />}
          {activity.length > 0 && <ActivityCard items={activity} />}
        </>
      );
      break;
    }

    // A game today with one of your starters in it.
    case 'lock': {
      const today = startersPlayingToday(roster, now);
      const theirsToday = (mine?.them.roster ?? []).filter((p) => isStarter(p.lineup_slot) && p.game_status === 'scheduled' && sameEtDate(p.game_time, now));
      header = {
        kicker: `${day} · ${etDayHour(now).hour < 17 ? 'First lock today' : 'First lock tonight'}`,
        title: 'Lineup check',
      };
      body = (
        <>
          <KickoffCard players={today} now={now} color={color} title="Locks in" />
          <LineupFixCard roster={roster} slots={myTeam?.roster_slots ?? null} week={week} color={color} />
          {betsCard}
          <WeatherCard games={games} roster={roster} />
          {mine && theirsToday.length > 0 && <OpponentIntelCard them={mine.them} players={theirsToday} title={`${mine.them.owner_name} starts today`} />}
          <TonightGamesCard games={tonightGames} title="On today" findGamecastId={findGamecastId} />
          {whatIf}
          <LoungeCard title="Tonight in the Lounge" body="Watch the game with your league" />
        </>
      );
      break;
    }

    // Thursday through Sunday before your players' games, each day its
    // own screen (2026-10-20 layout). Monday shares The sweat's cards.
    case 'thu':
    case 'fri':
    case 'sat':
    case 'sun': {
      const upcoming = roster.filter((p) => isStarter(p.lineup_slot) && !p.is_locked && p.game_time && new Date(p.game_time) > now);
      header = {
        kicker: phase === 'sun' ? 'Sunday morning' : day,
        title: upcoming.length > 0 ? `${upcoming.length} of your starters still to play` : 'Get your lineup right',
      };
      const headStart = m && m.started ? <HeadStartCard matchup={m} /> : null;
      const edge = mine ? <PositionEdgeCard me={mine.me} them={mine.them} /> : null;
      const kickoff = <KickoffCard players={upcoming} now={now} color={color} title="Your next kickoff" />;
      if (phase === 'thu') {
        body = (
          <>
            <TonightGamesCard games={tonightGames} title="Tonight" findGamecastId={findGamecastId} />
            {betsCard}
            {whatIf}
            {edge}
            <LoungeCard title="Tonight in the Lounge" body="Watch the game with your league" />
          </>
        );
      } else if (phase === 'fri') {
        body = (
          <>
            {headStart}
            <TonightGamesCard games={tonightGames} title="Tonight" findGamecastId={findGamecastId} />
            {betsCard}
            {whatIf}
            {edge}
            <LoungeCard title="League Lounge" body="Hang out with the league before Sunday" />
          </>
        );
      } else if (phase === 'sat') {
        body = (
          <>
            {headStart}
            <LineupFixCard roster={roster} slots={myTeam?.roster_slots ?? null} week={week} color={color} />
            <StartSitCard roster={roster} context={mine?.me ?? null} week={week} />
            <WeatherCard games={games} roster={roster} />
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
            <TonightGamesCard games={tonightGames} title="On today" findGamecastId={findGamecastId} />
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
    case 'live': {
      const liveGames = games.filter((g) => g.state === 'in');
      const margin = (m?.my_score ?? 0) - (m?.opponent_score ?? 0);
      const onNow = (mine?.me.roster ?? [])
        .filter((p) => isStarter(p.lineup_slot) && p.game_status === 'in_progress')
        .sort((a, b) => (b.points_scored ?? 0) - (a.points_scored ?? 0));
      header = {
        kicker: `Live · ${day}`,
        title: margin >= 0 ? "You're ahead" : 'Chasing it',
        live: true,
        right: `${liveGames.length} game${liveGames.length === 1 ? '' : 's'} on now`,
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
          {liveGames.length > 0 && <LiveNowCard games={liveGames} findGamecastId={findGamecastId} />}
          {rooms && <WatchPartiesCard rooms={[...(rooms.party_rooms ?? []), rooms.open_room]} />}
          <LoungeCard title="League Lounge" body="Watch the games together" />
        </>
      );
      break;
    }

    // Monday (or Sunday night) with your matchup still undecided. Monday
    // before the night game shows the same cards.
    case 'mon':
    case 'sweat': {
      const margin = (m?.my_score ?? 0) - (m?.opponent_score ?? 0);
      header = {
        kicker: `${etDayHour(now).day === 1 ? 'Monday Night' : `${day} night`} · The sweat`,
        title: margin >= 0 ? 'Hold on tonight' : 'It comes down to tonight',
      };
      body = (
        <>
          {mine && <WhatYouNeedCard me={mine.me} them={mine.them} winProbability={m?.win_probability ?? null} />}
          {turning}
          <TonightGamesCard games={tonightGames} title="Tonight" findGamecastId={findGamecastId} />
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

  // The classic home's Your Week card leads every day, with the week's
  // recap right under it, exactly as the classic home shows it (full on
  // recap day, then "Missed the recap?"). Before the recap is out on a
  // final week, a countdown takes its place. On days about the week
  // ahead, it moves below that day's cards.
  const recapFirst = phase === 'final' || phase === 'recap' || phase === 'waivers';
  const shownRecap = phase === 'final' ? (recap && recap.week === week ? recap : null) : recap;
  const recapCard = shownRecap ? <RecapCard recap={shownRecap.recap} week={shownRecap.week} season={shownRecap.season} /> : null;
  const recapCountdown =
    phase === 'final' && !shownRecap ? (
      <Panel tint={SectionColors.awards}>
        <View style={styles.spread}>
          <View style={styles.gap2}>
            <Kicker color={SectionColors.awards}>Week {week} recap</Kicker>
            <Text style={styles.body}>The recap and awards drop at noon PT</Text>
            <Text style={styles.small}>You&apos;ll get a push the moment it&apos;s out.</Text>
          </View>
          <Text style={styles.muted}>in {untilText(nextEt(2, 15, now), now)}</Text>
        </View>
      </Panel>
    ) : null;

  return (
    <ScrollView
      ref={scrollRef}
      {...tabBarScroll}
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color} />}>
      <TickerStrips nfl={tickerItems} league={leagueTickerItems} fast={live} />
      <View style={styles.header}>
        <View style={styles.spread}>
          <View style={styles.kickerRow}>
            {header.live && <View style={styles.liveDot} />}
            <Kicker color={header.live ? Colors.live : color}>{header.kicker}</Kicker>
          </View>
          {header.right ? (
            <Text style={styles.muted}>{header.right}</Text>
          ) : unread > 0 ? (
            <Pressable onPress={() => router.navigate('/chat')} style={styles.unread} accessibilityRole="button" accessibilityLabel={`${unread} unread chat messages`}>
              <Text style={styles.unreadText}>{unread > 99 ? '99+' : unread} unread</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.title}>{header.title}</Text>
      </View>
      {last && lastWeek !== null ? (
        <YourWeekCard
          myWeek={lastWeekAsYourWeek(last, lastWeek, myWeek.data.season, teamId)}
          isGameDay={false}
          leagueName={leagueName}
          color={appearance.yourWeek}
          colors={appearance.yourWeekColors}
          final
        />
      ) : m ? (
        <YourWeekCard
          myWeek={myWeek.data}
          isGameDay={live}
          leagueName={leagueName}
          color={appearance.yourWeek}
          colors={appearance.yourWeekColors}
          final={phase === 'final'}
        />
      ) : (
        <Panel>
          <Text style={styles.muted}>No matchup this week.</Text>
        </Panel>
      )}
      {recapCountdown}
      {recapFirst && recapCard}
      {body}
      {!recapFirst && recapCard}
      {chug?.deadline && <ChugCountdownCard deadline={chug.deadline} isPast={chug.is_past} mine={chug.mine} />}
      <DeadlinesCard trade={tradeSettings} keeper={keeperRules} now={now} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: 14 },
  header: { gap: 2 },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: Colors.live },
  title: { color: Colors.text, fontSize: 24, fontWeight: '700' },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  gap2: { gap: 2, flexShrink: 1 },
  center: { alignItems: 'center' },
  body: { color: Colors.text, fontSize: 14 },
  small: { color: Colors.textSecondary, fontSize: 12 },
  note: { color: Colors.textSecondary, fontSize: 13, marginTop: -6, paddingHorizontal: 4 },
  muted: { color: Colors.textSecondary, fontSize: 13, flexShrink: 1 },
  quote: { color: Colors.text, fontSize: 14, lineHeight: 20, fontStyle: 'italic' },
  buttons: { flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: -4 },
  button: { minHeight: 44, borderRadius: 999, paddingHorizontal: 18, justifyContent: 'center' },
  buttonText: { color: '#0b0e13', fontSize: 14, fontWeight: '700' },
  buttonQuiet: { backgroundColor: Colors.tileRaised },
  buttonQuietText: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  unread: { backgroundColor: withAlpha(Colors.accent, 0.16), borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  unreadText: { color: Colors.accent, fontSize: 12, fontWeight: '700' },
});
