import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Display, Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { PosTag, posLabel } from '@/components/warroom/parts';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { positionColor } from '@/lib/positionColors';
import type { MockBoard, MockPlayer } from '@/lib/types';

// Mock drafts (2026-10-28): practice a whole draft on your phone against
// bots, from your league's size, rounds and slot, with the real ADP
// board (GET /war-room/mock). Bots take the best player by ADP with a
// little randomness and don't double up on a QB, TE, kicker or D/ST
// early. Nothing is saved; the end shows your roster and a grade.

type Pick = { number: number; round: number; inRound: number; slot: number; player: MockPlayer };
type Phase = 'setup' | 'drafting' | 'done';

const FILTERS = ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

function slotFor(pickIndex: number, teams: number): { round: number; inRound: number; slot: number } {
  const round = Math.floor(pickIndex / teams) + 1;
  const inRound = (pickIndex % teams) + 1;
  return { round, inRound, slot: round % 2 === 1 ? inRound : teams - inRound + 1 };
}

// How many a team wants at a position before it's a waste: its starting
// spots, plus one backup at QB and TE. Kickers and D/ST wait for the
// last two rounds.
function wants(position: string, slots: Record<string, number>): number {
  const label = position === 'DEF' ? 'D/ST' : position;
  const start = slots[label] ?? 0;
  if (position === 'QB') return start + 1 + (slots['QB/RB/WR/TE'] ?? 0);
  if (position === 'TE') return start + 1;
  if (position === 'K' || position === 'DEF') return Math.max(1, start);
  return 99;
}

function botPick(available: MockPlayer[], roster: MockPlayer[], slots: Record<string, number>, round: number, rounds: number): MockPlayer {
  const counts: Record<string, number> = {};
  for (const p of roster) counts[p.position] = (counts[p.position] ?? 0) + 1;
  const late = round >= rounds - 1;
  let best: MockPlayer = available[0];
  let bestScore = Infinity;
  for (const p of available.slice(0, 14)) {
    let score = p.adp + (Math.random() - 0.5) * Math.max(4, p.adp * 0.25);
    if ((counts[p.position] ?? 0) >= wants(p.position, slots)) score += 60;
    if ((p.position === 'K' || p.position === 'DEF') && !late) score += 120;
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }
  // A team that still needs a kicker or D/ST in the last two rounds takes one.
  if (late) {
    for (const need of ['DEF', 'K']) {
      if ((slots[need === 'DEF' ? 'D/ST' : need] ?? 0) > 0 && !counts[need]) {
        const p = available.find((x) => x.position === need);
        if (p && round === rounds - (need === 'DEF' ? 1 : 0)) return p;
      }
    }
  }
  return best;
}

function grade(picks: Pick[]): { letter: string; value: number } {
  if (picks.length === 0) return { letter: '—', value: 0 };
  // Each pick's value: how many spots after his ADP you got him, scaled
  // so a late-round reach doesn't swamp an early steal.
  const value = picks.reduce((sum, p) => sum + (p.number - p.player.adp) / Math.max(3, p.player.adp * 0.15), 0) / picks.length;
  const letter = value >= 1.2 ? 'A+' : value >= 0.7 ? 'A' : value >= 0.3 ? 'B+' : value >= 0 ? 'B' : value >= -0.4 ? 'C+' : value >= -0.8 ? 'C' : 'D';
  return { letter, value };
}

export default function MockDraftScreen() {
  const board = useQuery({ queryKey: ['mock-board'], queryFn: api.mockBoard, staleTime: 5 * 60_000 });
  if (board.isPending) return <LoadingState />;
  if (!board.data || board.data.players.length === 0) {
    return <MessageState message="Couldn't load the player board for a mock draft." actionLabel="Try again" onAction={() => void board.refetch()} />;
  }
  return <Mock board={board.data} />;
}

function Mock({ board }: { board: MockBoard }) {
  const { teams, rounds } = board;
  const total = teams * rounds;
  const [phase, setPhase] = useState<Phase>('setup');
  const [mySlot, setMySlot] = useState(board.my_slot ?? 1);
  const [fast, setFast] = useState(true);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [filter, setFilter] = useState('All');
  const [view, setView] = useState<'players' | 'mine' | 'board'>('players');

  const taken = useMemo(() => new Set(picks.map((p) => p.player.id)), [picks]);
  const available = useMemo(() => board.players.filter((p) => !taken.has(p.id)), [board.players, taken]);
  const current = picks.length < total ? slotFor(picks.length, teams) : null;
  const myTurn = phase === 'drafting' && current?.slot === mySlot;
  const mine = picks.filter((p) => p.slot === mySlot);
  const queued = new Set(board.queue);
  const myNext = useMemo(() => {
    for (let i = picks.length; i < total; i++) if (slotFor(i, teams).slot === mySlot) return i - picks.length;
    return null;
  }, [picks.length, total, teams, mySlot]);

  function add(player: MockPlayer) {
    setPicks((prev) => {
      if (prev.length >= total || prev.some((p) => p.player.id === player.id)) return prev;
      const s = slotFor(prev.length, teams);
      const next = [...prev, { number: prev.length + 1, ...s, player }];
      if (next.length >= total) setPhase('done');
      return next;
    });
  }

  // Bots pick on a short timer; the clock stops on your pick.
  useEffect(() => {
    if (phase !== 'drafting' || !current || current.slot === mySlot) return;
    const roster = picks.filter((p) => p.slot === current.slot).map((p) => p.player);
    const id = setTimeout(() => add(botPick(available, roster, board.roster_slots, current.round, rounds)), fast ? 250 : 900);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, picks.length, mySlot, fast]);

  useEffect(() => {
    if (myTurn) haptics.warning();
  }, [myTurn]);

  function start() {
    haptics.tap();
    setPicks([]);
    setView('players');
    setPhase('drafting');
  }

  function draft(player: MockPlayer) {
    if (!myTurn) return;
    haptics.success();
    add(player);
  }

  function autopick() {
    if (!myTurn || !current) return;
    const top = available.find((p) => queued.has(p.id)) ?? botPick(available, mine.map((p) => p.player), board.roster_slots, current.round, rounds);
    draft(top);
  }

  if (phase === 'setup') {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: 'Mock Draft' }} />
        <FlatList
          data={[]}
          renderItem={null}
          contentContainerStyle={styles.content}
          ListHeaderComponent={
            <View style={styles.gap}>
              <Display style={styles.title}>Mock Draft</Display>
              <Text style={styles.soft}>
                A practice run of your league&apos;s draft: {teams} teams, {rounds} rounds, snake order. The other {teams - 1} teams are bots
                drafting by {board.uses_adp ? 'ADP' : "this season's player rankings"}. Nothing here counts.
              </Text>
              <Text style={styles.eyebrow}>YOUR DRAFT SLOT</Text>
              <View style={styles.chips}>
                {Array.from({ length: teams }, (_, i) => i + 1).map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => setMySlot(n)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: mySlot === n }}
                    style={[styles.slotChip, mySlot === n && styles.chipOn]}>
                    <Text style={[styles.chipText, mySlot === n && styles.chipTextOn]}>{n}</Text>
                  </Pressable>
                ))}
              </View>
              {board.my_slot ? <Text style={styles.small}>Your real slot is {board.my_slot}.</Text> : null}
              <Text style={styles.eyebrow}>BOT SPEED</Text>
              <View style={styles.chips}>
                {[
                  { label: 'Fast', on: fast },
                  { label: 'Draft-night pace', on: !fast },
                ].map((o) => (
                  <Pressable key={o.label} onPress={() => setFast(o.label === 'Fast')} accessibilityRole="radio" accessibilityState={{ checked: o.on }} style={[styles.chip, o.on && styles.chipOn]}>
                    <Text style={[styles.chipText, o.on && styles.chipTextOn]}>{o.label}</Text>
                  </Pressable>
                ))}
              </View>
              {board.queue.length > 0 && <Text style={styles.small}>Your queue is starred, and Auto takes from it first.</Text>}
              <Pressable onPress={start} accessibilityRole="button" style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
                <Text style={styles.primaryText}>Start the mock</Text>
              </Pressable>
            </View>
          }
        />
      </View>
    );
  }

  if (phase === 'done') {
    const g = grade(mine);
    const scored = mine.map((p) => ({ ...p, value: p.number - p.player.adp }));
    const steal = [...scored].sort((a, b) => b.value - a.value)[0];
    const reach = [...scored].sort((a, b) => a.value - b.value)[0];
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: 'Mock Draft' }} />
        <FlatList
          data={scored}
          keyExtractor={(p) => String(p.number)}
          contentContainerStyle={styles.content}
          ListHeaderComponent={
            <View style={styles.gap}>
              <Display style={styles.title}>Your mock</Display>
              <View style={styles.gradeCard}>
                <Text style={styles.gradeLetter}>{g.letter}</Text>
                <View style={styles.flex}>
                  <Text style={styles.strong}>Draft grade, by value against ADP</Text>
                  {steal && steal.value > 0 && <Text style={styles.small}>Best value: {steal.player.name}, {Math.round(steal.value)} spots after his ADP</Text>}
                  {reach && reach.value < 0 && <Text style={styles.small}>Biggest reach: {reach.player.name}, {Math.round(-reach.value)} spots early</Text>}
                </View>
              </View>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={styles.pickNum}>
                {item.round}.{String(item.inRound).padStart(2, '0')}
              </Text>
              <PosTag position={item.player.position} />
              <Text style={[styles.name, styles.flex]} numberOfLines={1}>
                {item.player.name}
              </Text>
              <Text style={[styles.small, { color: item.value >= 0 ? Colors.accent : Colors.loss }]}>
                {item.value >= 0 ? '+' : ''}
                {Math.round(item.value)}
              </Text>
            </View>
          )}
          ListFooterComponent={
            <View style={styles.gap}>
              <Text style={styles.small}>+ means you got him later than his ADP (value); − means you reached.</Text>
              <Pressable onPress={start} accessibilityRole="button" style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
                <Text style={styles.primaryText}>Mock again</Text>
              </Pressable>
              <Pressable onPress={() => setPhase('setup')} accessibilityRole="button" style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}>
                <Text style={styles.ghostText}>Change slot or speed</Text>
              </Pressable>
              <Pressable onPress={() => router.back()} accessibilityRole="button" style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}>
                <Text style={styles.ghostText}>Back to the War Room</Text>
              </Pressable>
            </View>
          }
        />
      </View>
    );
  }

  const shown = available.filter((p) => filter === 'All' || p.position === filter);
  const last = picks[picks.length - 1];

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: `Mock · Round ${current?.round ?? rounds}` }} />
      <View style={[styles.clock, myTurn && styles.clockMine]} accessibilityLiveRegion="polite">
        <Text style={[styles.eyebrow, myTurn && { color: '#0d1016' }]}>
          {current ? `PICK ${current.round}.${String(current.inRound).padStart(2, '0')}` : ''}
        </Text>
        <Text style={[styles.clockText, myTurn && { color: '#0d1016' }]}>
          {myTurn ? "You're on the clock" : myNext !== null ? `Bot ${current?.slot} picking · you're up in ${myNext}` : 'Finishing up'}
        </Text>
        {last && !myTurn && (
          <Text style={styles.small} numberOfLines={1}>
            {last.round}.{String(last.inRound).padStart(2, '0')}: {last.slot === mySlot ? 'You' : `Bot ${last.slot}`} took {last.player.name}
          </Text>
        )}
        {myTurn && (
          <Pressable onPress={autopick} accessibilityRole="button" style={styles.autoBtn}>
            <Text style={styles.autoText}>Auto</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.tabs}>
        {(
          [
            ['players', 'Players'],
            ['mine', `My team · ${mine.length}`],
            ['board', 'Board'],
          ] as const
        ).map(([key, label]) => (
          <Pressable key={key} onPress={() => setView(key)} accessibilityRole="tab" accessibilityState={{ selected: view === key }} style={[styles.tab, view === key && styles.chipOn]}>
            <Text style={[styles.chipText, view === key && styles.chipTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {view === 'players' && (
        <FlatList
          data={shown.slice(0, 120)}
          keyExtractor={(p) => p.id}
          initialNumToRender={20}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.chips}>
              {FILTERS.map((f) => (
                <Pressable key={f} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipOn]}>
                  <Text style={[styles.chipText, filter === f && styles.chipTextOn]}>{f === 'DEF' ? 'D/ST' : f}</Text>
                </Pressable>
              ))}
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.playerRow}>
              <Text style={styles.adp}>{Math.round(item.adp)}</Text>
              <View style={[styles.stripe, { backgroundColor: positionColor(item.position) }]} />
              <View style={styles.flex}>
                <Text style={styles.name} numberOfLines={1}>
                  {queued.has(item.id) ? '★ ' : ''}
                  {item.name}
                </Text>
                <Text style={styles.small}>
                  {posLabel(item.position)}
                  {item.team ? ` · ${item.team}` : ''}
                </Text>
              </View>
              {myTurn && (
                <Pressable onPress={() => draft(item)} accessibilityRole="button" accessibilityLabel={`Draft ${item.name}`} style={({ pressed }) => [styles.draftBtn, pressed && styles.pressed]}>
                  <Text style={styles.draftText}>Draft</Text>
                </Pressable>
              )}
            </View>
          )}
        />
      )}
      {view === 'mine' && (
        <FlatList
          data={mine}
          keyExtractor={(p) => String(p.number)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.soft}>Your picks show up here.</Text>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={styles.pickNum}>
                {item.round}.{String(item.inRound).padStart(2, '0')}
              </Text>
              <PosTag position={item.player.position} />
              <Text style={[styles.name, styles.flex]} numberOfLines={1}>
                {item.player.name}
              </Text>
            </View>
          )}
        />
      )}
      {view === 'board' && (
        <FlatList
          data={[...picks].reverse()}
          keyExtractor={(p) => String(p.number)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={[styles.row, item.slot === mySlot && styles.mineRow]}>
              <Text style={styles.pickNum}>
                {item.round}.{String(item.inRound).padStart(2, '0')}
              </Text>
              <PosTag position={item.player.position} />
              <Text style={[styles.name, styles.flex]} numberOfLines={1}>
                {item.player.name}
              </Text>
              <Text style={styles.small}>{item.slot === mySlot ? 'You' : `Bot ${item.slot}`}</Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.sm },
  list: { padding: Spacing.md, paddingBottom: Spacing.xl * 2, gap: Spacing.sm },
  gap: { gap: Spacing.md },
  flex: { flex: 1, minWidth: 0 },
  title: { color: Colors.text, fontSize: 30 },
  soft: { color: '#aeb5c1', fontSize: 14, lineHeight: 20 },
  small: { color: Colors.textSecondary, fontSize: 12 },
  strong: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  eyebrow: { color: Colors.accent, fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minHeight: 36, borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, justifyContent: 'center' },
  slotChip: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  chipText: { color: '#aeb5c1', fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: '#0d1016', fontWeight: '800' },
  primary: { minHeight: 52, borderRadius: Radius.pill, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#0d1016', fontSize: 16, fontWeight: '800' },
  ghost: { minHeight: 48, borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  ghostText: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  clock: { margin: Spacing.md, marginBottom: 0, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, padding: 12, gap: 2 },
  clockMine: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  clockText: { color: Colors.text, fontSize: 18, fontWeight: '800' },
  autoBtn: { position: 'absolute', right: 12, top: 12, minHeight: 36, borderRadius: Radius.pill, backgroundColor: '#0d1016', paddingHorizontal: 14, justifyContent: 'center' },
  autoText: { color: Colors.accent, fontSize: 13, fontWeight: '800' },
  tabs: { flexDirection: 'row', gap: 6, paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
  tab: { flex: 1, minHeight: 40, borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: Radius.md, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, padding: 10 },
  adp: { width: 30, color: Colors.textSecondary, fontSize: 14, fontWeight: '700', textAlign: 'right', fontVariant: ['tabular-nums'] },
  stripe: { width: 4, height: 32, borderRadius: 2 },
  name: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  draftBtn: { minHeight: 36, borderRadius: Radius.pill, backgroundColor: Colors.accent, paddingHorizontal: 14, justifyContent: 'center' },
  draftText: { color: '#0d1016', fontSize: 13, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 4 },
  mineRow: { backgroundColor: 'rgba(76,195,255,0.08)', borderRadius: Radius.md },
  pickNum: { width: 40, color: Colors.textSecondary, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  gradeCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.accent, backgroundColor: Colors.surface, padding: Spacing.md },
  gradeLetter: { color: Colors.accent, fontSize: 52, fontWeight: '900' },
});
