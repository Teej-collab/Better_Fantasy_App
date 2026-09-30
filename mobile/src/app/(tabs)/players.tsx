import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';

import { Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatGameTime, formatPoints } from '@/lib/format';
import { openPlayer, useFreeAgents } from '@/lib/queries';
import type { FreeAgent } from '@/lib/types';

// Label → stored players.position value. Defenses are stored as "DEF"
// (same mapping as the web's free-agents page).
const POSITIONS: { label: string; value: string | undefined }[] = [
  { label: 'All', value: undefined },
  { label: 'QB', value: 'QB' },
  { label: 'RB', value: 'RB' },
  { label: 'WR', value: 'WR' },
  { label: 'TE', value: 'TE' },
  { label: 'D/ST', value: 'DEF' },
  { label: 'K', value: 'K' },
];

export default function PlayersScreen() {
  const [position, setPosition] = useState<string | undefined>(undefined);
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const players = useFreeAgents(position, search);

  // Wait for a pause in typing before searching.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchText.trim()), 300);
    return () => clearTimeout(t);
  }, [searchText]);

  async function onRefresh() {
    setRefreshing(true);
    await players.refetch();
    setRefreshing(false);
  }

  return (
    <View style={styles.screen}>
      <FlatList
        data={players.data ?? []}
        keyExtractor={(p) => p.sleeper_player_id}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        initialNumToRender={20}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>Players</Text>
              <Pressable onPress={() => router.push('/waivers')} hitSlop={12}>
                <Text style={styles.link}>My claims</Text>
              </Pressable>
            </View>
            <TextInput
              value={searchText}
              onChangeText={setSearchText}
              placeholder="Search free agents"
              placeholderTextColor={Colors.textSecondary}
              autoCorrect={false}
              clearButtonMode="while-editing"
              style={styles.search}
            />
            <View style={styles.chips}>
              {POSITIONS.map((p) => {
                const active = p.value === position;
                return (
                  <Pressable
                    key={p.label}
                    onPress={() => setPosition(p.value)}
                    style={[styles.chip, active && styles.chipActive]}>
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{p.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.columns}>
              <Text style={[styles.columnLabel, styles.flex]}>Player</Text>
              <Text style={[styles.columnLabel, styles.num]}>Last</Text>
              <Text style={[styles.columnLabel, styles.num]}>Proj</Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          players.isPending ? (
            <LoadingState />
          ) : players.isError ? (
            <MessageState message="Couldn't load players." />
          ) : (
            <MessageState message="No free agents match." />
          )
        }
        renderItem={({ item }) => <PlayerRow player={item} onPress={() => openPlayer(item.sleeper_player_id)} />}
      />
    </View>
  );
}

function PlayerRow({ player, onPress }: { player: FreeAgent; onPress: () => void }) {
  const onWaivers = !!player.waiver_clears_at || player.game_locked;
  const detail = [
    `${player.position === 'DEF' ? 'D/ST' : player.position}${player.pro_team ? ` · ${player.pro_team}` : ''}`,
    player.next_opponent && (player.game_time ? `${player.next_opponent} ${formatGameTime(player.game_time)}` : player.next_opponent),
  ]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={styles.flex}>
        <View style={styles.nameLine}>
          <Text style={styles.name} numberOfLines={1}>
            {player.full_name}
          </Text>
          {player.injury_status && <Text style={styles.injury}>{player.injury_status}</Text>}
          {onWaivers && <Text style={styles.waiver}>W</Text>}
        </View>
        <Text style={styles.detail} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <Text style={[styles.num, styles.value]}>{formatPoints(player.last_week_score)}</Text>
      <Text style={[styles.num, styles.value, styles.proj]}>{formatPoints(player.projected_points)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: Spacing.xl * 2 },
  header: { padding: Spacing.lg, paddingBottom: Spacing.sm, gap: Spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: Colors.text, fontSize: 28, fontWeight: '800' },
  link: { color: Colors.accent, fontSize: 15, fontWeight: '600' },
  search: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.md,
    color: Colors.text,
    fontSize: 16,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  chipActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  chipText: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: Colors.bg },
  columns: { flexDirection: 'row', paddingHorizontal: Spacing.xs },
  columnLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  flex: { flex: 1 },
  num: { width: 56, textAlign: 'right' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg + Spacing.xs,
    paddingVertical: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  rowPressed: { backgroundColor: Colors.surface },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  name: { color: Colors.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  injury: { color: Colors.loss, fontSize: 11, fontWeight: '700' },
  waiver: {
    color: Colors.bg,
    backgroundColor: Colors.textSecondary,
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 4,
    borderRadius: 3,
    overflow: 'hidden',
  },
  detail: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  value: { color: Colors.textSecondary, fontSize: 15, fontVariant: ['tabular-nums'] },
  proj: { color: Colors.text, fontWeight: '700' },
});
