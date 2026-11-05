import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

import { ANTON, Elite, hexPoints, HEX_RATIO, SATISFY } from '@/components/elite/Elite';
import { InjuryTag } from '@/components/players/InjuryTag';
import { OnTheWire } from '@/components/players/OnTheWire';
import { PreviewLink } from '@/components/PreviewLink';
import { TabFrame, useTabScrollRef } from '@/components/TabFrame';
import { Text } from '@/components/Text';
import { PlayerActionSheet } from '@/components/PlayerActionSheet';
import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { PlayerViewTable, PlayerViewsPill, usePlayerView } from '@/components/players/PlayerViews';
import { LoadingState, MessageState } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { formatGameTimeShort, formatPoints } from '@/lib/format';
import { ordinal } from '@/lib/matchups';
import { teamLogoUrl } from '@/lib/nflTeams';
import { proposeTradeFor } from '@/lib/tradeLinks';
import { openPlayer, useFreeAgents, useMe } from '@/lib/queries';
import type { FreeAgent } from '@/lib/types';
import { useTabBarScroll } from '@/lib/tabBar';

// Free Agents, elite (App A "Hot Wire", 2026-11-05 canvas "Elite Free
// Agents + Trending"): the On the Wire strip of the day's most added
// players up top, then ESPN's list — hex add button (green add, yellow
// waiver claim), the player's headshot with his team's logo, % rostered
// and its 7-day +/- across every league in the app, this week's game
// with the opponent's rank against the position, and the projection.
const WAIVER_YELLOW = '#facc15';
const TRADE_BLUE = '#60a5fa';
// A player whose share of rosters jumped this much in a week is "hot".
const HOT_CHANGE = 5;

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
// IDP leagues (2026-10) also filter by defender group.
const IDP_POSITIONS: { label: string; value: string | undefined }[] = [
  { label: 'DL', value: 'DL' },
  { label: 'LB', value: 'LB' },
  { label: 'DB', value: 'DB' },
];

export function PlayersScreenContent() {
  const scrollRef = useTabScrollRef<FlatList<FreeAgent>>();
  const tabBarScroll = useTabBarScroll();
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
        ref={scrollRef}
        {...tabBarScroll}
        data={view === 'matchup' ? list : []}
        keyExtractor={(p) => p.sleeper_player_id}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        initialNumToRender={20}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Elite.green} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <View>
                <Text style={styles.kicker}>the</Text>
                <Text style={styles.title} accessibilityRole="header">
                  FREE AGENTS
                </Text>
              </View>
              <Pressable onPress={() => router.push('/waivers')} hitSlop={8} style={styles.claims}>
                <Text style={styles.claimsText}>My claims</Text>
              </Pressable>
            </View>
            {!search && <OnTheWire />}
            <TextInput
              value={searchText}
              onChangeText={setSearchText}
              placeholder="Search free agents"
              placeholderTextColor={Elite.grey}
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
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
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
                <Text style={[styles.columnLabel, styles.projCol]}>Proj</Text>
                <Text style={[styles.columnLabel, styles.trendCol]}>+/-</Text>
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
            <MessageState message={search ? 'No players match.' : 'No free agents match.'} />
          )
        }
        renderItem={({ item }) => <PlayerRow player={item} onAdd={() => setAdding(item)} />}
      />
      {adding && <PlayerActionSheet player={adding} onClose={() => setAdding(null)} />}
    </View>
  );
}

// The add button as a small hex: green + for a free agent you can pick up
// now, yellow + for one on waivers (that tap files a claim instead).
function HexButton({ color, label, glyph, onPress }: { color: string; label: string; glyph: string; onPress: () => void }) {
  const w = 28;
  const h = w * HEX_RATIO;
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.hexButton, pressed && styles.pressed]}>
      <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
        <Polygon points={hexPoints(w, h, 1)} fill={color} />
      </Svg>
      <Text style={styles.hexGlyph}>{glyph}</Text>
    </Pressable>
  );
}

// A search also finds rostered players (2026-10). They get a trade button
// instead of add — straight to a trade offer with their team for them —
// or nothing when they're already yours.
function isRostered(p: FreeAgent): boolean {
  return p.rostered_team_id != null;
}

function ownerLabel(p: FreeAgent): string {
  return p.is_mine ? 'Your team' : `On ${p.rostered_team_name ?? 'a team'}`;
}

function RowAction({ player, onAdd }: { player: FreeAgent; onAdd: () => void }) {
  const onWaivers = !!player.waiver_clears_at || player.game_locked;
  if (!isRostered(player)) {
    return (
      <HexButton
        color={onWaivers ? WAIVER_YELLOW : Elite.green}
        label={onWaivers ? 'Place waiver claim' : 'Add player'}
        glyph="+"
        onPress={onAdd}
      />
    );
  }
  if (player.is_mine) return <View style={styles.addButtonSpace} />;
  return (
    <HexButton color={TRADE_BLUE} label={`Propose a trade for ${player.full_name}`} glyph="⇄" onPress={() => proposeTradeFor(player)} />
  );
}

// The headshot with the team's logo on a badge; a D/ST is its logo. The
// list's rows use the cached image view (On the Wire's four cells are
// the hex portraits) so a long list scrolls smoothly.
function Portrait({ player, size = 40 }: { player: FreeAgent; size?: number }) {
  const isDef = player.position === 'DEF';
  const logo = teamLogoUrl(player.pro_team);
  return (
    <View style={{ width: size, height: size }}>
      <PlayerHeadshot url={isDef ? logo : player.headshot_url} position={player.position} size={size} />
      {!isDef && logo && (
        <View style={styles.logoBadge}>
          <PlayerHeadshot url={logo} position="DEF" size={16} />
        </View>
      )}
    </View>
  );
}

// The pinned player column in a stat view: the same add button, then name and team.
function ViewCell({ player, onPress, onAdd }: { player: FreeAgent; onPress: () => void; onAdd: () => void }) {
  const onWaivers = !!player.waiver_clears_at || player.game_locked;
  return (
    <View style={styles.viewCell}>
      <RowAction player={player} onAdd={onAdd} />
      <Portrait player={player} size={30} />
      <Pressable onPress={onPress} style={styles.flex}>
        <Text style={styles.viewName} numberOfLines={1}>
          {player.full_name}
        </Text>
        <Text style={styles.detail} numberOfLines={1}>
          {player.position === 'DEF' ? 'D/ST' : player.position} · {player.pro_team ?? '—'}
          {isRostered(player) ? `  · ${ownerLabel(player)}` : onWaivers ? '  · W' : ''}
        </Text>
      </Pressable>
    </View>
  );
}

function gameLine(player: FreeAgent): string | null {
  if (isRostered(player)) return ownerLabel(player);
  if (player.on_bye) return 'Bye week';
  if (!player.next_opponent) return null;
  const time = player.game_time ? `${formatGameTimeShort(player.game_time)} ` : '';
  const rank = player.opponent_position_rank ? ` (${ordinal(player.opponent_position_rank.rank)})` : '';
  return `${time}${player.next_opponent}${rank}`;
}

function rankColor(rank: number | undefined): string {
  if (!rank) return Elite.faint;
  if (rank <= 10) return '#ff6b6b';
  if (rank >= 23) return Elite.green;
  return Elite.faint;
}

function PlayerRow({ player, onAdd }: { player: FreeAgent; onAdd: () => void }) {
  const onWaivers = !!player.waiver_clears_at || player.game_locked;
  const change = player.rost_change ?? null;
  const hot = change !== null && change >= HOT_CHANGE;
  const game = gameLine(player);

  return (
    <PreviewLink
      href={{ pathname: '/player/[id]', params: { id: player.sleeper_player_id } }}
      menu={
        !isRostered(player)
          ? [{ title: onWaivers ? 'Place Waiver Claim' : 'Add to Roster', icon: onWaivers ? 'clock' : 'plus.circle', onPress: onAdd }]
          : player.is_mine
            ? []
            : [{ title: 'Propose Trade', icon: 'arrow.left.arrow.right', onPress: () => proposeTradeFor(player) }]
      }
      style={styles.row}
      pressedStyle={styles.rowPressed}>
      <RowAction player={player} onAdd={onAdd} />
      <Portrait player={player} />
      <View style={styles.flex}>
        <View style={styles.nameLine}>
          <Text style={styles.name} numberOfLines={1}>
            {player.full_name}
          </Text>
          <Text style={styles.pos}>{player.position === 'DEF' ? 'D/ST' : player.position}</Text>
          {hot && <Text style={styles.hot}>HOT</Text>}
          <InjuryTag status={player.injury_status} />
          {onWaivers && !isRostered(player) && <Text style={styles.waiver}>W</Text>}
        </View>
        {player.rost_pct != null && <Text style={styles.rost}>{player.rost_pct}% rost</Text>}
        {game && (
          <Text style={[styles.detail, { color: rankColor(player.opponent_position_rank?.rank) }]} numberOfLines={1}>
            {game}
          </Text>
        )}
      </View>
      <Text style={[styles.projCol, styles.proj]}>{player.on_bye ? 'Bye' : formatPoints(player.projected_points)}</Text>
      <Text style={[styles.trendCol, styles.trend, { color: change === null || change === 0 ? Elite.faint : change > 0 ? Elite.green : Elite.orange }]}>
        {change === null || change === 0 ? '—' : `${change > 0 ? '+' : '−'}${Math.abs(change)} ${change > 0 ? '▲' : '▼'}`}
      </Text>
    </PreviewLink>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: Spacing.xl * 2 },
  header: { padding: Spacing.md, paddingBottom: Spacing.sm, gap: Spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 4 },
  kicker: { fontFamily: SATISFY, fontSize: 22, lineHeight: 26, color: Elite.orange, marginLeft: 2 },
  title: {
    fontFamily: ANTON,
    fontSize: 36,
    lineHeight: 42,
    letterSpacing: 1,
    color: Elite.green,
    textShadowColor: 'rgba(57,255,20,0.55)',
    textShadowRadius: 12,
    textShadowOffset: { width: 0, height: 0 },
  },
  claims: { borderWidth: 1, borderColor: 'rgba(57,255,20,0.4)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 6 },
  claimsText: { color: Elite.cream, fontSize: 13, fontWeight: '700' },
  search: {
    backgroundColor: Elite.card,
    borderColor: Elite.line,
    borderWidth: 1,
    borderRadius: 12,
    color: Elite.cream,
    fontSize: 16,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 12, paddingVertical: 6 },
  chipActive: { backgroundColor: Elite.green, borderColor: Elite.green },
  chipText: { color: Elite.soft, fontSize: 13, fontWeight: '700' },
  chipTextActive: { color: Elite.deep },
  availableRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  available: { color: Elite.cream, fontSize: 18, fontFamily: ANTON, letterSpacing: 1.5, textTransform: 'uppercase' },
  // Full-bleed, on the same glass as the rows below it.
  columns: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: -Spacing.md,
    marginBottom: -Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    backgroundColor: Elite.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Elite.line,
  },
  columnLabel: { color: Elite.faint, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  flex: { flex: 1 },
  projCol: { width: 44, textAlign: 'right' },
  trendCol: { width: 58, textAlign: 'right' },
  addSpacer: { width: 28 + 10 + 40 + 10 },
  row: {
    backgroundColor: Elite.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Elite.line,
  },
  rowPressed: { backgroundColor: '#1a222c' },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { color: Elite.cream, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  pos: { color: Elite.faint, fontSize: 11, fontWeight: '600' },
  hot: {
    color: Elite.deep,
    backgroundColor: Elite.orange,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: 'hidden',
  },
  waiver: {
    color: Elite.deep,
    backgroundColor: WAIVER_YELLOW,
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 4,
    borderRadius: 3,
    overflow: 'hidden',
  },
  rost: { color: Elite.soft, fontSize: 11, marginTop: 1 },
  detail: { color: Elite.faint, fontSize: 11, marginTop: 1 },
  proj: { color: Elite.cream, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  trend: { fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  hexButton: { width: 28, height: 28 * HEX_RATIO, alignItems: 'center', justifyContent: 'center' },
  hexGlyph: { color: Elite.deep, fontSize: 17, fontWeight: '900', lineHeight: 20 },
  pressed: { opacity: 0.6 },
  addButtonSpace: { width: 28, height: 28 * HEX_RATIO },
  logoBadge: {
    position: 'absolute',
    right: -5,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Elite.deep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewTable: { paddingHorizontal: Spacing.md },
  viewCell: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  viewName: { color: Elite.cream, fontSize: 14, fontWeight: '600' },
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
