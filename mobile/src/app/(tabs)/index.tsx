import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { TickerStrips } from '@/components/TickerStrips';
import { TabFrame, useTabScrollRef } from '@/components/TabFrame';
import { AwardsCard } from '@/components/home/AwardsCard';
import { ChugCountdownCard, DraftCountdownCard } from '@/components/home/CountdownCard';
import { ActivityCard, ChugFeedCard } from '@/components/home/FeedCards';
import { DiscoverCard, LiveNowCard, OtherMatchupsCard, PowerRankingsCard, RivalriesCard, StandingsCard } from '@/components/home/LeagueCards';
import { YourWeekCard } from '@/components/home/YourWeekCard';
import { NeonPanel } from '@/components/NeonPanel';
import { Display, Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useAppearance } from '@/lib/appearance';
import {
  queryClient,
  useActiveLeagueName,
  useChugDeadline,
  useChugFeed,
  useGamecastIdFinder,
  useHouseRules,
  useHomeAwards,
  useHomeRecap,
  useIsGameLive,
  useLatestPowerRankings,
  useLeagueActivity,
  useLeagueTicker,
  useMatchupContext,
  useMyWeek,
  useNflScoreboard,
  usePreferences,
  useSeasonWeek,
  useStandings,
} from '@/lib/queries';
import { buildKickoffCountdownItem, buildLeagueTickerItems, buildTickerItems } from '@/lib/ticker';
import type { YourWeek } from '@/lib/types';

// The web's DEFAULT_HOME_CARD_ORDER (frontend/src/components/
// HomeCardDeck.tsx). An owner's saved order (preferences.home_card_order,
// set by dragging cards on the web) wins; cards it doesn't mention keep
// their default place at the end.
const DEFAULT_HOME_CARD_ORDER = [
  'yourWeek',
  'awards',
  'standings',
  'powerRankings',
  'matchups',
  'rivalries',
  'chugFeed',
  'activity',
  'discover',
];

function cardOrder(raw: string | null | undefined): string[] {
  let base = DEFAULT_HOME_CARD_ORDER;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((k) => typeof k === 'string')) {
        base = parsed.filter((k: string) => DEFAULT_HOME_CARD_ORDER.includes(k));
      }
    } catch {
      // Keep the default.
    }
  }
  return [...base, ...DEFAULT_HOME_CARD_ORDER.filter((k) => !base.includes(k))];
}

function HomeScreenContent() {
  const scrollRef = useTabScrollRef<ScrollView>();
  const appearance = useAppearance();
  const prefs = usePreferences();
  const seasonWeek = useSeasonWeek();
  const myWeek = useMyWeek();
  const leagueName = useActiveLeagueName().data ?? null;
  const season = seasonWeek.data?.season ?? null;
  const week = seasonWeek.data?.week ?? null;
  const isGameDay = useIsGameLive();
  const nflGames = useNflScoreboard().data ?? [];
  const findGamecastId = useGamecastIdFinder();

  const context = useMatchupContext(season, week);
  const standings = useStandings(season).data?.standings ?? [];
  const awards = useHomeAwards(season, week).data ?? null;
  const recap = useHomeRecap(season, week).data ?? null;
  const leagueTicker = useLeagueTicker(season, week).data ?? [];
  const powerRankings = useLatestPowerRankings(season).data?.rankings ?? [];
  const draftDone = myWeek.data?.draft?.status === 'complete';
  const chugDeadline = useChugDeadline(draftDone).data ?? null;
  const chugFeed = useChugFeed(season).data ?? [];
  const houseRules = useHouseRules().data;
  const activity = useLeagueActivity(season, 5).data ?? [];
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await queryClient.invalidateQueries();
    setRefreshing(false);
  }

  if (myWeek.isPending && seasonWeek.isPending) return <LoadingState />;

  const weekMatchups = context.data?.matchups ?? [];
  const myMatchupId = myWeek.data?.matchup?.matchup_id;
  const otherMatchups = weekMatchups.filter((m) => m.matchup_id !== myMatchupId);
  const rivalryGames = weekMatchups.filter((m) => m.is_rivalry);
  const weekPlayed = standings.some((r) => r.wins + r.losses + r.ties > 0);
  const liveNflGames = isGameDay ? nflGames.filter((g) => g.state === 'in') : [];

  const tickerItems = buildTickerItems(nflGames, awards?.awards ?? null, standings, weekPlayed, rivalryGames);
  let leagueTickerItems = buildLeagueTickerItems(leagueTicker);
  if (leagueTickerItems.length === 0 && week !== null) {
    const countdown = buildKickoffCountdownItem(nflGames, week);
    if (countdown) leagueTickerItems = [countdown];
  }

  // Draft countdown leads pre-draft; once the draft is done, Jeffrey's
  // Rule takes the same slot for the rest of the season.
  const draft = myWeek.data?.draft;
  const topCard =
    draft?.scheduled_start && draft.status === 'not_started' && myWeek.data ? (
      <DraftCountdownCard teamName={myWeek.data.team_name} scheduledStart={draft.scheduled_start} />
    ) : chugDeadline?.deadline ? (
      <ChugCountdownCard deadline={chugDeadline.deadline} isPast={chugDeadline.is_past} mine={chugDeadline.mine} />
    ) : null;

  const cards: Record<string, ReactNode> = {
    yourWeek: <YourWeekSlot myWeek={myWeek.data ?? null} isGameDay={isGameDay} leagueName={leagueName} color={appearance.yourWeek} />,
    awards:
      awards && week !== null ? (
        <AwardsCard awards={awards.awards} awardsWeek={awards.week} currentWeek={week} recap={recap} />
      ) : null,
    standings: standings.length > 0 ? <StandingsCard standings={standings} /> : null,
    powerRankings:
      powerRankings.length > 0 || (!weekPlayed && season !== null) ? (
        <PowerRankingsCard rankings={powerRankings} waiting={powerRankings.length === 0} />
      ) : null,
    matchups: otherMatchups.length > 0 ? <OtherMatchupsCard matchups={otherMatchups} isGameDay={isGameDay} /> : null,
    // Only when a rivalry matchup is actually on this week's schedule.
    rivalries: rivalryGames.length > 0 ? <RivalriesCard games={rivalryGames} /> : null,
    chugFeed: houseRules?.chugEnabled && chugFeed.length > 0 ? <ChugFeedCard chugs={chugFeed} /> : null,
    activity: activity.length > 0 ? <ActivityCard items={activity} /> : null,
    discover: <DiscoverCard ringColor={appearance.ring} />,
  };

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={appearance.accent} />}>
      <View>
        <View style={styles.liveRow}>
          <View style={[styles.liveDot, !isGameDay && styles.liveDotIdle]} />
          <Text style={styles.liveLabel}>The Weekend Live</Text>
          {leagueTickerItems.length > 0 && leagueName && (
            <Text style={styles.liveLabel} numberOfLines={1}>
              · {leagueName}
            </Text>
          )}
          {isGameDay && (
            <View style={styles.gameDay}>
              <Text style={styles.gameDayText}>Game Day</Text>
            </View>
          )}
        </View>
        <View style={styles.tickers}>
          <TickerStrips nfl={tickerItems} league={leagueTickerItems} fast={isGameDay} />
        </View>
      </View>

      {/* Your Week always leads, then the draft or chug countdown. */}
      {cards.yourWeek}
      {topCard}
      {liveNflGames.length > 0 && <LiveNowCard games={liveNflGames} findGamecastId={findGamecastId} />}
      {/* The Lounge left the tab bar (2026-10) — on game day it's one tap from here. */}
      {isGameDay && (
        <Pressable onPress={() => router.push('/lounge')} style={({ pressed }) => [styles.loungeCard, pressed && styles.pressed]}>
          <Text style={styles.loungeTitle}>🛋 The Lounge is open</Text>
          <Text style={styles.loungeText}>Watch the games with your league →</Text>
        </Pressable>
      )}

      {cardOrder(prefs.data?.home_card_order)
        .filter((key) => key !== 'yourWeek')
        .map((key) => (cards[key] ? <View key={key}>{cards[key]}</View> : null))}

      {draft?.status === 'complete' && (
        <Pressable onPress={() => router.push('/draft')} hitSlop={8} style={styles.footerLink}>
          <Text style={styles.footerText}>Draft results</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

// The hero, or the web's EmptyHero when there's no matchup to show.
function YourWeekSlot(props: { myWeek: YourWeek | null; isGameDay: boolean; leagueName: string | null; color: string }) {
  const { myWeek } = props;
  if (myWeek?.matchup) {
    return <YourWeekCard myWeek={myWeek} isGameDay={props.isGameDay} leagueName={props.leagueName} color={props.color} />;
  }
  if (!myWeek) {
    // /me/week fails for an account that hasn't joined a league yet.
    return <MessageState message="You're signed in, but not on a team yet. Join or create a league to get started." />;
  }
  return (
    <NeonPanel color={props.color} contentStyle={styles.emptyHero}>
      <Display style={styles.emptyTitle}>{myWeek.team_name}</Display>
      <Text style={styles.emptyText}>
        {myWeek.week === null || myWeek.week < 1
          ? "No matchup yet — the season hasn't started."
          : "No matchup this week (bye week or the schedule isn't set yet)."}
      </Text>
    </NeonPanel>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.xl },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.live },
  liveDotIdle: { backgroundColor: 'rgba(255,255,255,0.3)' },
  liveLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  gameDay: { backgroundColor: 'rgba(239,68,68,0.15)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  gameDayText: { color: '#ef4444', fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  tickers: { marginTop: Spacing.sm, gap: 6 },
  emptyHero: { gap: Spacing.sm },
  emptyTitle: { fontSize: 20 },
  emptyText: { color: Colors.textSecondary, fontSize: 14 },
  loungeCard: { borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, padding: Spacing.lg, gap: 2 },
  loungeTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  loungeText: { color: Colors.textSecondary, fontSize: 13 },
  pressed: { opacity: 0.7 },
  footerLink: { alignSelf: 'center' },
  footerText: { color: Colors.textSecondary, fontSize: 14 },
});

export default function HomeScreen() {
  return (
    <TabFrame>
      <HomeScreenContent />
    </TabFrame>
  );
}
