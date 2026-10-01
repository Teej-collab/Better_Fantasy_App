import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated';

import { Text } from '@/components/Text';
import { Colors, Radius } from '@/constants/theme';
import { useGamecastIdFinder } from '@/lib/queries';
import type { TickerItem } from '@/lib/ticker';

// Points per second the strip scrolls; faster on game day, like the
// web's live-ticker-track--fast.
const SPEED = 40;
const FAST_SPEED = 70;

// The web's LiveTicker: a line of items scrolling right to left forever
// that you can also swipe yourself, and tap — an NFL game opens its
// Gamecast, a league game its matchup.
//
// The line slides by a transform the UI thread updates each frame, so
// it never involves the JS thread (an earlier version scrolled a real
// scroll view instead, and its per-frame scroll events swamped the JS
// thread until taps anywhere on the screen stopped responding). A pan
// gesture takes over while you swipe and lets it coast to a stop. The
// item set repeats enough to always overfill the strip, and the offset
// wraps by exactly one set's width, so there's no gap, no visible
// restart, and a label changing width (a countdown ticking down) doesn't
// jump it back to the start.
export function LiveTicker({ items, fast = false }: { items: TickerItem[]; fast?: boolean }) {
  const reduceMotion = useReducedMotion();
  const findGamecastId = useGamecastIdFinder();
  const [stripWidth, setStripWidth] = useState(0);
  const [setWidth, setSetWidth] = useState(0);
  // One set's width: the wrap period.
  const period = useSharedValue(0);
  // The line's x offset; kept in (-2·period, -period].
  const offset = useSharedValue(0);
  const held = useSharedValue(false);
  // A flick's leftover speed (points/second), slowing to a stop.
  const velocity = useSharedValue(0);
  const panStart = useSharedValue(0);
  const speed = fast ? FAST_SPEED : SPEED;

  // Wraps x into (-2·p, -p]: identical content, so the jump can't be seen.
  function wrap(x: number, p: number) {
    'worklet';
    if (p <= 0) return x;
    while (x > -p) x -= p;
    while (x <= -2 * p) x += p;
    return x;
  }

  useFrameCallback((frame) => {
    const p = period.get();
    if (p <= 0 || held.get()) return;
    const dt = (frame.timeSincePreviousFrame ?? 16) / 1000;
    let x = offset.get();
    const v = velocity.get();
    if (Math.abs(v) > 5) {
      // Coast after a flick, then hand back to the auto-scroll.
      x += v * dt;
      velocity.set(v * Math.pow(0.05, dt));
    } else {
      velocity.set(0);
      if (!reduceMotion) x -= speed * dt;
    }
    offset.set(wrap(x, p));
  });

  const pan = Gesture.Pan()
    // Horizontal swipes only, so taps reach the items and vertical
    // scrolling of the page still works.
    .activeOffsetX([-8, 8])
    .failOffsetY([-10, 10])
    .onBegin(() => {
      held.set(true);
      velocity.set(0);
      panStart.set(offset.get());
    })
    .onUpdate((e) => {
      offset.set(wrap(panStart.get() + e.translationX, period.get()));
    })
    .onEnd((e) => {
      velocity.set(e.velocityX);
    })
    .onFinalize(() => {
      held.set(false);
    });

  const lineStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() }] }));

  if (items.length === 0) return null;

  // Enough sets that, offset by up to two sets, the strip is always full.
  const sets = setWidth > 0 && stripWidth > 0 ? Math.ceil(stripWidth / setWidth) + 3 : 1;

  function open(item: TickerItem) {
    if (item.game) {
      const id = findGamecastId(item.game.home, item.game.away);
      if (id) router.push({ pathname: '/gamecast/[id]', params: { id } });
      else router.push('/gamecast');
    } else if (item.matchupId) {
      router.push({ pathname: '/matchup/[id]', params: { id: String(item.matchupId) } });
    }
  }

  const line = (copy: number) => (
    <View
      key={copy}
      style={styles.line}
      onLayout={
        copy === 0
          ? (e) => {
              const w = e.nativeEvent.layout.width;
              setSetWidth(w);
              if (period.get() === 0) offset.set(-w);
              period.set(w);
            }
          : undefined
      }>
      {items.map((item) => (
        <Pressable key={item.key} onPress={() => open(item)} disabled={!item.game && !item.matchupId} style={styles.itemWrap}>
          <Text style={styles.item} numberOfLines={1}>
            {item.segments.map((seg, i) => (
              <Text key={i} style={seg.color ? [styles.team, { color: lighten(seg.color) }] : undefined}>
                {seg.text}
              </Text>
            ))}
            <Text style={styles.separator}>{'   •   '}</Text>
          </Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <View style={[styles.shell, fast && styles.shellLive]} onLayout={(e) => setStripWidth(e.nativeEvent.layout.width)}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.track, lineStyle]}>{Array.from({ length: sets }, (_, i) => line(i))}</Animated.View>
      </GestureDetector>
    </View>
  );
}

// Several team colors (NYG navy, LAR blue) are unreadable on the dark
// strip; lift them toward white the way the web's ticker does with its
// text glow.
function lighten(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * 0.35);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `rgb(${r},${g},${b})`;
}

const styles = StyleSheet.create({
  shell: {
    overflow: 'hidden',
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    backgroundColor: 'rgba(18,22,28,0.85)',
  },
  shellLive: { borderColor: 'rgba(239,68,68,0.6)' },
  track: { flexDirection: 'row', alignSelf: 'flex-start', paddingVertical: 11 },
  // Never shrink to the screen width: the line runs as long as it needs.
  line: { flexDirection: 'row', flexShrink: 0 },
  itemWrap: { flexShrink: 0 },
  item: { color: Colors.text, fontSize: 17, flexShrink: 0 },
  team: { fontWeight: '700' },
  separator: { color: Colors.textSecondary },
});
