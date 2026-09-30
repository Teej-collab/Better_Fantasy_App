import { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Text } from '@/components/Text';
import { Colors, Radius } from '@/constants/theme';
import type { TickerItem } from '@/lib/ticker';

// Points per second the strip scrolls; faster on game day, like the
// web's live-ticker-track--fast.
const SPEED = 40;
const FAST_SPEED = 70;

// The web's LiveTicker: one line of items scrolling right to left
// forever. The line is drawn twice back to back and shifted by exactly
// one copy's width, so the loop has no seam. With Reduce Motion on it
// holds still and scrolls sideways by hand instead.
export function LiveTicker({ items, fast = false }: { items: TickerItem[]; fast?: boolean }) {
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const offset = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion || width === 0) return;
    offset.value = 0;
    offset.value = withRepeat(
      withTiming(-width, { duration: (width / (fast ? FAST_SPEED : SPEED)) * 1000, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(offset);
  }, [width, fast, reduceMotion, offset]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  if (items.length === 0) return null;

  const line = (onLayout?: (e: LayoutChangeEvent) => void) => (
    <View style={styles.line} onLayout={onLayout}>
      {items.map((item) => (
        <Text key={item.key} style={styles.item} numberOfLines={1}>
          {item.segments.map((s, i) => (
            <Text key={i} style={s.color ? [styles.team, { color: lighten(s.color) }] : undefined}>
              {s.text}
            </Text>
          ))}
          <Text style={styles.separator}>{'   •   '}</Text>
        </Text>
      ))}
    </View>
  );

  return (
    <View style={[styles.shell, fast && styles.shellLive]}>
      <Animated.View style={[styles.track, !reduceMotion && style]}>
        {line((e) => setWidth(e.nativeEvent.layout.width))}
        {!reduceMotion && line()}
      </Animated.View>
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
  track: { flexDirection: 'row', alignSelf: 'flex-start', paddingVertical: 6 },
  // Never shrink to the screen width: the line runs as long as it needs.
  line: { flexDirection: 'row', flexShrink: 0, paddingLeft: 12 },
  item: { color: Colors.text, fontSize: 13, flexShrink: 0 },
  team: { fontWeight: '700' },
  separator: { color: Colors.textSecondary },
});
