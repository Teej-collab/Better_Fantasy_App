import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Share, StyleSheet, View } from 'react-native';

import { ANTON, Elite, EliteCard, EliteLabel, Hex, initials } from '@/components/elite/Elite';
import { livesText, rulesLine, TeamLogo } from '@/components/survivor/SurvivorKit';
import { Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { queryClient } from '@/lib/queries';
import type { SurvivorFieldRow, SurvivorPickView } from '@/lib/survivorTypes';

// One survivor pool (2026-11-07): your entries, the Field (everyone's
// lives and picks — a pick for a game that hasn't started shows as a
// lock), how the pool picked each week, and the code to invite people.
export default function SurvivorPoolScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const poolId = Number(id);
  const q = useQuery({ queryKey: ['survivor-pool', poolId], queryFn: () => api.survivorPool(poolId), enabled: Number.isFinite(poolId) });
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);

  if (q.isPending) return <LoadingState />;
  if (!q.data) return <MessageState message="Couldn't load this pool." actionLabel="Try again" onAction={() => void q.refetch()} />;
  const pool = q.data;
  const field = pool.field;
  const shownWeeks = Array.from(new Set([...field.rows.flatMap((r) => r.picks.map((p) => p.week)), pool.week]))
    .filter((w) => w >= pool.start_week && w <= pool.week)
    .sort((a, b) => a - b)
    .slice(-4);
  const lastPopular = [...field.popularity].reverse().find((w) => w.week < pool.week) ?? field.popularity.at(-1) ?? null;

  const invite = (
        <EliteCard style={[styles.pad, styles.gap]}>
          <EliteLabel>INVITE</EliteLabel>
          <Text style={styles.muted}>{pool.league_id ? `Anyone in ${pool.league_name ?? 'the league'} can join from their Survivor page, or with this code.` : 'Anyone with this code can join.'}</Text>
          <View style={styles.codeRow}>
            <Text style={styles.code}>{pool.join_code}</Text>
            <Pressable
              onPress={() => void Share.share({ message: `Join my survivor pool "${pool.name}" on The Weekend with code ${pool.join_code}` })}
              style={styles.outline}
              accessibilityRole="button">
              <Text style={styles.outlineText}>Share</Text>
            </Pressable>
          </View>
        </EliteCard>
  );

  async function addEntry() {
    setAdding(true);
    try {
      const res = await api.joinSurvivorPool({ pool_id: poolId, ...(pool.league_id ? {} : { code: pool.join_code }) });
      haptics.success();
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['survivor-pool', poolId] }), queryClient.invalidateQueries({ queryKey: ['survivor-pools'] })]);
      router.push(`/survivor/pick/${res.entry_id}` as Href);
    } catch (e) {
      haptics.error();
      Alert.alert("Couldn't add an entry", e instanceof Error ? e.message : 'Try again.');
    } finally {
      setAdding(false);
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={Elite.green}
          onRefresh={async () => {
            setRefreshing(true);
            await q.refetch();
            setRefreshing(false);
          }}
        />
      }>
      <Stack.Screen options={{ title: pool.name }} />
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text style={styles.title} accessibilityRole="header">
            THE FIELD
          </Text>
          <Text style={styles.sub}>{pool.league_name ? `${pool.league_name} · ` : ''}{rulesLine(pool)}</Text>
        </View>
        <View style={styles.count}>
          <Text style={styles.countBig}>
            {field.alive}
            <Text style={styles.countOf}>/{field.rows.length}</Text>
          </Text>
          <Text style={styles.faint}>alive</Text>
        </View>
      </View>
      {pool.prize_note ? <Text style={styles.prize}>{pool.prize_note}</Text> : null}
      {field.rows.length <= 1 && invite}
      {field.winners.length > 0 && (
        <EliteCard tone="green" style={styles.pad}>
          <Text style={styles.winner}>{field.winners.length === 1 ? `${field.winners[0]} is the last one standing` : `${field.winners.join(' and ')} split it`}</Text>
        </EliteCard>
      )}

      {pool.mine.length > 0 && (
        <EliteCard style={[styles.pad, styles.gap]}>
          <EliteLabel>YOUR {pool.mine.length > 1 ? 'ENTRIES' : 'ENTRY'}</EliteLabel>
          {pool.mine.map((m) => (
            <View key={m.entry_id} style={styles.entryRow}>
              <Text style={[styles.entryName, styles.flex]}>
                {pool.mine.length > 1 ? `Entry ${m.entry_no} · ` : ''}
                {m.alive ? livesText(m.lives_left) : `Out in week ${m.eliminated_week}`}
              </Text>
              {m.alive && pool.week >= pool.start_week && (
                <Pressable onPress={() => router.push(`/survivor/pick/${m.entry_id}` as Href)} style={m.needs_pick ? styles.solid : styles.outline} accessibilityRole="button">
                  <Text style={m.needs_pick ? styles.solidText : styles.outlineText}>{m.needs_pick ? 'Make pick' : 'My pick'}</Text>
                </Pressable>
              )}
            </View>
          ))}
          {pool.can_add_entry && (
            <Pressable onPress={() => void addEntry()} disabled={adding} style={styles.addEntry} accessibilityRole="button">
              <Text style={styles.outlineText}>{adding ? 'Adding…' : `Add another entry (up to ${pool.max_entries})`}</Text>
            </Pressable>
          )}
        </EliteCard>
      )}

      {lastPopular && (
        <EliteCard style={[styles.pad, styles.gap]}>
          <EliteLabel>WEEK {lastPopular.week} PICKS</EliteLabel>
          {lastPopular.teams.slice(0, 5).map((t) => {
            const total = lastPopular.teams.reduce((n, x) => n + x.count, 0) || 1;
            const lost = t.result === 'loss' || (t.result === 'tie' && pool.tie_counts_as === 'loss');
            return (
              <View key={t.team} style={styles.popRow}>
                <TeamLogo team={t.team} size={22} />
                <Text style={styles.popTeam}>{t.team}</Text>
                <View style={styles.bar}>
                  <View style={[styles.barFill, { width: `${Math.round((t.count / total) * 100)}%`, backgroundColor: lost ? Elite.orange : Elite.green }]} />
                </View>
                <Text style={[styles.popResult, { color: t.result ? (lost ? Elite.orange : Elite.mint) : Elite.faint }]}>
                  {t.count} · {t.result ? (lost ? 'lost' : t.result === 'tie' ? 'tied' : 'won') : 'playing'}
                </Text>
              </View>
            );
          })}
        </EliteCard>
      )}
      {pool.week >= pool.start_week && (
        <Text style={styles.faint}>
          Week {pool.week} picks show as each game kicks off · {field.picked} of {field.alive} have picked
        </Text>
      )}

      <View style={styles.tableHead}>
        <Text style={[styles.faint, styles.flex]}>MANAGER</Text>
        {shownWeeks.map((w) => (
          <Text key={w} style={[styles.faint, styles.weekCol]}>
            W{w}
          </Text>
        ))}
      </View>
      {field.rows.map((r) => (
        <FieldRow key={r.entry_id} row={r} weeks={shownWeeks} lives={pool.lives} />
      ))}

      {field.rows.length > 1 && invite}
    </ScrollView>
  );
}

function FieldRow({ row, weeks, lives }: { row: SurvivorFieldRow; weeks: number[]; lives: number }) {
  const out = row.eliminated_week !== null;
  const color = out ? '#2a323d' : row.lives_left >= lives ? Elite.green : Elite.orange;
  return (
    <View style={[styles.fieldRow, row.mine && styles.fieldMine, out && styles.fieldOut]}>
      <Hex width={28} color={color} fill={color}>
        <Text style={styles.initials}>{initials(row.name)}</Text>
      </Hex>
      <View style={styles.flex}>
        <Text style={styles.fieldName} numberOfLines={1}>
          {row.mine ? `${row.name} (you)` : row.name}
        </Text>
        <Text style={[styles.fieldStatus, { color: out ? Elite.grey : row.lives_left >= lives ? Elite.mint : Elite.peach }]}>
          {out ? `Out in week ${row.eliminated_week}` : `Alive · ${livesText(row.lives_left)}`}
        </Text>
      </View>
      {weeks.map((w) => (
        <PickCell key={w} picks={row.picks.filter((p) => p.week === w)} />
      ))}
    </View>
  );
}

function PickCell({ picks }: { picks: SurvivorPickView[] }) {
  if (picks.length === 0) return <Text style={[styles.weekCol, styles.none]}>—</Text>;
  return (
    <View style={[styles.weekCol, styles.cellStack]}>
      {picks.map((p) =>
        p.hidden ? (
          <Text key={p.slot} style={styles.lock} accessibilityLabel="Picked, hidden until kickoff">
            ●
          </Text>
        ) : (
          <View key={p.slot} style={[styles.cell, (p.result === 'loss' || p.result === 'missed') && styles.cellLost]}>
            {p.team ? <TeamLogo team={p.team} size={20} /> : <Text style={styles.none}>✕</Text>}
          </View>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16 },
  screen: { flex: 1, backgroundColor: Elite.deep },
  content: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: 80 },
  head: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  flex: { flex: 1, minWidth: 0 },
  title: { fontFamily: ANTON, fontSize: 32, color: Elite.green, textShadowColor: 'rgba(57,255,20,0.45)', textShadowRadius: 14 },
  sub: { color: Elite.soft, fontSize: 12, lineHeight: 17 },
  count: { alignItems: 'flex-end' },
  countBig: { fontFamily: ANTON, fontSize: 30, color: Elite.cream },
  countOf: { fontSize: 18, color: Elite.faint },
  faint: { color: Elite.faint, fontSize: 11 },
  muted: { color: Elite.soft, fontSize: 12, lineHeight: 17 },
  prize: { color: Elite.peach, fontSize: 13, fontWeight: '600' },
  winner: { color: Elite.green, fontSize: 15, fontWeight: '800' },
  gap: { gap: 10 },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  entryName: { color: Elite.cream, fontSize: 14, fontWeight: '700' },
  solid: { minHeight: 36, paddingHorizontal: 16, borderRadius: 18, backgroundColor: Elite.green, justifyContent: 'center' },
  solidText: { color: Elite.deep, fontSize: 13, fontWeight: '800' },
  outline: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: Elite.green, justifyContent: 'center' },
  outlineText: { color: Elite.green, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  addEntry: { minHeight: 40, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(57,255,20,0.4)', justifyContent: 'center' },
  popRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  popTeam: { width: 38, color: Elite.cream, fontSize: 12, fontWeight: '700' },
  bar: { flex: 1, height: 8, borderRadius: 4, backgroundColor: '#222a35', overflow: 'hidden' },
  barFill: { height: '100%' },
  popResult: { width: 74, textAlign: 'right', fontSize: 11 },
  tableHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, marginTop: 4 },
  weekCol: { width: 36, textAlign: 'center' },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: 10, backgroundColor: Elite.cell, borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)' },
  fieldMine: { backgroundColor: 'rgba(57,255,20,0.08)', borderColor: 'rgba(57,255,20,0.35)' },
  fieldOut: { opacity: 0.55, backgroundColor: 'transparent' },
  initials: { fontFamily: ANTON, fontSize: 11, color: Elite.deep },
  fieldName: { color: Elite.cream, fontSize: 13, fontWeight: '700' },
  fieldStatus: { fontSize: 10, marginTop: 2 },
  cellStack: { alignItems: 'center', gap: 2 },
  cell: { width: 30, height: 26, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  cellLost: { backgroundColor: 'rgba(255,122,26,0.2)' },
  lock: { color: Elite.mint, fontSize: 12 },
  none: { color: Elite.grey, fontSize: 12, textAlign: 'center' },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  code: { fontFamily: ANTON, fontSize: 28, letterSpacing: 4, color: Elite.cream },
});
