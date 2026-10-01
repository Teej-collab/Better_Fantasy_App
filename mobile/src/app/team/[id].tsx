import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { openOwner, PageTitle } from '@/components/league/LeagueUI';
import { Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { sleeperHeadshotUrl } from '@/lib/nflTeams';
import { openPlayer, useSeasonWeek, useTeamDetail, useTeamRoster } from '@/lib/queries';
import type { RosterPlayer } from '@/lib/types';

const WEEKS = Array.from({ length: 17 }, (_, i) => i + 1);

// Port of the web's /teams/[teamId]: any team's roster for any week,
// starters then bench/IR, with projections and finals.
export default function TeamScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const teamId = Number(id);
  const team = useTeamDetail(teamId);
  const currentWeek = useSeasonWeek().data?.week ?? null;
  const [week, setWeek] = useState<number | null>(null);
  const shown = week ?? currentWeek;
  const roster = useTeamRoster(teamId, shown);

  if (team.isPending) return <LoadingState />;
  if (!team.data) return <MessageState message="Team not found." />;
  const t = team.data;
  const players = roster.data ?? [];
  const starters = players.filter((p) => p.lineup_slot !== 'BE' && p.lineup_slot !== 'IR');
  const bench = players.filter((p) => p.lineup_slot === 'BE' || p.lineup_slot === 'IR');

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
      <Stack.Screen options={{ title: t.team_name }} />
      <View style={styles.gapSm}>
        <PageTitle>{t.team_name}</PageTitle>
        <Text style={styles.muted}>
          <Text style={styles.link} onPress={() => openOwner(t.owner_id, t.season)}>
            {t.owner_name}
          </Text>
          {` — ${t.season} season`}
        </Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.weeks}>
        {WEEKS.map((w) => (
          <Pressable key={w} onPress={() => setWeek(w)} style={[styles.week, w === shown && styles.weekActive]}>
            <Text style={[styles.weekText, w === shown && styles.weekTextActive]}>Wk {w}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {roster.isPending ? (
        <LoadingState />
      ) : players.length === 0 ? (
        <Text style={styles.muted}>No roster data for week {shown}.</Text>
      ) : (
        <View style={styles.gap}>
          <RosterList title="Starters" players={starters} />
          <RosterList title="Bench / IR" players={bench} />
        </View>
      )}
    </ScrollView>
  );
}

// The web's RosterList: slot, headshot, name with 🔥 boom / 🥶 bust,
// projection and final points.
function RosterList({ title, players }: { title: string; players: RosterPlayer[] }) {
  if (players.length === 0) return null;
  return (
    <View>
      <View style={styles.listHead}>
        <Text style={styles.listTitle}>{title}</Text>
        <View style={styles.cols}>
          <Text style={styles.colHead}>Proj</Text>
          <Text style={styles.colHead}>Final</Text>
        </View>
      </View>
      {players.map((p, i) => {
        const headshot = typeof p.player_id === 'string' ? sleeperHeadshotUrl(p.player_id) : null;
        return (
          <Pressable key={i} onPress={() => openPlayer(p.player_id)} style={[styles.row, i > 0 && styles.divided]}>
            <Text style={styles.slot}>{p.lineup_slot}</Text>
            {headshot ? (
              <Image source={{ uri: headshot }} style={styles.headshot} contentFit="cover" />
            ) : (
              <View style={styles.headshot} />
            )}
            <Text style={styles.name} numberOfLines={1}>
              {p.player_name}
              {p.is_boom ? ' 🔥' : ''}
              {p.is_bust ? ' 🥶' : ''}
            </Text>
            <View style={styles.cols}>
              <Text style={styles.proj}>{p.points_projected !== null ? Number(p.points_projected).toFixed(1) : '—'}</Text>
              <Text style={styles.final}>{p.points_scored !== null ? Number(p.points_scored).toFixed(1) : '—'}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.lg },
  gap: { gap: Spacing.xl },
  gapSm: { gap: 4 },
  muted: { color: 'rgba(255,255,255,0.6)', fontSize: 14 },
  link: { color: Colors.text, textDecorationLine: 'underline' },
  weeks: { gap: Spacing.sm },
  week: { backgroundColor: Colors.surface, borderRadius: Radius.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 12, paddingVertical: 6 },
  weekActive: { borderColor: 'rgba(255,255,255,0.2)', backgroundColor: 'rgba(255,255,255,0.1)' },
  weekText: { color: 'rgba(255,255,255,0.6)', fontSize: 14 },
  weekTextActive: { color: Colors.text, fontWeight: '600' },
  listHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 },
  listTitle: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: '500' },
  cols: { flexDirection: 'row', gap: Spacing.md },
  colHead: { width: 40, textAlign: 'right', color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.05)' },
  slot: { width: 60, color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  headshot: { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.border },
  name: { flex: 1, color: Colors.text, fontSize: 14 },
  proj: { width: 40, textAlign: 'right', color: 'rgba(255,255,255,0.5)', fontSize: 14, fontVariant: ['tabular-nums'] },
  final: { width: 40, textAlign: 'right', color: Colors.text, fontSize: 14, fontWeight: '500', fontVariant: ['tabular-nums'] },
});
