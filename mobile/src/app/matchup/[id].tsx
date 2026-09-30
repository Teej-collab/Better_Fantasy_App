import { useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card, formatScore, LoadingState, MessageState, SectionTitle, TeamAvatar } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { openPlayer, useMatchup } from '@/lib/queries';
import type { MatchupContextSide, RosterPlayer } from '@/lib/types';

const BENCH_SLOTS = new Set(['BE', 'Bench', 'IR']);

export default function MatchupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const matchup = useMatchup(Number(id));

  if (matchup.isPending) return <LoadingState />;
  if (matchup.isError || !matchup.data) return <MessageState message="Couldn't load this matchup." />;

  const { home, away } = matchup.data;
  const starters = (side: MatchupContextSide) => side.roster.filter((p) => !BENCH_SLOTS.has(p.lineup_slot ?? ''));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
      <Card>
        <View style={styles.scoreboard}>
          <Side side={home} />
          <Text style={styles.vs}>vs</Text>
          <Side side={away} />
        </View>
      </Card>

      <SectionTitle>Starters</SectionTitle>
      <Card style={styles.listCard}>
        <StarterColumns home={starters(home)} away={starters(away)} />
      </Card>
    </ScrollView>
  );
}

function Side({ side }: { side: MatchupContextSide }) {
  return (
    <View style={styles.side}>
      <TeamAvatar name={side.team_name} logoUrl={side.logo_url} size={48} />
      <Text style={styles.teamName} numberOfLines={2}>
        {side.team_name}
      </Text>
      {side.record && <Text style={styles.muted}>{side.record}</Text>}
      <Text style={styles.score}>{formatScore(side.score)}</Text>
      {side.projected_total !== null && <Text style={styles.muted}>Proj {side.projected_total.toFixed(1)}</Text>}
    </View>
  );
}

// Side-by-side starters, paired by position order like the web
// matchup page.
function StarterColumns({ home, away }: { home: RosterPlayer[]; away: RosterPlayer[] }) {
  const rows = Math.max(home.length, away.length);
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={[styles.pairRow, i > 0 && styles.divided]}>
          <PlayerCell player={home[i]} align="left" />
          <Text style={styles.slot}>{home[i]?.lineup_slot ?? away[i]?.lineup_slot ?? ''}</Text>
          <PlayerCell player={away[i]} align="right" />
        </View>
      ))}
    </>
  );
}

function PlayerCell({ player, align }: { player: RosterPlayer | undefined; align: 'left' | 'right' }) {
  if (!player) return <View style={styles.cell} />;
  const right = align === 'right';
  return (
    <Pressable
      onPress={() => openPlayer(player.player_id)}
      style={({ pressed }) => [styles.cell, right && styles.cellRight, pressed && styles.pressed]}>
      <Text style={[styles.player, right && styles.textRight]} numberOfLines={1}>
        {player.player_name}
      </Text>
      <Text style={[styles.points, right && styles.textRight]}>
        {formatScore(player.points_scored)}
        {player.game_status === 'in_progress' ? ' •' : ''}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2 },
  scoreboard: { flexDirection: 'row', alignItems: 'flex-start' },
  side: { flex: 1, alignItems: 'center', gap: Spacing.xs },
  teamName: { color: Colors.text, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  score: { color: Colors.text, fontSize: 32, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: Spacing.sm },
  muted: { color: Colors.textSecondary, fontSize: 13 },
  vs: { color: Colors.textSecondary, fontSize: 13, marginTop: 64 },
  listCard: { padding: 0, overflow: 'hidden' },
  pairRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  slot: { width: 44, textAlign: 'center', color: Colors.textSecondary, fontSize: 11, fontWeight: '700' },
  cell: { flex: 1 },
  cellRight: { alignItems: 'flex-end' },
  player: { color: Colors.text, fontSize: 14 },
  points: { color: Colors.textSecondary, fontSize: 13, fontVariant: ['tabular-nums'] },
  textRight: { textAlign: 'right' },
  pressed: { opacity: 0.6 },
});
