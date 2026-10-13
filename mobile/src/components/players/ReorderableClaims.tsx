import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Text } from '@/components/Text';
import { Colors, Radius, withAlpha } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import type { WaiverClaim } from '@/lib/types';

// Every row is the same height, so a row's slot is just index × ROW.
const ROW = 64;
const SPRING = { damping: 22, stiffness: 260 };

function move(ids: number[], from: number, to: number): number[] {
  'worklet';
  const next = ids.slice();
  const [id] = next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

function sameOrder(a: number[], b: number[]): boolean {
  'worklet';
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function laterClear(claim: WaiverClaim, firstClear: string | null): string | null {
  if (!claim.clears_at || !firstClear || claim.clears_at === firstClear) return null;
  const when = new Date(claim.clears_at);
  const day = when.toLocaleDateString(undefined, { weekday: 'short' });
  const time = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `clears ${day} ${time}`;
}

/**
 * Pending waiver claims you rank by holding the ≡ grip and dragging,
 * like ESPN's Waiver Claims > Edit. The rows renumber as you drag, the
 * phone buzzes at each new spot, and onReorder fires once when you let
 * go somewhere new. Swipe a row left (or long-press it) to cancel it.
 */
export function ReorderableClaims({
  claims,
  onReorder,
  onCancel,
  onDragChange,
}: {
  claims: WaiverClaim[];
  onReorder: (claimIds: number[]) => void;
  onCancel: (claim: WaiverClaim) => void;
  onDragChange: (dragging: boolean) => void;
}) {
  const ids = claims.map((c) => c.id);
  const order = useSharedValue<number[]>(ids);
  const key = ids.join(',');
  // A refetch or a cancel changes the list: start from the server's order.
  useEffect(() => {
    order.set(key ? key.split(',').map(Number) : []);
  }, [key, order]);

  const firstClear = claims.map((c) => c.clears_at).filter((x): x is string => x !== null).sort()[0] ?? null;

  return (
    <View style={[styles.list, { height: claims.length * ROW }]}>
      {claims.map((claim) => (
        <ClaimRow
          key={claim.id}
          claim={claim}
          order={order}
          count={claims.length}
          note={laterClear(claim, firstClear)}
          onReorder={onReorder}
          onCancel={onCancel}
          onDragChange={onDragChange}
        />
      ))}
    </View>
  );
}

function ClaimRow({
  claim,
  order,
  count,
  note,
  onReorder,
  onCancel,
  onDragChange,
}: {
  claim: WaiverClaim;
  order: SharedValue<number[]>;
  count: number;
  note: string | null;
  onReorder: (claimIds: number[]) => void;
  onCancel: (claim: WaiverClaim) => void;
  onDragChange: (dragging: boolean) => void;
}) {
  const id = claim.id;
  const top = useSharedValue(order.get().indexOf(id) * ROW);
  const dragging = useSharedValue(false);
  const startTop = useSharedValue(0);
  const startOrder = useSharedValue<number[]>([]);
  const swipe = useSharedValue(0);

  // Slide into the row's slot whenever the order changes — unless it's
  // the row under your finger, which follows the finger instead.
  useAnimatedReaction(
    () => order.get().indexOf(id),
    (index, previous) => {
      if (index < 0 || index === previous || dragging.get()) return;
      top.set(previous === null ? index * ROW : withSpring(index * ROW, SPRING));
    },
  );

  const drag = Gesture.Pan()
    .minDistance(0)
    .onStart(() => {
      dragging.set(true);
      startTop.set(top.get());
      startOrder.set(order.get());
      runOnJS(onDragChange)(true);
      runOnJS(haptics.tap)();
    })
    .onUpdate((e) => {
      const y = Math.min(Math.max(startTop.get() + e.translationY, 0), (count - 1) * ROW);
      top.set(y);
      const from = order.get().indexOf(id);
      const to = Math.round(y / ROW);
      if (from !== to) {
        order.set(move(order.get(), from, to));
        runOnJS(haptics.select)();
      }
    })
    .onFinalize(() => {
      dragging.set(false);
      top.set(withSpring(order.get().indexOf(id) * ROW, SPRING));
      runOnJS(onDragChange)(false);
      if (!sameOrder(order.get(), startOrder.get())) runOnJS(onReorder)(order.get());
    });

  // Swipe left past the threshold to cancel; it springs back either way
  // (the confirm alert decides).
  const cancelSwipe = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-10, 10])
    .onUpdate((e) => {
      swipe.set(Math.min(0, e.translationX));
    })
    .onEnd(() => {
      if (swipe.get() < -80) runOnJS(onCancel)(claim);
      swipe.set(withTiming(0));
    });

  const rowStyle = useAnimatedStyle(() => {
    const lifted = dragging.get();
    return {
      top: top.get(),
      zIndex: lifted ? 10 : 0,
      transform: [{ scale: withSpring(lifted ? 1.03 : 1, SPRING) }],
      shadowOpacity: withTiming(lifted ? 0.5 : 0),
      borderColor: lifted ? Colors.accent : 'transparent',
    };
  });
  const rankStyle = useAnimatedStyle(() => ({
    color: order.get().indexOf(id) === 0 ? Colors.accent : Colors.text,
  }));
  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: swipe.get() }],
    backgroundColor: dragging.get() ? Colors.tileRaised : Colors.surface,
  }));

  return (
    <Animated.View style={[styles.row, rowStyle]}>
      <View style={styles.cancelUnder}>
        <Text style={styles.cancelUnderText}>Cancel</Text>
      </View>
      <GestureDetector gesture={cancelSwipe}>
        <Animated.View style={[styles.rowInner, contentStyle]}>
          <GestureDetector gesture={drag}>
            <View
              style={styles.grip}
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel={`Reorder ${claim.add_player_name}`}
              accessibilityHint="Hold and drag up or down">
              <GripIcon />
            </View>
          </GestureDetector>
          <RankNumber order={order} id={id} style={rankStyle} />
          <Pressable style={styles.text} onLongPress={() => onCancel(claim)} accessibilityHint="Long-press to cancel">
            <Text style={styles.name} numberOfLines={1}>
              {claim.add_player_name}
              {claim.add_player_position && (
                <Text style={styles.meta}>
                  {'  '}
                  {claim.add_player_position}
                  {claim.add_player_pro_team ? ` · ${claim.add_player_pro_team}` : ''}
                </Text>
              )}
            </Text>
            <Text style={styles.drop} numberOfLines={1}>
              {claim.drop_player_name ? `Drop ${claim.drop_player_name}` : 'No drop'}
              {note && <Text style={styles.note}> · {note}</Text>}
            </Text>
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

// The live rank: follows the shared order so rows renumber mid-drag.
function RankNumber({
  order,
  id,
  style,
}: {
  order: SharedValue<number[]>;
  id: number;
  style: ReturnType<typeof useAnimatedStyle<{ color: string }>>;
}) {
  const [shown, setShown] = useState(() => order.get().indexOf(id) + 1);
  useAnimatedReaction(
    () => order.get().indexOf(id) + 1,
    (next, previous) => {
      if (next !== previous && next > 0) runOnJS(setShown)(next);
    },
  );
  return <Animated.Text style={[styles.rank, style]}>{shown}</Animated.Text>;
}

function GripIcon() {
  return (
    <View style={styles.gripDots} importantForAccessibility="no-hide-descendants">
      {[0, 1, 2].map((r) => (
        <View key={r} style={styles.gripRow}>
          <View style={styles.dot} />
          <View style={styles.dot} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { position: 'relative' },
  row: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: ROW,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  cancelUnder: {
    ...StyleSheet.absoluteFill,
    backgroundColor: withAlpha(Colors.loss, 0.25),
    borderRadius: Radius.md,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 20,
  },
  cancelUnderText: { color: Colors.loss, fontSize: 14, fontWeight: '700' },
  rowInner: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 12, borderRadius: Radius.md },
  grip: { width: 44, height: ROW, alignItems: 'center', justifyContent: 'center' },
  gripDots: { gap: 3 },
  gripRow: { flexDirection: 'row', gap: 4 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: Colors.textSecondary },
  rank: { width: 22, textAlign: 'center', fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  text: { flex: 1, gap: 2, justifyContent: 'center', height: ROW },
  name: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  meta: { color: Colors.textSecondary, fontSize: 12, fontWeight: '500' },
  drop: { color: Colors.textSecondary, fontSize: 12 },
  note: { color: '#f5b942' },
});
