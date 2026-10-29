import { Image } from 'expo-image';
import { useEffect } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, G, Path, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';

import { IntroSeasonDecor } from '@/components/IntroSeasonDecor';
import { Text } from '@/components/Text';
import { Brand } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { currentSeason, seasonalEmblem, type Season } from '@/lib/seasonal';

// The quick open, every launch after the day's full intro (2026-10-29
// "Hive Toss", Niko's pick: the coin toss's motion with Hive Ignite's
// size and colors). The Hive Mark is flipped up like a coin, lands with
// a ring and sparks, its cells light one by one with the orange one
// last, the real logo (seasonal: the jack-o'-lantern, the ice hive)
// settles over them, "Welcome Back" rises, and the app opens through a
// hexagon growing out of the orange cell. The web's twin is
// frontend/src/components/HiveTossOpen.tsx.

// Timeline, ms from mount.
const TOSS_AT = 150;
const TOSS_MS = 1000;
const LAND_AT = TOSS_AT + TOSS_MS * 0.88;
const CELLS_AT = LAND_AT + 30;
const CELL_STEP = 70;
const LIT_AT = CELLS_AT + 6 * CELL_STEP + 20;
const LOGO_AT = LIT_AT + 80;
const WELCOME_AT = LOGO_AT + 140;
const IRIS_AT = WELCOME_AT + 750;
const IRIS_MS = 700;
const DONE_AT = IRIS_AT + IRIS_MS;

// The Hive Mark's seven cells, in its own 400-unit square (flat-top,
// radius 58), in the order they light; the last is the orange one.
const CELLS: [number, number][] = [
  [200, 89.1],
  [104, 144.6],
  [104, 255.4],
  [200, 310.9],
  [296, 255.4],
  [200, 200],
  [296, 144.6],
];
const LIT = CELLS[6];
const hex = (cx: number, cy: number, r = 58) =>
  [
    [cx + r, cy],
    [cx + r / 2, cy + r * 0.866],
    [cx - r / 2, cy + r * 0.866],
    [cx - r, cy],
    [cx - r / 2, cy - r * 0.866],
    [cx + r / 2, cy - r * 0.866],
  ]
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');

const TUBES: Record<Season | 'standard', { tube: (i: number) => string; lit: string; glow: string; welcome: string }> = {
  standard: { tube: () => '#39ff14', lit: '#ff7a1a', glow: 'rgba(57,255,20,0.85)', welcome: '#39ff14' },
  Halloween: { tube: (i) => (i % 2 ? '#b44dff' : '#39ff14'), lit: '#ff7a1a', glow: 'rgba(255,122,26,0.85)', welcome: '#ff8a2a' },
  Winter: { tube: () => '#9fdcff', lit: '#bfeaff', glow: 'rgba(120,200,255,0.9)', welcome: '#e6f6ff' },
};

const SPARKS = [
  [-130, -30],
  [-95, -85],
  [-40, -115],
  [30, -120],
  [95, -85],
  [130, -25],
  [-150, 10],
  [150, 12],
];

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedPath = Animated.createAnimatedComponent(Path);

export function HiveTossOpen({ displayName, onDone }: { displayName: string | null; onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const season = currentSeason();
  const look = TUBES[season ?? 'standard'];
  const size = Math.min(width - 30, 380);
  const left = (width - size) / 2;
  const top = height * 0.42 - size / 2;
  const scale = size / 400;
  // The iris opens out of the orange cell.
  const ox = left + LIT[0] * scale;
  const oy = top + LIT[1] * scale;
  const irisMax = Math.hypot(Math.max(ox, width - ox), Math.max(oy, height - oy)) * 1.25;

  const toss = useSharedValue(0);
  const land = useSharedValue(0);
  const cells = [useSharedValue(0), useSharedValue(0), useSharedValue(0), useSharedValue(0), useSharedValue(0), useSharedValue(0), useSharedValue(0)];
  const logo = useSharedValue(0);
  const welcome = useSharedValue(0);
  const iris = useSharedValue(0);

  useEffect(() => {
    toss.set(withDelay(TOSS_AT, withTiming(1, { duration: TOSS_MS, easing: Easing.bezier(0.3, 0.6, 0.4, 1) })));
    land.set(withDelay(LAND_AT, withTiming(1, { duration: 700, easing: Easing.out(Easing.quad) })));
    cells.forEach((c, i) => {
      const at = i === 6 ? LIT_AT : CELLS_AT + i * CELL_STEP;
      // A neon tube catching: flicker, then on.
      c.set(withDelay(at, withSequence(withTiming(0.85, { duration: 80 }), withTiming(0.15, { duration: 50 }), withTiming(1, { duration: 90 }))));
    });
    logo.set(withDelay(LOGO_AT, withTiming(1, { duration: 320, easing: Easing.out(Easing.quad) })));
    welcome.set(withDelay(WELCOME_AT, withTiming(1, { duration: 500, easing: Easing.bezier(0.2, 0.8, 0.2, 1) })));
    iris.set(withDelay(IRIS_AT, withTiming(1, { duration: IRIS_MS, easing: Easing.bezier(0.6, 0, 0.4, 1) })));
    const thud = setTimeout(() => haptics.thud(), LAND_AT);
    const done = setTimeout(onDone, DONE_AT);
    return () => {
      clearTimeout(thud);
      clearTimeout(done);
    };
    // Mount-only: the whole open runs on its own clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Up from below the screen, over the top, down onto its spot, a little
  // squash on landing; five flips on the way.
  const coinStyle = useAnimatedStyle(() => {
    const t = toss.get();
    const rise = t < 0.48 ? t / 0.48 : 1;
    const fall = t < 0.48 ? 0 : Math.min(1, (t - 0.48) / 0.4);
    const y = t < 0.48 ? 600 - 720 * (1 - (1 - rise) * (1 - rise)) : t < 0.88 ? -120 + 120 * fall * fall : 0;
    const squash = t > 0.88 && t < 0.97 ? Math.sin(((t - 0.88) / 0.09) * Math.PI) * 0.04 : 0;
    return {
      transform: [
        { perspective: 900 },
        { translateY: y },
        { scale: (t < 0.48 ? 0.6 + 0.44 * rise : 1.04 - 0.04 * fall) + squash },
        { scaleY: 1 - squash * 1.5 },
        { rotateX: `${Math.min(1, t / 0.88) * 1800}deg` },
      ],
    };
  });
  const shadowStyle = useAnimatedStyle(() => {
    const t = toss.get();
    const s = t < 0.48 ? 0.3 + 0.2 * (t / 0.48) : 0.5 + 0.5 * Math.min(1, (t - 0.48) / 0.4);
    return { opacity: t < 0.48 ? (t / 0.48) * 0.25 : 0.25 + 0.75 * Math.min(1, (t - 0.48) / 0.4), transform: [{ scale: s }] };
  });
  const ringStyle = useAnimatedStyle(() => ({ opacity: land.get() > 0 ? 1 - land.get() : 0, transform: [{ scale: 0.6 + 1.8 * land.get() }] }));
  const logoStyle = useAnimatedStyle(() => ({ opacity: logo.get(), transform: [{ scale: 1.06 - 0.06 * logo.get() }] }));
  const welcomeStyle = useAnimatedStyle(() => ({ opacity: welcome.get(), transform: [{ translateY: 14 * (1 - welcome.get()) }] }));
  // Everything on the stage zooms into the hole as it opens.
  const stageStyle = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, iris.get() * 2.5), transform: [{ scale: 1 + 0.35 * iris.get() }] }));
  const irisProps = useAnimatedProps(() => {
    const r = Math.max(0.01, irisMax * iris.get());
    const pts = [0, 1, 2, 3, 4, 5].map((k) => {
      const a = ((60 * k - 90) * Math.PI) / 180;
      return `${(ox + r * Math.cos(a)).toFixed(1)} ${(oy + r * Math.sin(a)).toFixed(1)}`;
    });
    return { d: `M0 0H${width}V${height}H0Z M${pts.join(' L')}Z` };
  });
  const irisRing = useAnimatedProps(() => {
    const r = Math.max(0.01, irisMax * iris.get());
    const pts = [0, 1, 2, 3, 4, 5].map((k) => {
      const a = ((60 * k - 90) * Math.PI) / 180;
      return `${(ox + r * Math.cos(a)).toFixed(1)} ${(oy + r * Math.sin(a)).toFixed(1)}`;
    });
    return { d: `M${pts.join(' L')}Z`, strokeOpacity: iris.get() > 0 ? 1 - iris.get() * 0.6 : 0 };
  });

  return (
    <View style={styles.gate} accessible accessibilityLabel={`The Weekend. Welcome Back${displayName ? `, ${displayName}` : ''}`}>
      {/* The room, with a hexagon hole that grows to let the app through. */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <AnimatedPath animatedProps={irisProps} fill={Brand.bg} fillRule="evenodd" />
        <AnimatedPath animatedProps={irisRing} fill="none" stroke={look.lit} strokeWidth={2} />
      </Svg>

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, stageStyle]}>
        <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
          <Defs>
            <RadialGradient id="spill" cx="50%" cy="42%" r="60%">
              <Stop offset="0" stopColor={look.tube(0)} stopOpacity={0.12} />
              <Stop offset="1" stopColor={look.tube(0)} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width={width} height={height} fill="url(#spill)" />
        </Svg>
        <IntroSeasonDecor />

        <Animated.View style={[styles.shadow, { left: width / 2 - 80, top: top + size * 0.9 }, shadowStyle]} />
        <Animated.View style={[styles.ring, { left: width / 2 - 90, top: top + size * 0.86, borderColor: look.welcome, shadowColor: look.welcome }, ringStyle]} />
        {SPARKS.map(([dx, dy], i) => (
          <Spark key={i} x={width / 2} y={top + size * 0.9} dx={dx} dy={dy} land={land} color={season === 'Winter' ? '#f4fbff' : i % 2 ? '#ff8a2a' : '#39ff14'} />
        ))}

        <Animated.View style={[{ position: 'absolute', left, top, width: size, height: size }, coinStyle]}>
          <View style={[StyleSheet.absoluteFill, styles.back]}>
            <Svg width={size} height={size} viewBox="0 0 400 400">
              {CELLS.map(([cx, cy], i) => (
                <Polygon key={i} points={hex(cx, cy)} fill={i === 6 ? look.lit : 'rgba(255,122,26,0.12)'} stroke="#ff8a2a" strokeWidth={3} />
              ))}
            </Svg>
          </View>
          <View style={[StyleSheet.absoluteFill, styles.front]}>
            <Svg width={size} height={size} viewBox="0 0 400 400">
              {CELLS.map(([cx, cy], i) => (
                <Cell key={i} cx={cx} cy={cy} on={cells[i]} color={i === 6 ? look.lit : look.tube(i)} lit={i === 6} />
              ))}
            </Svg>
            <Animated.View style={[StyleSheet.absoluteFill, logoStyle]}>
              <Image source={seasonalEmblem()} style={{ width: size, height: size }} contentFit="contain" />
            </Animated.View>
          </View>
        </Animated.View>

        <Animated.View style={[styles.welcomeWrap, { top: top + size * 0.98 }, welcomeStyle]}>
          <Text style={[styles.welcome, { color: look.welcome, textShadowColor: look.glow }]}>Welcome Back{displayName ? `, ${displayName}` : ''}</Text>
        </Animated.View>
      </Animated.View>

      <Pressable onPress={onDone} hitSlop={12} style={[styles.skip, { top: insets.top + 8 }]}>
        <Text style={styles.skipText}>Skip →</Text>
      </Pressable>
    </View>
  );
}

// One cell: dark glass, then a neon tube that catches when `on` runs.
function Cell({ cx, cy, on, color, lit }: { cx: number; cy: number; on: SharedValue<number>; color: string; lit: boolean }) {
  const glow = useAnimatedProps(() => ({ opacity: on.get() }));
  const pts = hex(cx, cy);
  return (
    <>
      <Polygon points={pts} fill={lit ? 'rgba(255,122,26,0.18)' : '#0b130d'} stroke={color} strokeOpacity={0.6} strokeWidth={2.5} />
      <AnimatedG animatedProps={glow}>
        {lit && <Polygon points={pts} fill={color} fillOpacity={0.85} />}
        <Polygon points={pts} fill="none" stroke={color} strokeOpacity={0.1} strokeWidth={18} strokeLinejoin="round" />
        <Polygon points={pts} fill="none" stroke={color} strokeOpacity={0.25} strokeWidth={9} strokeLinejoin="round" />
        <Polygon points={pts} fill="none" stroke={color} strokeWidth={3.2} strokeLinejoin="round" />
        <Polygon points={pts} fill="none" stroke="#ffffff" strokeOpacity={0.8} strokeWidth={1} strokeLinejoin="round" />
      </AnimatedG>
    </>
  );
}

function Spark({ x, y, dx, dy, land, color }: { x: number; y: number; dx: number; dy: number; land: SharedValue<number>; color: string }) {
  const style = useAnimatedStyle(() => {
    const p = land.get();
    return { opacity: p > 0 ? 1 - p : 0, transform: [{ translateX: dx * p }, { translateY: dy * p }, { scale: 1 - 0.6 * p }] };
  });
  return <Animated.View style={[styles.spark, { left: x - 4, top: y - 4, backgroundColor: color, shadowColor: color }, style]} />;
}

const styles = StyleSheet.create({
  gate: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 100 },
  front: { backfaceVisibility: 'hidden' },
  back: { backfaceVisibility: 'hidden', transform: [{ rotateX: '180deg' }] },
  shadow: { position: 'absolute', width: 160, height: 24, borderRadius: 80, backgroundColor: 'rgba(0,0,0,0.75)' },
  ring: { position: 'absolute', width: 180, height: 56, borderRadius: 90, borderWidth: 3, shadowOpacity: 0.9, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } },
  spark: { position: 'absolute', width: 8, height: 8, borderRadius: 4, shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  welcomeWrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  welcome: { fontFamily: 'Anton_400Regular', fontSize: 30, letterSpacing: 0.5, textAlign: 'center', textShadowRadius: 14 },
  skip: { position: 'absolute', right: 20, zIndex: 10 },
  skipText: { color: 'rgba(245,244,236,0.4)', fontSize: 12 },
});
