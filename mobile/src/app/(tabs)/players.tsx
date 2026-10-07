import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';

import { PreviewLink } from '@/components/PreviewLink';
import { TabFrame } from '@/components/TabFrame';
import { Text } from '@/components/Text';
import { PlayerActionSheet } from '@/components/PlayerActionSheet';
import { PlayerViewTable, PlayerViewsPill, usePlayerView } from '@/components/players/PlayerViews';
import { LoadingState, MessageState } from '@/components/ui';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { formatGameTime, formatPoints } from '@/lib/format';
import { openPlayer, useFreeAgents, useMe } from '@/lib/queries';
import type { FreeAgent } from '@/lib/types';

// Label → stored players.position value. Defenses are stored as "DEF"
// (same mapping as the web's free-agents page).
// ESPN's add / waiver-claim button colors.
const ADD_GREEN = '#22c55e';
const WAIVER_YELLOW = '#facc15';

const POSITIONS: { label: string; value: string | undefined }[] = [
  { label: 'All', value: undefined },
  { label: 'QB', value: 'QB' },
  { label: 'RB', value: 'RB' },
  { label: 'WR', value: 'WR' },
  { label: 'TE', value: 'TE' },
  { label: 'D/ST', value: 'DEF' },
  { label: 'K', value: 'K' },
];
// IDP leagues (2026-10) also filter by defender group.
const IDP_POSITIONS: { label: string; value: string | undefined }[] = [
  { label: 'DL', value: 'DL' },
  { label: 'LB', value: 'LB' },
  { label: 'DB', value: 'DB' },
];

function PlayersScreenContent() {
  const idp = useMe().data?.league_format?.roster_preset === 'idp';
  const [position, setPosition] = useState<string | undefined>(undefined);
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState<FreeAgent | null>(null);
  const players = useFreeAgents(position, search);
  // ESPN's Views menu: Matchup Stats is this list; every other view is a stat table.
  const [view, setView] = usePlayerView('wl:player-view:free-agents');
  const list = players.data ?? [];

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
        data={view === 'matchup' ? list : []}
        keyExtractor={(p) => p.sleeper_player_id}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        initialNumToRender={20}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={[styles.titleRow, { justifyContent: 'flex-end' }]}>
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
              {[...POSITIONS, ...(idp ? IDP_POSITIONS : [])].map((p) => {
                const active = p.value === position;
                return (
                  <Pressable
                    key={p.label}
                    onPress={() => {
                      haptics.select();
                      setPosition(p.value);
                    }}
                    style={[styles.chip, active && styles.chipActive]}>
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{p.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.availableRow}>
              <Text style={styles.available}>Available</Text>
              <PlayerViewsPill view={view} onChange={setView} />
            </View>
            {view === 'matchup' && (
              <View style={styles.columns}>
                <View style={styles.addSpacer} />
                <Text style={[styles.columnLabel, styles.flex]}>Player</Text>
                <Text style={[styles.columnLabel, styles.num]}>Last</Text>
                <Text style={[styles.columnLabel, styles.num]}>Proj</Text>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          view !== 'matchup' && list.length > 0 ? (
            <View style={styles.viewTable}>
              <PlayerViewTable
                view={view}
                rows={list.map((p) => ({
                  id: p.sleeper_player_id,
                  position: p.position,
                  cell: <ViewCell player={p} onPress={() => openPlayer(p.sleeper_player_id)} onAdd={() => setAdding(p)} />,
                }))}
              />
            </View>
          ) : players.isPending ? (
            <LoadingState />
          ) : players.isError ? (
            <MessageState message="Couldn't load players." />
          ) : (
            <MessageState message="No free agents match." />
          )
        }
        renderItem={({ item }) => (
          <PlayerRow player={item} onAdd={() => setAdding(item)} />
        )}
      />
      {adding && <PlayerActionSheet player={adding} onClose={() => setAdding(null)} />}
    </View>
  );
}

// ESPN's add button: green + for a free agent you can pick up now,
// yellow + for one on waivers (that tap files a claim instead).
function AddButton({ onWaivers, onPress }: { onWaivers: boolean; onPress: () => void }) {
  const color = onWaivers ? WAIVER_YELLOW : ADD_GREEN;
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={onWaivers ? 'Place waiver claim' : 'Add player'}
      style={({ pressed }) => [styles.addButton, { borderColor: color, backgroundColor: `${color}22` }, pressed && styles.addPressed]}>
      <Text style={[styles.addPlus, { color }]}>+</Text>
    </Pressable>
  );
}

// The pinned player column in a stat view: the same add button, then name and team.
function ViewCell({ player, onPress, onAdd }: { player: FreeAgent; onPress: () => void; onAdd: () => void }) {
  const onWaivers = !!player.waiver_clears_at || player.game_locked;
  return (
    <View style={styles.viewCell}>
      <AddButton onWaivers={onWaivers} onPress={onAdd} />
      <Pressable onPress={onPress} style={styles.flex}>
        <Text style={styles.viewName} numberOfLines={1}>
          {player.full_name}
        </Text>
        <Text style={styles.detail} numberOfLines={1}>
          {player.position === 'DEF' ? 'D/ST' : player.position} · {player.pro_team ?? '—'}
          {onWaivers ? '  · W' : ''}
        </Text>
      </Pressable>
    </View>
  );
}

function PlayerRow({ player, onAdd }: { player: FreeAgent; onAdd: () => void }) {
  const onWaivers = !!player.waiver_clears_at || player.game_locked;
  const detail = [
    `${player.position === 'DEF' ? 'D/ST' : player.position}${player.pro_team ? ` · ${player.pro_team}` : ''}`,
    player.next_opponent && (player.game_time ? `${player.next_opponent} ${formatGameTime(player.game_time)}` : player.next_opponent),
  ]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <PreviewLink
      href={{ pathname: '/player/[id]', params: { id: player.sleeper_player_id } }}
      menu={[
        { title: onWaivers ? 'Place Waiver Claim' : 'Add to Roster', icon: onWaivers ? 'clock' : 'plus.circle', onPress: onAdd },
      ]}
      style={styles.row}
      pressedStyle={styles.rowPressed}>
      <AddButton onWaivers={onWaivers} onPress={onAdd} />
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
    </PreviewLink>
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
  chip: { backgroundColor: Colors.surface,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  chipActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  chipText: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: Colors.bg },
  // Full-bleed, on the same solid surface as the rows below it.
  columns: {
    flexDirection: 'row',
    marginHorizontal: -Spacing.lg,
    marginBottom: -Spacing.sm,
    paddingHorizontal: Spacing.lg + Spacing.xs,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
  },
  columnLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  flex: { flex: 1 },
  num: { width: 56, textAlign: 'right' },
  row: {
    backgroundColor: Colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg + Spacing.xs,
    paddingVertical: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  rowPressed: { backgroundColor: Colors.tileRaised },
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
  addButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  addPressed: { opacity: 0.6 },
  addPlus: { fontSize: 20, lineHeight: 22, fontWeight: '700' },
  addSpacer: { width: 28 + Spacing.md },
  availableRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  available: { color: Colors.text, fontSize: 18, fontFamily: Fonts.display, letterSpacing: 1, textTransform: 'uppercase' },
  viewTable: { paddingHorizontal: Spacing.lg },
  viewCell: { flexDirection: 'row', alignItems: 'center' },
  viewName: { color: Colors.text, fontSize: 14, fontWeight: '600' },
});

// Players — a tab again (App Store pass, 2026-10): checking free agents
// is a daily habit, the Lounge a Sunday one, so the Lounge moved to Home
// and the account menu. Also reached from My Team's sub-nav.
export default function PlayersScreen() {
  return (
    <TabFrame>
      <PlayersScreenContent />
    </TabFrame>
  );
}
