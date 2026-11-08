import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ANTON, Elite, EliteSegmented, HexPortrait } from '@/components/elite/Elite';
import { Text } from '@/components/Text';
import { teamLogoUrl } from '@/lib/nflTeams';
import { openPlayer, useTrendingPlayers } from '@/lib/queries';
import type { TrendingKind, TrendingPlayer } from '@/lib/types';

// The Free Agents page's trending strip (elite App A "Hot Wire",
// 2026-11-05): the four most added (or dropped) players across this
// app's leagues — the last day, or the last week when the day is too
// quiet to rank — and all of Sleeper (labeled as such) only when even the
// week is quiet. Each is a hex portrait over his team's logo, the hottest
// lit orange. "See all" opens the full Trending page.
export function OnTheWire() {
  const [kind, setKind] = useState<TrendingKind>('add');
  const trending = useTrendingPlayers(kind, '24h', 'auto');
  const data = trending.data;
  const players = (data?.players ?? []).slice(0, 4);
  if (!trending.isPending && players.length === 0) return null;
  const accent = kind === 'add' ? Elite.green : Elite.orange;
  const span = data?.window === '7d' ? 'Last 7 days' : 'Last 24 hrs';
  const fromSleeper = data !== undefined && data.source !== 'app';
  const where = fromSleeper
    ? 'Trending across Sleeper'
    : `${data?.leagues_tracked ?? 0} ${data?.leagues_tracked === 1 ? 'league' : 'leagues'} on The Weekend`;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>ON THE WIRE</Text>
        <View style={styles.toggle}>
          <EliteSegmented
            options={[
              { key: 'add', label: 'Adds' },
              { key: 'drop', label: 'Drops' },
            ]}
            value={kind}
            onChange={setKind}
          />
        </View>
      </View>
      <View style={styles.subRow}>
        <Text style={styles.sub}>
          {span} · {where}
        </Text>
        <Pressable onPress={() => router.push('/trending')} hitSlop={10}>
          <Text style={styles.seeAll}>See all</Text>
        </Pressable>
      </View>
      {fromSleeper && <Text style={styles.sub}>Switches to our leagues once they&apos;re busy enough to rank.</Text>}
      <View style={styles.cells}>
        {players.map((p, i) => (
          <WireCell key={p.sleeper_player_id} player={p} hottest={i === 0} accent={accent} kind={kind} source={data?.source} />
        ))}
      </View>
    </View>
  );
}

function shortName(p: TrendingPlayer): string {
  if (p.position === 'DEF') return `${p.pro_team ?? ''} D/ST`;
  const parts = p.full_name.split(' ');
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : p.full_name;
}

function WireCell({
  player,
  hottest,
  accent,
  kind,
  source,
}: {
  player: TrendingPlayer;
  hottest: boolean;
  accent: string;
  kind: TrendingKind;
  source?: string;
}) {
  const isDef = player.position === 'DEF';
  const count = `${kind === 'add' ? '+' : '−'}${player.count.toLocaleString()}`;
  return (
    <Pressable
      onPress={() => openPlayer(player.sleeper_player_id)}
      style={({ pressed }) => [styles.cell, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${player.full_name}, ${count} ${kind === 'add' ? 'adds' : 'drops'}`}>
      <HexPortrait
        width={70}
        color={hottest ? Elite.orange : accent}
        glow
        headshot={isDef ? null : player.headshot_url}
        logo={teamLogoUrl(player.pro_team)}
      />
      <Text style={styles.name} numberOfLines={1}>
        {shortName(player)}
      </Text>
      <Text style={styles.pos}>
        {isDef ? 'D/ST' : player.position} · {player.pro_team ?? 'FA'}
      </Text>
      <Text style={[styles.count, { color: accent, textShadowColor: accent }]}>{count}</Text>
      <Text style={[styles.pos, player.available && styles.available]}>
        {player.available ? 'Available' : source === 'app' && player.leagues ? `${player.leagues} lgs` : 'Rostered'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(57,255,20,0.28)',
    backgroundColor: Elite.card,
    padding: 12,
    gap: 4,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontFamily: ANTON, fontSize: 18, letterSpacing: 1.5, color: Elite.cream },
  toggle: { width: 150 },
  subRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sub: { color: Elite.faint, fontSize: 11 },
  seeAll: { color: Elite.green, fontSize: 12, fontWeight: '700' },
  cells: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  cell: { flex: 1, alignItems: 'center', gap: 3 },
  pressed: { opacity: 0.6 },
  name: { color: Elite.cream, fontSize: 12, fontWeight: '700', marginTop: 4, maxWidth: 84 },
  pos: { color: Elite.faint, fontSize: 10 },
  available: { color: Elite.green, fontWeight: '700' },
  count: { fontFamily: ANTON, fontSize: 20, lineHeight: 24, textShadowRadius: 8, textShadowOffset: { width: 0, height: 0 } },
});
