import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { InjuryTag } from '@/components/players/InjuryTag';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { openPlayer, useTrendingPlayers } from '@/lib/queries';
import type { TrendingKind, TrendingPlayer, TrendingSource, TrendingWindow } from '@/lib/types';

// Same label → stored players.position mapping as the Players tab.
const POSITIONS: { label: string; value: string | undefined }[] = [
  { label: 'All', value: undefined },
  { label: 'QB', value: 'QB' },
  { label: 'RB', value: 'RB' },
  { label: 'WR', value: 'WR' },
  { label: 'TE', value: 'TE' },
  { label: 'D/ST', value: 'DEF' },
  { label: 'K', value: 'K' },
];
const WINDOW_LABEL: Record<TrendingWindow, string> = { '24h': '24 hrs', '7d': '7 days', season: 'Season' };

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        haptics.select();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.chip, active && styles.chipOn]}>
      <Text style={[styles.chipText, active && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

// Most added / dropped players across every league in the app (moves made
// on ESPN and Sleeper in connected leagues included), or across all of Sleeper.
export default function TrendingScreen() {
  const [source, setSource] = useState<TrendingSource>('app');
  const [kind, setKind] = useState<TrendingKind>('add');
  const [lookback, setLookback] = useState<TrendingWindow>('7d');
  const [position, setPosition] = useState<string | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  // Sleeper's feed only looks back by hours, so no season view there.
  const windows: TrendingWindow[] = source === 'sleeper' ? ['24h', '7d'] : ['24h', '7d', 'season'];
  const span = windows.includes(lookback) ? lookback : '7d';
  const trending = useTrendingPlayers(kind, span, source, position);
  const data = trending.data;

  async function onRefresh() {
    setRefreshing(true);
    await trending.refetch();
    setRefreshing(false);
  }

  const verb = kind === 'add' ? 'added' : 'dropped';
  const blurb =
    source === 'app'
      ? `Most ${verb} across ${data?.leagues_tracked ?? '…'} ${data?.leagues_tracked === 1 ? 'league' : 'leagues'} on The Weekend`
      : `Most ${verb} across every Sleeper league`;

  return (
    <FlatList
      style={styles.screen}
      data={data?.players ?? []}
      keyExtractor={(p) => p.sleeper_player_id}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.chips}>
            <Chip label="The Weekend" active={source === 'app'} onPress={() => setSource('app')} />
            <Chip label="All of Sleeper" active={source === 'sleeper'} onPress={() => setSource('sleeper')} />
          </View>
          <View style={styles.chips}>
            <Chip label="Adds" active={kind === 'add'} onPress={() => setKind('add')} />
            <Chip label="Drops" active={kind === 'drop'} onPress={() => setKind('drop')} />
            <View style={styles.divider} />
            {windows.map((w) => (
              <Chip key={w} label={WINDOW_LABEL[w]} active={span === w} onPress={() => setLookback(w)} />
            ))}
          </View>
          <View style={styles.chips}>
            {POSITIONS.map((p) => (
              <Chip key={p.label} label={p.label} active={p.value === position} onPress={() => setPosition(p.value)} />
            ))}
          </View>
          <Text style={styles.blurb}>{blurb}</Text>
        </View>
      }
      ListEmptyComponent={
        trending.isPending ? (
          <LoadingState />
        ) : trending.isError ? (
          <MessageState message="Couldn't load trending players." />
        ) : (
          <MessageState message={source === 'app' ? `No one ${verb} in this window yet.` : "Sleeper's feed is empty right now."} />
        )
      }
      renderItem={({ item, index }) => <Row player={item} rank={index + 1} source={source} />}
    />
  );
}

function Row({ player, rank, source }: { player: TrendingPlayer; rank: number; source: TrendingSource }) {
  return (
    <Pressable
      onPress={() => openPlayer(player.sleeper_player_id)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${player.full_name}, ${player.count}`}>
      <Text style={styles.rank}>{rank}</Text>
      <PlayerHeadshot url={player.headshot_url} position={player.position} size={34} />
      <View style={styles.text}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {player.full_name}
          </Text>
          <InjuryTag status={player.injury_status} />
        </View>
        <Text style={styles.detail} numberOfLines={1}>
          {player.position === 'DEF' ? 'D/ST' : player.position} · {player.pro_team ?? 'FA'}
          {'  '}
          {player.available ? <Text style={styles.available}>Available</Text> : 'Rostered in your league'}
        </Text>
      </View>
      <View style={styles.countCol}>
        <Text style={styles.count}>{player.count.toLocaleString()}</Text>
        {source === 'app' && player.leagues !== null && (
          <Text style={styles.leagues}>
            {player.leagues} {player.leagues === 1 ? 'league' : 'leagues'}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: Spacing.xl * 2 },
  header: { padding: Spacing.lg, gap: Spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm },
  chip: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  chipOn: { backgroundColor: Colors.text, borderColor: Colors.text },
  chipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: Colors.bg },
  divider: { width: StyleSheet.hairlineWidth, height: 20, backgroundColor: Colors.border },
  blurb: { color: Colors.textSecondary, fontSize: 12, marginTop: Spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  pressed: { opacity: 0.6 },
  rank: { width: 20, textAlign: 'right', color: Colors.textSecondary, fontSize: 12, fontVariant: ['tabular-nums'] },
  text: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { color: Colors.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  detail: { color: Colors.textSecondary, fontSize: 12 },
  available: { color: '#22c55e', fontWeight: '700' },
  countCol: { alignItems: 'flex-end', minWidth: 52 },
  count: { color: Colors.text, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  leagues: { color: Colors.textSecondary, fontSize: 10 },
});
