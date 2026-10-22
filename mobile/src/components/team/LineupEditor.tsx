import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { PlayerHeadshot } from '@/components/PlayerHeadshot';
import { PositionStripe } from '@/components/PositionStripe';
import { PreviewLink } from '@/components/PreviewLink';
import { Text } from '@/components/Text';
import { Colors, Radius, Spacing, withAlpha } from '@/constants/theme';
import { formatGameTime, formatPoints } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { lineupAdvice, moveTargets, openStarterSlots, type Advice, type MoveTarget } from '@/lib/lineupMoves';
import { confirmDropPlayer } from '@/lib/queries';
import { BENCH_SLOT_LABEL, IR_SLOT_LABEL, slotDisplayLabel, STARTER_SLOT_ORDER, starterSortIndex, TAXI_SLOT_LABEL } from '@/lib/rosterSlots';
import type { MyTeam, RosterEntry } from '@/lib/types';

// My Team's lineup (2026-10-22, lineup-move mockups A + E with B's drag):
// one list where every player is placed by position, so a move slides
// each player into his new spot. Tap a slot pill to pick a player up:
// everywhere he can go glows with what it does to your projection, and
// a starter also lights up every bench player who can take his spot.
// Hold the pill and drag to do the same by hand.

const ROW = 64;
const GAP = 6;
const HEAD = 34;
const SPRING = { damping: 24, stiffness: 240 };
const UP = '#4ade80';
const DOWN = '#f87171';

type Item =
  | { kind: 'head'; key: string; title: string; target: string | null }
  | { kind: 'player'; key: string; entry: RosterEntry }
  | { kind: 'empty'; key: string; slot: string; target: string };

type Placed = Item & { top: number; height: number };

function layout(team: MyTeam, moving: RosterEntry | null): { items: Placed[]; height: number } {
  const roster = team.roster;
  const items: Item[] = [{ kind: 'head', key: 'head:starters', title: 'Starters', target: null }];
  // Starters in lineup order, each slot's open spots right after its players.
  const open = openStarterSlots(roster, team.roster_slots ?? {});
  const slots = [...new Set([...roster.map((r) => r.lineup_slot), ...open])]
    .filter((s) => s !== BENCH_SLOT_LABEL && s !== IR_SLOT_LABEL && s !== TAXI_SLOT_LABEL)
    .sort((a, b) => starterSortIndex(a) - starterSortIndex(b) || STARTER_SLOT_ORDER.indexOf(a) - STARTER_SLOT_ORDER.indexOf(b));
  for (const slot of slots) {
    for (const e of roster.filter((r) => r.lineup_slot === slot)) items.push({ kind: 'player', key: e.player_id, entry: e });
    open.filter((s) => s === slot).forEach((s, i) => items.push({ kind: 'empty', key: `empty:${s}:${i}`, slot: s, target: `empty:${s}` }));
  }
  const groups: [string, string][] = [[BENCH_SLOT_LABEL, 'Bench'], [IR_SLOT_LABEL, 'Injured reserve'], [TAXI_SLOT_LABEL, 'Taxi squad']];
  for (const [slot, title] of groups) {
    const players = roster.filter((r) => r.lineup_slot === slot);
    const benchTarget = slot === BENCH_SLOT_LABEL && moving !== null && moving.lineup_slot !== BENCH_SLOT_LABEL;
    if (players.length === 0 && !benchTarget) continue;
    items.push({ kind: 'head', key: `head:${slot}`, title, target: benchTarget ? 'bench' : null });
    for (const e of players) items.push({ kind: 'player', key: e.player_id, entry: e });
  }
  let top = 0;
  const placed = items.map((item) => {
    const height = item.kind === 'head' ? HEAD : ROW;
    const p = { ...item, top, height } as Placed;
    top += height + (item.kind === 'head' ? 0 : GAP);
    return p;
  });
  return { items: placed, height: top };
}

const targetKeyOf = (item: Placed): string | null =>
  item.kind === 'player' ? item.key : item.kind === 'empty' ? item.target : item.target;

export function LineupEditor({
  team,
  editable,
  moving,
  onMove,
  onApply,
  onDragChange,
}: {
  team: MyTeam;
  editable: boolean;
  moving: RosterEntry | null;
  onMove: (entry: RosterEntry | null) => void;
  onApply: (target: MoveTarget) => void;
  onDragChange: (dragging: boolean) => void;
}) {
  const { items, height } = useMemo(() => layout(team, moving), [team, moving]);
  const targets = useMemo(
    () => (moving ? new Map(moveTargets(moving, team.roster, team.roster_slots ?? {}).map((t) => [t.key, t])) : null),
    [moving, team],
  );
  const [hover, setHover] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Where each target sits, for the drag to hit-test without leaving the UI thread.
  const hits = useSharedValue<{ key: string; top: number; height: number }[]>([]);
  useEffect(() => {
    hits.set(
      targets
        ? items.filter((i) => targets.has(targetKeyOf(i) ?? '')).map((i) => ({ key: targetKeyOf(i) as string, top: i.top, height: i.height }))
        : [],
    );
  }, [items, targets, hits]);

  function press(entry: RosterEntry) {
    if (!moving) {
      if (!editable || entry.is_locked) return;
      haptics.select();
      onMove(entry);
      return;
    }
    if (moving.player_id === entry.player_id) return onMove(null);
    const target = targets?.get(entry.player_id);
    if (target) return onApply(target);
    if (editable && !entry.is_locked) {
      haptics.select();
      onMove(entry);
    }
  }

  function pressTarget(key: string) {
    const target = targets?.get(key);
    if (target) onApply(target);
  }

  function beginDrag(entry: RosterEntry) {
    setDraggingId(entry.player_id);
    onMove(entry);
    onDragChange(true);
    haptics.tap();
  }

  function endDrag(key: string | null) {
    setDraggingId(null);
    setHover(null);
    onDragChange(false);
    const target = key ? targets?.get(key) : undefined;
    if (target) onApply(target);
    else onMove(null);
  }

  function hovered(key: string | null) {
    setHover(key);
    if (key) haptics.select();
  }

  return (
    <View style={[styles.list, { height }]}>
      {items.map((item) => {
        if (item.kind === 'head') {
          const isTarget = item.target !== null && targets?.has(item.target);
          return (
            <Slide key={item.key} top={item.top} height={item.height} style={styles.head}>
              <Text style={styles.headTitle}>{item.title}</Text>
              {isTarget && (
                <Pressable onPress={() => pressTarget('bench')} style={[styles.benchDrop, hover === 'bench' && styles.hovered]}>
                  <Text style={styles.benchDropText}>
                    Move to bench <Delta value={targets!.get('bench')!.delta} />
                  </Text>
                </Pressable>
              )}
            </Slide>
          );
        }
        if (item.kind === 'empty') {
          const target = targets?.get(item.target);
          return (
            <Slide key={item.key} top={item.top} height={item.height}>
              <Pressable
                disabled={!target}
                onPress={() => pressTarget(item.target)}
                style={[styles.row, styles.emptyRow, target && styles.targetRow, hover === item.target && styles.hovered, moving && !target && styles.dim]}>
                <View style={[styles.pill, target && styles.pillTarget]}>
                  <Text style={[styles.pillText, target && styles.pillTextTarget]}>{slotDisplayLabel(item.slot)}</Text>
                </View>
                <Text style={styles.emptyText}>Open spot</Text>
                {target && <Delta value={target.delta} big />}
              </Pressable>
            </Slide>
          );
        }
        const e = item.entry;
        const target = targets?.get(e.player_id) ?? null;
        const isMoving = moving?.player_id === e.player_id;
        return (
          <PlayerRow
            key={item.key}
            entry={e}
            top={item.top}
            editable={editable}
            state={isMoving ? 'lifted' : target ? 'target' : moving ? 'dim' : 'normal'}
            hovered={hover !== null && hover === e.player_id}
            delta={target?.delta ?? null}
            dragging={draggingId === e.player_id}
            hits={hits}
            onPress={() => press(e)}
            onBeginDrag={() => beginDrag(e)}
            onHover={hovered}
            onEndDrag={endDrag}
          />
        );
      })}
    </View>
  );
}

// A list item that springs to its new place whenever the lineup changes.
function Slide({ top, height, style, children }: { top: number; height: number; style?: object; children: React.ReactNode }) {
  const y = useSharedValue(top);
  useEffect(() => {
    y.set(withSpring(top, SPRING));
  }, [top, y]);
  const animated = useAnimatedStyle(() => ({ top: y.get() }));
  return <Animated.View style={[styles.item, { height }, style, animated]}>{children}</Animated.View>;
}

function Delta({ value, big }: { value: number; big?: boolean }) {
  if (Math.abs(value) < 0.05) return <Text style={[styles.delta, big && styles.deltaBig, { color: Colors.textSecondary }]}>Same</Text>;
  return (
    <Text style={[styles.delta, big && styles.deltaBig, { color: value > 0 ? UP : DOWN }]}>
      {value > 0 ? '+' : '−'}
      {Math.abs(value).toFixed(1)}
    </Text>
  );
}

function PlayerRow({
  entry,
  top,
  editable,
  state,
  hovered,
  delta,
  dragging,
  hits,
  onPress,
  onBeginDrag,
  onHover,
  onEndDrag,
}: {
  entry: RosterEntry;
  top: number;
  editable: boolean;
  state: 'normal' | 'lifted' | 'target' | 'dim';
  hovered: boolean;
  delta: number | null;
  dragging: boolean;
  hits: ReturnType<typeof useSharedValue<{ key: string; top: number; height: number }[]>>;
  onPress: () => void;
  onBeginDrag: () => void;
  onHover: (key: string | null) => void;
  onEndDrag: (key: string | null) => void;
}) {
  const canEdit = editable && !entry.is_locked;
  const y = useSharedValue(top);
  const drag = useSharedValue(0);
  const lifted = useSharedValue(false);
  const over = useSharedValue<string | null>(null);

  useEffect(() => {
    if (!dragging) y.set(withSpring(top, SPRING));
  }, [top, dragging, y]);

  // Hold the slot pill, then drag: the row follows your finger and the
  // spot under it lights up; let go on a glowing spot to make the move.
  const gesture = Gesture.Pan()
    .enabled(canEdit)
    .activateAfterLongPress(220)
    .onStart(() => {
      lifted.set(true);
      over.set(null);
      runOnJS(onBeginDrag)();
    })
    .onUpdate((e) => {
      drag.set(e.translationY);
      const center = y.get() + e.translationY + ROW / 2;
      const hit = hits.get().find((h) => center >= h.top && center <= h.top + h.height);
      const key = hit ? hit.key : null;
      if (key !== over.get()) {
        over.set(key);
        runOnJS(onHover)(key);
      }
    })
    .onFinalize(() => {
      if (!lifted.get()) return;
      lifted.set(false);
      drag.set(withSpring(0, SPRING));
      runOnJS(onEndDrag)(over.get());
    });

  const animated = useAnimatedStyle(() => {
    const up = lifted.get();
    return {
      top: y.get(),
      zIndex: up ? 30 : state === 'lifted' ? 20 : 0,
      transform: [{ translateY: drag.get() }, { scale: withSpring(up || state === 'lifted' ? 1.03 : 1, SPRING) }],
      shadowOpacity: withTiming(up || state === 'lifted' ? 0.55 : 0),
      opacity: withTiming(state === 'dim' ? 0.35 : 1, { duration: 180 }),
    };
  });

  const detail = [
    `${entry.position === 'DEF' ? 'D/ST' : entry.position}${entry.pro_team ? ` · ${entry.pro_team}` : ''}`,
    entry.on_bye ? 'Bye' : entry.next_opponent && (entry.game_time ? `${entry.next_opponent} ${formatGameTime(entry.game_time)}` : entry.next_opponent),
  ]
    .filter(Boolean)
    .join('  ·  ');

  const body = (
    <>
      <View style={styles.player}>
        <View style={styles.nameLine}>
          <Text style={styles.name} numberOfLines={1}>
            {entry.player_name}
          </Text>
          {entry.injury_status && <Text style={styles.injury}>{entry.injury_status}</Text>}
          {entry.is_locked && <Text style={styles.locked}>Locked</Text>}
        </View>
        <Text style={styles.detail} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      {delta !== null ? (
        <View style={styles.right}>
          <Delta value={delta} big />
          <Text style={styles.small}>{state === 'target' ? 'if swapped' : ''}</Text>
        </View>
      ) : (
        <View style={styles.right}>
          <Text style={styles.points}>{formatPoints(entry.points)}</Text>
          <Text style={styles.small}>{entry.on_bye ? 'Bye week' : formatPoints(entry.live_projected ?? entry.points_projected)}</Text>
        </View>
      )}
    </>
  );

  return (
    <Animated.View style={[styles.item, { height: ROW }, styles.shadow, animated]}>
      <View
        style={[
          styles.row,
          state === 'lifted' && styles.liftedRow,
          state === 'target' && styles.targetRow,
          hovered && styles.hovered,
        ]}>
        <PositionStripe position={entry.position} />
        <GestureDetector gesture={gesture}>
          <Pressable
            disabled={!canEdit && state !== 'target'}
            onPress={onPress}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={state === 'target' ? `Swap with ${entry.player_name}` : `Move ${entry.player_name}`}
            accessibilityHint={canEdit ? 'Hold and drag to move' : undefined}
            style={[styles.pill, canEdit && styles.pillEditable, (state === 'target' || state === 'lifted') && styles.pillTarget]}>
            <Text style={[styles.pillText, canEdit && styles.pillTextEditable, (state === 'target' || state === 'lifted') && styles.pillTextTarget]}>
              {slotDisplayLabel(entry.lineup_slot)}
            </Text>
          </Pressable>
        </GestureDetector>
        <PlayerHeadshot url={entry.headshot_url} position={entry.position} />
        {state === 'normal' ? (
          <PreviewLink
            href={{ pathname: '/player/[id]', params: { id: entry.player_id } }}
            menu={
              editable
                ? [
                    ...(canEdit ? [{ title: 'Move', icon: 'arrow.up.arrow.down' as const, onPress }] : []),
                    {
                      title: 'Drop Player',
                      icon: 'minus.circle' as const,
                      destructive: true,
                      onPress: () => confirmDropPlayer({ id: entry.player_id, name: entry.player_name }),
                    },
                  ]
                : undefined
            }
            style={styles.bodyLink}
            pressedStyle={styles.pressed}>
            {body}
          </PreviewLink>
        ) : (
          <Pressable onPress={onPress} style={styles.bodyLink}>
            {body}
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

/** E · the lineup's best moves, one tap to make them. */
export function LineupAdviceCard({ team, onApply }: { team: MyTeam; onApply: (advice: Advice[]) => void }) {
  const advice = useMemo(() => lineupAdvice(team.roster, team.roster_slots ?? {}), [team]);
  const signature = advice.map((a) => `${a.change.player.player_id}>${a.change.kind === 'swap' ? a.change.other.player_id : a.change.toSlot}`).join(',');
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (advice.length === 0 || dismissed === signature) return null;
  const total = advice.reduce((n, a) => n + a.delta, 0);
  return (
    <View style={styles.advice}>
      <Text style={styles.adviceKicker}>
        {advice.length === 1 ? '1 better move' : `${advice.length} better moves`} · +{total.toFixed(1)} projected
      </Text>
      {advice.map((a) => (
        <Text key={a.reason} style={styles.adviceLine}>
          Start {a.reason}
          <Text style={{ color: UP }}>  +{a.delta.toFixed(1)}</Text>
        </Text>
      ))}
      <View style={styles.adviceButtons}>
        <Pressable
          onPress={() => {
            haptics.tap();
            onApply(advice);
          }}
          style={({ pressed }) => [styles.adviceGo, pressed && styles.pressed]}>
          <Text style={styles.adviceGoText}>{advice.length === 1 ? 'Make the move' : 'Make the moves'}</Text>
        </Pressable>
        <Pressable onPress={() => setDismissed(signature)} style={({ pressed }) => [styles.adviceSkip, pressed && styles.pressed]}>
          <Text style={styles.adviceSkipText}>Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** The bar while a player is picked up: who's moving, Drop and Cancel. */
export function MoveBar({ entry, onCancel, bottom }: { entry: RosterEntry; onCancel: () => void; bottom: number }) {
  return (
    <View style={[styles.bar, { bottom }]}>
      <Text style={styles.barText} numberOfLines={2}>
        <Text style={styles.barStrong}>Moving {entry.player_name}.</Text> Tap a glowing spot, or hold and drag. Green adds points.
      </Text>
      <Pressable onPress={() => confirmDropPlayer({ id: entry.player_id, name: entry.player_name }, onCancel)} hitSlop={8}>
        <Text style={styles.barDrop}>Drop</Text>
      </Pressable>
      <Pressable onPress={onCancel} style={({ pressed }) => [styles.barButton, pressed && styles.pressed]}>
        <Text style={styles.barButtonText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

/** After a move: what happened, and Undo for a few seconds. */
export function UndoBar({ label, onUndo, bottom }: { label: string; onUndo: () => void; bottom: number }) {
  return (
    <View style={[styles.bar, { bottom }]}>
      <Text style={styles.barText} numberOfLines={2}>
        {label}
      </Text>
      <Pressable onPress={onUndo} style={({ pressed }) => [styles.barButton, pressed && styles.pressed]}>
        <Text style={[styles.barButtonText, { color: Colors.accent }]}>Undo</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { position: 'relative', marginTop: Spacing.sm },
  item: { position: 'absolute', left: 0, right: 0 },
  shadow: { shadowColor: '#000', shadowRadius: 18, shadowOffset: { width: 0, height: 10 } },
  head: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingBottom: 8, paddingHorizontal: 4 },
  headTitle: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' },
  benchDrop: { borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.accent, paddingHorizontal: 10, paddingVertical: 3 },
  benchDropText: { color: Colors.accent, fontSize: 12, fontWeight: '700' },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingRight: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  liftedRow: { backgroundColor: Colors.tileRaised, borderColor: Colors.accent },
  targetRow: { borderColor: withAlpha(Colors.accent, 0.8), backgroundColor: withAlpha(Colors.accent, 0.08) },
  hovered: { borderColor: Colors.accent, backgroundColor: withAlpha(Colors.accent, 0.2) },
  dim: { opacity: 0.35 },
  emptyRow: { borderStyle: 'dashed', borderColor: Colors.border, backgroundColor: 'transparent', paddingLeft: Spacing.md },
  emptyText: { flex: 1, color: Colors.textSecondary, fontSize: 14, fontStyle: 'italic' },
  pill: {
    minWidth: 48,
    minHeight: 32,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillEditable: { borderColor: withAlpha(Colors.accent, 0.6) },
  pillTarget: { borderColor: Colors.accent, backgroundColor: Colors.accent },
  pillText: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700' },
  pillTextEditable: { color: Colors.accent },
  pillTextTarget: { color: Colors.bg },
  bodyLink: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  player: { flex: 1, minWidth: 0, gap: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  name: { color: Colors.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  injury: { color: Colors.loss, fontSize: 11, fontWeight: '700' },
  locked: { color: Colors.textSecondary, fontSize: 11 },
  detail: { color: Colors.textSecondary, fontSize: 12, fontVariant: ['tabular-nums'] },
  right: { alignItems: 'flex-end', minWidth: 56 },
  points: { color: Colors.text, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  small: { color: Colors.textSecondary, fontSize: 11, fontVariant: ['tabular-nums'] },
  delta: { fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
  deltaBig: { fontSize: 15 },
  pressed: { opacity: 0.6 },
  advice: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    gap: Spacing.sm,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: withAlpha(UP, 0.45),
    backgroundColor: withAlpha(UP, 0.08),
  },
  adviceKicker: { color: UP, fontSize: 11, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase' },
  adviceLine: { color: Colors.text, fontSize: 14, lineHeight: 20 },
  adviceButtons: { flexDirection: 'row', gap: Spacing.sm, marginTop: 2 },
  adviceGo: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: Radius.md, backgroundColor: UP },
  adviceGoText: { color: '#06210f', fontSize: 14, fontWeight: '800' },
  adviceSkip: { paddingVertical: 10, paddingHorizontal: Spacing.lg, borderRadius: Radius.md, backgroundColor: withAlpha(UP, 0.12) },
  adviceSkipText: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  bar: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.tileRaised,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  barText: { flex: 1, color: Colors.text, fontSize: 13, lineHeight: 18 },
  barStrong: { fontWeight: '700' },
  barDrop: { color: Colors.loss, fontSize: 13, fontWeight: '700' },
  barButton: { paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: Radius.md, backgroundColor: Colors.surface },
  barButtonText: { color: Colors.text, fontSize: 13, fontWeight: '700' },
});
