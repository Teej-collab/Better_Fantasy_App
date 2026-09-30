import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card, formatScore, LoadingState, MessageState, PressableRow, SectionTitle, TeamAvatar } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { useMatchupContext, useMyWeek, useSeasonWeek } from '@/lib/queries';
import type { WeekMatchupContextItem, YourWeek } from '@/lib/types';

export default function HomeScreen() {
  const { signOut } = useAuth();
  const seasonWeek = useSeasonWeek();
  const myWeek = useMyWeek();
  const season = seasonWeek.data?.season ?? null;
  const week = seasonWeek.data?.week ?? null;
  const context = useMatchupContext(season, week);
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([seasonWeek.refetch(), myWeek.refetch(), context.refetch()]);
    setRefreshing(false);
  }

  if (myWeek.isPending && seasonWeek.isPending) return <LoadingState />;
  if (myWeek.isError && !myWeek.data) {
    return <MessageState message="Couldn't load your league. Pull down to try again." />;
  }

  const myMatchupId = myWeek.data?.matchup?.matchup_id;
  const others = (context.data?.matchups ?? []).filter((m) => m.matchup_id !== myMatchupId);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{week !== null ? `Week ${week}` : 'Weekend League'}</Text>
        <Pressable onPress={signOut} hitSlop={12}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>

      {myWeek.data && <YourWeekCard myWeek={myWeek.data} />}

      {others.length > 0 && (
        <>
          <SectionTitle>Around the league</SectionTitle>
          <Card style={styles.listCard}>
            {others.map((m, i) => (
              <View key={m.matchup_id}>
                {i > 0 && <View style={styles.divider} />}
                <MatchupRow matchup={m} />
              </View>
            ))}
          </Card>
        </>
      )}
    </ScrollView>
  );
}

function YourWeekCard({ myWeek }: { myWeek: YourWeek }) {
  const m = myWeek.matchup;
  if (!m) {
    const message =
      myWeek.week === null || myWeek.week < 1
        ? "No matchup yet — the season hasn't started."
        : 'No matchup this week.';
    return (
      <Card>
        <Text style={styles.teamName}>{myWeek.team_name}</Text>
        <Text style={styles.muted}>{message}</Text>
      </Card>
    );
  }

  return (
    <Pressable onPress={() => router.push({ pathname: '/matchup/[id]', params: { id: String(m.matchup_id) } })}>
      {({ pressed }) => (
        <Card style={pressed ? styles.pressed : undefined}>
          <Text style={styles.kicker}>Your matchup</Text>
          <View style={styles.hero}>
            <HeroSide
              name={myWeek.team_name}
              logoUrl={m.my_logo_url}
              record={m.record}
              score={m.my_score}
              projected={m.my_projected_total}
            />
            <Text style={styles.vs}>vs</Text>
            <HeroSide
              name={m.opponent_team_name}
              logoUrl={m.opponent_logo_url}
              record={m.opponent_record}
              score={m.opponent_score}
              projected={m.opponent_projected_total}
            />
          </View>
          {m.win_probability !== null && (
            <WinBar probability={m.win_probability} />
          )}
        </Card>
      )}
    </Pressable>
  );
}

function HeroSide(props: {
  name: string;
  logoUrl: string | null;
  record: string | null;
  score: number | null;
  projected: number;
}) {
  return (
    <View style={styles.heroSide}>
      <TeamAvatar name={props.name} logoUrl={props.logoUrl} size={48} />
      <Text style={styles.heroName} numberOfLines={2}>
        {props.name}
      </Text>
      {props.record && <Text style={styles.muted}>{props.record}</Text>}
      <Text style={styles.heroScore}>{formatScore(props.score)}</Text>
      <Text style={styles.muted}>Proj {props.projected.toFixed(1)}</Text>
    </View>
  );
}

function WinBar({ probability }: { probability: number }) {
  const pct = Math.round(probability * 100);
  return (
    <View style={styles.winWrap}>
      <View style={styles.winTrack}>
        <View style={[styles.winFill, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.muted}>{pct}% to win</Text>
    </View>
  );
}

function MatchupRow({ matchup }: { matchup: WeekMatchupContextItem }) {
  return (
    <PressableRow
      onPress={() => router.push({ pathname: '/matchup/[id]', params: { id: String(matchup.matchup_id) } })}>
      {[matchup.home, matchup.away].map((side) => (
        <View key={side.team_id} style={styles.rowSide}>
          <TeamAvatar name={side.team_name} logoUrl={side.logo_url} size={28} />
          <Text style={styles.rowName} numberOfLines={1}>
            {side.team_name}
          </Text>
          <Text style={styles.rowScore}>{formatScore(side.score)}</Text>
        </View>
      ))}
    </PressableRow>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.lg },
  headerTitle: { color: Colors.text, fontSize: 28, fontWeight: '800' },
  signOut: { color: Colors.textSecondary, fontSize: 14 },
  kicker: {
    color: Colors.accent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: Spacing.md,
  },
  teamName: { color: Colors.text, fontSize: 18, fontWeight: '700', marginBottom: Spacing.xs },
  muted: { color: Colors.textSecondary, fontSize: 13 },
  pressed: { opacity: 0.85 },
  hero: { flexDirection: 'row', alignItems: 'flex-start' },
  heroSide: { flex: 1, alignItems: 'center', gap: Spacing.xs },
  heroName: { color: Colors.text, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  heroScore: { color: Colors.text, fontSize: 32, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: Spacing.sm },
  vs: { color: Colors.textSecondary, fontSize: 13, marginTop: 64 },
  winWrap: { marginTop: Spacing.lg, gap: Spacing.xs, alignItems: 'center' },
  winTrack: { height: 6, alignSelf: 'stretch', borderRadius: 3, backgroundColor: Colors.border, overflow: 'hidden' },
  winFill: { height: 6, backgroundColor: Colors.accent },
  listCard: { padding: 0, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.border },
  rowSide: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 3 },
  rowName: { flex: 1, color: Colors.text, fontSize: 15 },
  rowScore: { color: Colors.text, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
