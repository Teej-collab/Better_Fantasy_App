import { useEffect, useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, Path, RadialGradient, Stop } from 'react-native-svg';

import { Colors } from '@/constants/theme';
import { useAppearance } from '@/lib/appearance';

// The web's CinematicHoneycombBackground: a grid of thin crimson
// hexagon outlines over the page background, with a few cells slowly
// "breathing" light. Same geometry (pointy-top hexes, radius 3% of the
// screen's long edge, clamped 22–44), grid alpha 0.3.
const SQRT3 = Math.sqrt(3);
const GRID_ALPHA = 0.3;
const GLOWING_CELLS = 10;

const AnimatedPath = Animated.createAnimatedComponent(Path);

function hexPath(cx: number, cy: number, r: number): string {
  let d = '';
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    d += `${i === 0 ? 'M' : 'L'}${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }
  return `${d}Z`;
}

// A fixed pseudo-random sequence, so the same cells glow on every
// render instead of reshuffling.
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function GlowCell({ d, delay, duration, color }: { d: string; delay: number; duration: number; color: string }) {
  const systemReduced = useReducedMotion();
  const appReduced = useAppearance().reducedMotion;
  const reduceMotion = systemReduced || appReduced;
  const opacity = useSharedValue(reduceMotion ? 0.35 : 0);
  useEffect(() => {
    if (reduceMotion) return;
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(0.75, { duration: duration / 2, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: duration / 2, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
      ),
    );
  }, [reduceMotion, delay, duration, opacity]);
  const animatedProps = useAnimatedProps(() => ({ opacity: opacity.value }));
  return <AnimatedPath d={d} fill="url(#cellGlow)" stroke={color} strokeWidth={1.2} animatedProps={animatedProps} />;
}

export function HoneycombBackground() {
  const { width, height } = useWindowDimensions();
  const color = useAppearance().honeycomb;
  const r = Math.min(44, Math.max(22, 0.03 * Math.max(width, height)));

  const { grid, glowing } = useMemo(() => {
    const colStep = SQRT3 * r;
    const rowStep = 1.5 * r;
    const cells: string[] = [];
    for (let row = -1; row * rowStep < height + r; row++) {
      const offset = row % 2 === 0 ? 0 : colStep / 2;
      for (let col = -1; col * colStep < width + r; col++) {
        cells.push(hexPath(col * colStep + offset, row * rowStep, r));
      }
    }
    const rand = seeded(7);
    const picks = Array.from({ length: GLOWING_CELLS }, () => ({
      d: cells[Math.floor(rand() * cells.length)],
      delay: Math.floor(rand() * 6000),
      duration: 5000 + Math.floor(rand() * 4000),
    }));
    return { grid: cells.join(''), glowing: picks };
  }, [width, height, r]);

  // Settings > Appearance > Background: off.
  if (!color) return <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.bg]} />;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.bg]}>
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id="cellGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity={0} />
            <Stop offset="0.6" stopColor={color} stopOpacity={0.06} />
            <Stop offset="1" stopColor={color} stopOpacity={0.22} />
          </RadialGradient>
        </Defs>
        <Path d={grid} stroke={color} strokeOpacity={GRID_ALPHA} strokeWidth={1} fill="none" />
        {glowing.map((cell, i) => (
          <GlowCell key={i} {...cell} color={color} />
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { backgroundColor: Colors.bg },
});
