import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Colors } from '@/constants/theme';

// The New Here cards' background (2026-10-28): a faint honeycomb that
// drifts, with soft lights wandering and pulsing behind it, like the
// app's own background (components/HoneycombBackground.tsx), kept
// quiet and faded toward the bottom so the words stay easy to read.
// Every moving part is a transform or opacity on the UI thread, and it
// holds still when the phone's Reduce Motion is on.

const TILE_W = 30.8;
const TILE_H = 55;
const HEX = 'M15.4 36.3L0 27.5L0 8.8L15.4 0L30.8 8.8L30.8 27.5L15.4 36.3L15.4 55';

function Glow({ x, y, size, dx, dy, ms, still, accent }: { x: number; y: number; size: number; dx: number; dy: number; ms: number; still: boolean; accent: string }) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (still) return;
    t.value = withRepeat(withTiming(1, { duration: ms, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [still, ms, t]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.55 + 0.45 * t.value,
    transform: [{ translateX: dx * t.value }, { translateY: dy * t.value }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size }, style]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="g" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={accent} stopOpacity={0.22} />
            <Stop offset="1" stopColor={accent} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={size} height={size} fill="url(#g)" />
      </Svg>
    </Animated.View>
  );
}

export function TourHoneycomb({ width, height }: { width: number; height: number }) {
  const still = useReducedMotion();
  const drift = useSharedValue(0);
  useEffect(() => {
    if (still) return;
    drift.value = withRepeat(withTiming(1, { duration: 28_000, easing: Easing.linear }), -1, false);
  }, [still, drift]);
  const driftStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -TILE_W * drift.value }, { translateY: -TILE_H * drift.value }],
  }));
  const accent = Colors.accent;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      <Glow x={width * 0.2} y={120} size={300} dx={150} dy={110} ms={19_000} still={still} accent={accent} />
      <Glow x={width * 0.85} y={height * 0.45} size={320} dx={-170} dy={-120} ms={23_000} still={still} accent={accent} />
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: width + TILE_W * 2, height: height + TILE_H * 2, opacity: 0.07 }, driftStyle]}>
        <Svg width="100%" height="100%">
          <Defs>
            <Pattern id="hex" width={TILE_W} height={TILE_H} patternUnits="userSpaceOnUse">
              <Path d={HEX} fill="none" stroke={accent} strokeWidth={1} />
            </Pattern>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#hex)" />
        </Svg>
      </Animated.View>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={Colors.surface} stopOpacity={0} />
            <Stop offset="0.55" stopColor={Colors.surface} stopOpacity={0.55} />
            <Stop offset="1" stopColor={Colors.surface} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width={width} height={height} fill="url(#fade)" />
      </Svg>
    </View>
  );
}
