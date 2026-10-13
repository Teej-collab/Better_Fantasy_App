import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { ShareableCard } from '@/components/ShareableCard';
import { TickerStrips } from '@/components/TickerStrips';
import { useTabScrollRef } from '@/components/TabFrame';
import { ChugCountdownCard } from '@/components/home/CountdownCard';
import { ActivityCard } from '@/components/home/FeedCards';
import { LiveNowCard } from '@/components/home/LeagueCards';
import {
  AwardsMiniCard,
  Chip,
  ClaimResultsCard,
  KickoffCard,
  Kicker,
  LinkText,
  LoungeCard,
  MatchupPreviewCard,
  Panel,
  PlayersNowCard,
  ScoreLine,
  useNow,
  WaiversCountdownCard,
  WeekEndedCard,
  WinBar,
} from '@/components/living/LivingCards';
import { BetsCard, HeadStartCard, LineupFixCard, OpponentIntelCard, StartSitCard, WeatherCard } from '@/components/living/LineupTools';
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
  PlayoffOddsCard,
  PositionEdgeCard,
  PowerMoveCard,
  ProjectionReportCard,
  RivalryResultCard,
  StandingsMoveCard,
  TradesCard,
  YourAwardsCard,
} from '@/components/living/WeekCards';
import { Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { Colors, Radius, Spacing, withAlpha } from '@/constants/theme';
import {
  dayName,
  etDayHour,
  fmt,
  homePhase,
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
import { buildKickoffCountdownItem, buildLeagueTickerItems, buildTickerItems } from '@/lib/ticker';
import { lastRun } from '@/lib/waiverClaims';

// The recap's opening, without markdown, cut at a sentence near `max`.
function excerpt(text: string, max = 220): string {
  const plain = text
    .replace(/^#+\s.*$/gm, '')
    .replace(/[*_>#`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const stop = cut.lastIndexOf('. ');
  return `${stop > 80 ? cut.slice(0, stop + 1) : cut.trimEnd()}…`;
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
export function LivingHome({ onUseClassic }: { onUseClassic: () => void }) {
  const scrollRef = useTabScrollRef<ScrollView>();
  const now = useNow();
  const me = useMe().data ?? null;
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
  const bets = useBets().data?.bets ?? [];
  const rooms = useWatchPartyRooms().data ?? null;
  const [refreshing, setRefreshing] = useState(false);

  const phase: HomePhase = homePhase({ now, myWeek: myWeek.data ?? null, games, roster });
  const lastWeek = phase === 'recap' && week !== null && week > 1 ? week - 1 : null;
  const lastContext = useMatchupContext(lastWeek !== null ? season : null, lastWeek).data ?? null;
  const m = myWeek.data?.matchup ?? null;
  const history = useWinProbHistory(phase === 'sweat' || phase === 'live' || phase === 'final' ? season : null, m?.matchup_id ?? null).data ?? null;

  async function onRefresh() {
    setRefreshing(true);
    await queryClient.invalidateQueries();
    setRefreshing(false);
  }

  if (myWeek.isPending && seasonWeek.isPending) return <LoadingState />;
  if (!myWeek.data || teamId === null) {
    return <MessageState message="You're signed in, but not on a team yet. Join or create a league to get started." />;
  }

  const color = PHASE_COLOR[phase];
  const weekMatchups = context?.matchups ?? [];
  const mine = sideFor(weekMatchups, teamId);
  const myRow = standings.find((r) => r.team_id === teamId);
  const record = myRow ? `${myRow.wins}–${myRow.losses}${myRow.ties ? `–${myRow.ties}` : ''}` : null;
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

  const preview = m ? (
    <MatchupPreviewCard
      matchupId={m.matchup_id}
      myProjection={m.my_projected_total}
      theirProjection={m.opponent_projected_total}
      opponent={m.opponent_team_name}
      winProbability={m.win_probability}
      color={color}
    />
  ) : null;
  const turning =
    history && mine ? <TurningPointsCard history={history} meIsHome={mine.item.home.team_id === teamId} opponent={mine.them.owner_name} /> : null;
  const tonightGames = games.filter((g) => (g.state === 'pre' || g.state === 'in') && sameEtDate(g.date, now));

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
      const recapOut = recap && recap.week === week && recap.recap.released !== false;
      const flip = nextEt(2, 15, now);
      const resultColor = won ? color : tie ? Colors.text : Colors.loss;
      header = {
        kicker: `${day} · Final`,
        title: tie ? `A tie in Week ${week}` : won ? `You won Week ${week}` : `Week ${week} got away`,
      };
      body = (
        <>
          <ShareableCard title={`Week ${week} result`}>
            <Panel tint={resultColor} style={styles.center}>
              <Kicker color={resultColor}>{tie ? 'Final · Tie' : won ? 'Final · Win' : 'Final · Loss'}</Kicker>
              <ScoreLine mine={m?.my_score ?? null} theirs={m?.opponent_score ?? null} color={won ? color : Colors.text} mineLabel={myWeek.data.team_name} theirLabel={m?.opponent_team_name} />
              {record && <Text style={styles.body}>Now {record}</Text>}
            </Panel>
          </ShareableCard>
          <View style={styles.buttons}>
            <Pressable style={[styles.button, { backgroundColor: color }]} onPress={() => router.navigate('/chat')} accessibilityRole="button">
              <Text style={styles.buttonText}>{won ? 'Talk trash' : 'Face the chat'}</Text>
            </Pressable>
            {m && (
              <Pressable
                style={[styles.button, styles.buttonQuiet]}
                onPress={() => router.push({ pathname: '/matchup/[id]', params: { id: String(m.matchup_id) } })}
                accessibilityRole="button">
                <Text style={styles.buttonQuietText}>Open matchup</Text>
              </Pressable>
            )}
          </View>
          {week !== null && <StandingsMoveCard standings={standings} matchups={weekMatchups} teamId={teamId} week={week} />}
          {mine && <ProjectionReportCard me={mine.me} matchups={weekMatchups} />}
          {mine && <RivalryResultCard item={mine.item} teamId={teamId} />}
          <WeekEndedCard me={mine?.me ?? null} closest={closest} />
          {turning}
          <LeagueScoreboardCard matchups={weekMatchups} teamId={teamId} title="Around the league" />
          {recapOut && season !== null && week !== null ? (
            <Panel onPress={() => router.push({ pathname: '/recap/[season]/[week]', params: { season: String(season), week: String(week) } })} label="Read the recap">
              <Kicker color="#f5b942">The Week {week} recap is out</Kicker>
              <Text style={styles.body}>{excerpt(recap.recap.text, 140)}</Text>
            </Panel>
          ) : (
            <Panel>
              <View style={styles.spread}>
                <View style={styles.gap2}>
                  <Kicker>Coming up</Kicker>
                  <Text style={styles.body}>The Week {week} recap and awards</Text>
                  <Text style={styles.small}>You&apos;ll get a push the moment it drops.</Text>
                </View>
                <Text style={styles.muted}>in {untilText(flip, now)}</Text>
              </View>
            </Panel>
          )}
        </>
      );
      break;
    }

    // Tuesday after the flip: last week's story and the week ahead.
    case 'recap': {
      const last = lastContext ? sideFor(lastContext.matchups, teamId) : null;
      const lastRecap = recap && recap.week === lastWeek && recap.recap.released !== false ? recap : null;
      const won = last && (last.me.score ?? 0) > (last.them.score ?? 0);
      header = { kicker: 'Tuesday · Recap day', title: greeting(name, now) };
      body = (
        <>
          {last && (
            <Panel tint="#f5b942">
              <Kicker color="#f5b942">Your Week {lastWeek} · Final</Kicker>
              <ScoreLine
                mine={last.me.score}
                theirs={last.them.score}
                color={won ? '#39ff14' : Colors.text}
                mineLabel={record ? `You · ${record}` : 'You'}
                theirLabel={last.them.team_name}
                middle={<Chip color={won ? '#39ff14' : Colors.loss}>{`${won ? 'W' : 'L'} · ${Math.abs((last.me.score ?? 0) - (last.them.score ?? 0)).toFixed(1)}`}</Chip>}
              />
              {lastRecap && <Text style={styles.quote}>“{excerpt(lastRecap.recap.text)}”</Text>}
              {lastRecap && season !== null && (
                <LinkText
                  color="#f5b942"
                  onPress={() => router.push({ pathname: '/recap/[season]/[week]', params: { season: String(season), week: String(lastWeek) } })}>
                  Read the Week {lastWeek} recap →
                </LinkText>
              )}
            </Panel>
          )}
          {awards && <YourAwardsCard awards={awards.awards} teamName={myWeek.data.team_name} />}
          {awards && season !== null && <AwardsMiniCard awards={awards.awards} week={awards.week} season={season} color={color} />}
          <PowerMoveCard trend={trend} teamId={teamId} />
          {odds && <PlayoffOddsCard odds={odds} teamId={teamId} />}
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
      header = { kicker: 'Wednesday · Waivers cleared', title: `Week ${week} starts now` };
      body = (
        <>
          <ClaimResultsCard run={run} color={color} />
          {claims?.priority && (
            <Text style={styles.note}>
              You&apos;re #{claims.priority.rank} of {claims.priority.of} in the waiver order now.
            </Text>
          )}
          {bigAdd && bigAdd.kind === 'roster' && bigAdd.added_player_name && (
            <Panel>
              <Kicker>Biggest add of the night</Kicker>
              <Text style={styles.body}>
                {bigAdd.owner_name} claimed {bigAdd.added_player_name}
                {bigAdd.dropped_player_name ? ` (dropped ${bigAdd.dropped_player_name})` : ''}
              </Text>
            </Panel>
          )}
          {preview}
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
          <WeatherCard games={games} roster={roster} />
          {mine && theirsToday.length > 0 && <OpponentIntelCard them={mine.them} players={theirsToday} title={`${mine.them.owner_name} starts today`} />}
          <TonightGamesCard games={tonightGames} title="On today" findGamecastId={findGamecastId} />
          {preview}
          <LoungeCard title="Tonight in the Lounge" body="Watch the game with your league" />
        </>
      );
      break;
    }

    // Thu–Sun before kickoff: get the lineup right.
    case 'prep': {
      const upcoming = roster.filter((p) => isStarter(p.lineup_slot) && !p.is_locked && p.game_time && new Date(p.game_time) > now);
      header = {
        kicker: `${day} · Lineup prep`,
        title: upcoming.length > 0 ? `${upcoming.length} of your starters still to play` : 'Get your lineup right',
      };
      body = (
        <>
          {m && m.started && <HeadStartCard matchup={m} />}
          <LineupFixCard roster={roster} slots={myTeam?.roster_slots ?? null} week={week} color={color} />
          <StartSitCard roster={roster} context={mine?.me ?? null} week={week} />
          <WeatherCard games={games} roster={roster} />
          <InjuryReportCard lastWeek={[]} roster={roster.filter((p) => isStarter(p.lineup_slot))} title="Final injury report" />
          <KickoffCard players={upcoming} now={now} color={color} title="Your next kickoff" />
          {preview}
          {mine && <PositionEdgeCard me={mine.me} them={mine.them} />}
          {mine && <OpponentIntelCard them={mine.them} title={`${mine.them.owner_name}'s hurt starters`} />}
          <BetsCard bets={bets} />
        </>
      );
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
          {m && (
            <Panel tint={color} onPress={() => router.push({ pathname: '/matchup/[id]', params: { id: String(m.matchup_id) } })} label="Open your matchup">
              <ScoreLine
                mine={m.my_score}
                theirs={m.opponent_score}
                color={margin >= 0 ? color : Colors.text}
                mineLabel={`You · proj ${fmt(mine?.me.projected_total ?? m.my_projected_total)}`}
                theirLabel={`${m.opponent_team_name} · proj ${fmt(mine?.them.projected_total ?? m.opponent_projected_total)}`}
                middle={<Chip color={margin >= 0 ? color : Colors.loss}>{`${margin >= 0 ? '+' : '−'}${Math.abs(margin).toFixed(1)}`}</Chip>}
              />
              {m.win_probability != null && <WinBar percent={m.win_probability} color={color} />}
              <View style={styles.spread}>
                {m.win_probability != null && <Text style={styles.muted}>{Math.round(m.win_probability)}% to win</Text>}
                <Text style={styles.muted}>
                  You {m.my_yet_to_play + m.my_in_play} left · Them {m.opponent_yet_to_play + m.opponent_in_play} left
                </Text>
              </View>
            </Panel>
          )}
          {mine && <SwingPlayersCard me={mine.me} them={mine.them} />}
          <PlayersNowCard players={onNow} title="Your players right now" />
          {mine && <TouchdownFeedCard me={mine.me} them={mine.them} />}
          {mine && <GameWindowsCard me={mine.me} them={mine.them} now={now} />}
          <LeagueScoreboardCard matchups={weekMatchups} teamId={teamId} title="Around the league · live" live />
          {liveGames.length > 0 && <LiveNowCard games={liveGames} findGamecastId={findGamecastId} />}
          {rooms && <WatchPartiesCard rooms={[...(rooms.party_rooms ?? []), rooms.open_room]} />}
          <LoungeCard title="League Lounge" body="Watch the games together" />
        </>
      );
      break;
    }

    // Monday (or Sunday night) with your matchup still undecided.
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
          <MatchupsAliveCard matchups={weekMatchups} teamId={teamId} />
          {mine && <TouchdownFeedCard me={mine.me} them={mine.them} />}
          <LoungeCard title="Sweat it together" body="The Lounge is open for tonight's game" />
        </>
      );
      break;
    }
  }

  return (
    <ScrollView
      ref={scrollRef}
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
      {body}
      {m === null && (
        <Panel>
          <Text style={styles.muted}>No matchup this week.</Text>
        </Panel>
      )}
      {chug?.deadline && <ChugCountdownCard deadline={chug.deadline} isPast={chug.is_past} mine={chug.mine} />}
      <DeadlinesCard trade={tradeSettings} keeper={keeperRules} now={now} />
      <Pressable onPress={onUseClassic} hitSlop={8} style={styles.footer} accessibilityRole="button">
        <Text style={styles.footerText}>Testing the new home · Switch to the classic one</Text>
      </Pressable>
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
  footer: { alignSelf: 'center', paddingVertical: Spacing.md },
  footerText: { color: Colors.textSecondary, fontSize: 12 },
});
