import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Ellipse, G, Line, Path } from 'react-native-svg';

import { currentSeason } from '@/lib/seasonal';

// The intro's seasonal touches, behind the words (port of the web's
// IntroSeasonDecor.tsx): a corner web and two dangling spiders in
// October, falling snow in winter — the same windows as the logo
// (lib/seasonal.ts). Nothing the rest of the year.

const LEGS = ['M-6 0 L-26 -14 L-38 4', 'M-6 4 L-30 -2 L-40 18', 'M-6 8 L-28 12 L-36 32', 'M6 0 L26 -14 L38 4', 'M6 4 L30 -2 L40 18', 'M6 8 L28 12 L36 32'];

function Spider({ left, thread, size, period, delay }: { left: number; thread: number; size: number; period: number; delay: number }) {
  const reduceMotion = useReducedMotion();
  const bob = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    bob.set(withDelay(delay, withRepeat(withTiming(1, { duration: period / 2, easing: Easing.inOut(Easing.sin) }), -1, true)));
  }, [bob, reduceMotion, period, delay]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: 12 * bob.get() }] }));
  return (
    <Animated.View style={[styles.spider, { left }, style]}>
      <View style={[styles.thread, { height: thread }]} />
      <Svg viewBox="-44 -24 88 72" width={size} height={size * 0.82} style={{ marginTop: -4 }}>
        <G stroke="#ff7a1a" strokeWidth={7} strokeLinecap="round" fill="none">
          {LEGS.map((d) => (
            <Path key={d} d={d} />
          ))}
        </G>
        <G stroke="#0f0c14" strokeWidth={3.4} strokeLinecap="round" fill="none">
          {LEGS.map((d) => (
            <Path key={d} d={d} />
          ))}
        </G>
        <Ellipse cx={0} cy={12} rx={15} ry={19} fill="#0f0c14" stroke="#ff7a1a" strokeWidth={3} />
        <Circle cx={0} cy={-10} r={10} fill="#0f0c14" stroke="#ff7a1a" strokeWidth={2.6} />
        <Circle cx={-4} cy={-11} r={2.6} fill="#ff7a1a" />
        <Circle cx={4} cy={-11} r={2.6} fill="#ff7a1a" />
      </Svg>
    </Animated.View>
  );
}

// Fixed spots so the snow looks the same every time.
const FLAKES = [3, 10, 17, 24, 30, 37, 44, 51, 57, 64, 71, 77, 84, 90, 96, 7, 54, 87].map((x, i) => ({
  x,
  size: 3 + (i % 4),
  opacity: 0.45 + (i % 3) * 0.2,
  duration: (7 + (i % 5) * 1.6) * 1000,
  // Start part-way down so the screen isn't empty at first.
  start: ((i * 1.37) % 9) / 9,
}));

function Flake({ x, size, opacity, duration, start, width, height }: (typeof FLAKES)[number] & { width: number; height: number }) {
  const reduceMotion = useReducedMotion();
  const fall = useSharedValue(start);
  useEffect(() => {
    if (reduceMotion) return;
    // Finish this fall from where it starts, then loop full falls.
    fall.set(
      withTiming(1, { duration: duration * (1 - start), easing: Easing.linear }, (done) => {
        'worklet';
        if (!done) return;
        fall.set(0);
        fall.set(withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false));
      }),
    );
  }, [fall, reduceMotion, duration, start]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: -30 + (height + 60) * fall.get() }] }));
  return (
    <Animated.View
      style={[styles.flake, { left: (x / 100) * width, width: size, height: size, borderRadius: size / 2, opacity }, style]}
    />
  );
}

export function IntroSeasonDecor() {
  const { width, height } = useWindowDimensions();
  const season = currentSeason();
  if (season === 'Halloween') {
    return (
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Svg viewBox="250 0 140 154" width={170} height={187} style={styles.web}>
          <G stroke="#d9d9e6" strokeWidth={1.6} strokeLinecap="round" fill="none" opacity={0.7}>
            <Line x1={390} y1={0} x2={250} y2={20} />
            <Line x1={390} y1={0} x2={276} y2={78} />
            <Line x1={390} y1={0} x2={318} y2={122} />
            <Line x1={390} y1={0} x2={362} y2={146} />
            <Line x1={390} y1={0} x2={388} y2={152} />
            <Path d="M338 8 Q 346 26 352 36 Q 362 48 368 66 Q 378 72 388 80" />
            <Path d="M296 14 Q 310 42 322 56 Q 334 76 344 96 Q 364 104 388 112" />
            <Path d="M258 20 Q 278 60 296 74 Q 314 102 332 120 Q 358 134 389 140" />
          </G>
        </Svg>
        <Spider left={width * 0.11} thread={150} size={40} period={3200} delay={0} />
        <Spider left={width * 0.84} thread={250} size={32} period={4100} delay={800} />
      </View>
    );
  }
  if (season === 'Winter') {
    return (
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {FLAKES.map((f, i) => (
          <Flake key={i} {...f} width={width} height={height} />
        ))}
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  web: { position: 'absolute', top: 0, right: 0 },
  spider: { position: 'absolute', top: 0, alignItems: 'center' },
  thread: { width: 1.5, backgroundColor: 'rgba(217,217,230,0.7)' },
  flake: { position: 'absolute', top: 0, backgroundColor: '#eaf7ff' },
});
