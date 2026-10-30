import {
  BlurMask,
  Canvas,
  Circle,
  FillType,
  Group,
  Image,
  LinearGradient,
  Oval,
  Path,
  RadialGradient,
  Rect,
  Skia,
  Text,
  useFont,
  useImage,
  vec,
  type SkPath,
} from '@shopify/react-native-skia';
import { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useDerivedValue, useSharedValue, withDelay, withRepeat, withSequence, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IntroSeasonDecor } from '@/components/IntroSeasonDecor';
import { Text as RNText } from '@/components/Text';
import { Brand } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { currentSeason, seasonalPourEmblem, type Season } from '@/lib/seasonal';

// The quick open, every launch after the day's full intro (2026-10-29
// "Hive Toss", Niko's pick: the coin toss's motion with Hive Ignite's
// size and colors), drawn with Skia so it has the mockup's real glow,
// soft shadow and light sweep. The Hive Mark is flipped up like a coin,
// lands with a ring and sparks, its neon cells catch one by one with the
// orange one last, the real logo (seasonal: the jack-o'-lantern, the ice
// hive) settles over them, "Welcome Back" rises with a light sweeping
// across it, and the app opens through a hexagon growing out of the
// orange cell. With `full` it is also the full intro's finale, landing
// on the can opening after WELCOME / TO / THE. Only required where Skia exists (lib/skia.ts). The web's
// twin is frontend/src/components/HiveTossOpen.tsx.

// Timeline, ms from mount.
const TOSS_AT = 150;
const TOSS_MS = 1000;
const LAND_AT = TOSS_AT + TOSS_MS * 0.88;
const CELLS_AT = LAND_AT + 30;
const CELL_STEP = 70;
const LIT_AT = CELLS_AT + 6 * CELL_STEP + 20;
const LOGO_AT = LIT_AT + 80;
const WELCOME_AT = LOGO_AT + 140;
const SWEEP_AT = WELCOME_AT + 100;
const IRIS_AT = WELCOME_AT + 750;
// As the full intro's finale (IntroOverlay, 2026-10-30) it holds about
// as long as the old wordmark did, so the pour plays out under it.
// The orange cell fills like a glass of beer: a stream, the level
// rising with bubbles, a foam head on top. On the full intro it rides
// the pour sound (which starts 1.1 s after the can, i.e. when this
// mounts, and really pours from about 0.6 s to 2.1 s into the file); on
// the quick open it's a quick pour as it lands. The logo drawn over the
// cells is the pour emblem, with that cell left empty, so the poured
// cell stays the lit cell (no pumpkin or solid orange), fizzing and
// rolling until the app opens.
const FULL_POUR_AT = 1650;
const FULL_POUR_MS = 1600;
const FULL_IRIS_AT = FULL_POUR_AT + FULL_POUR_MS + 900;
const POUR_AT = LAND_AT - 30;
const POUR_MS = 560;
const IRIS_MS = 700;

// The Hive Mark's seven cells in its own 400-unit square (flat-top,
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

type Look = { tube: (i: number) => string; lit: string[]; ring: string; welcome: string; glow: string; spill: string; spark: (i: number) => string };
const LOOKS: Record<Season | 'standard', Look> = {
  standard: {
    tube: () => '#39ff14',
    lit: ['#ffe0b8', '#ff9a3c', '#ff6a00', '#b83c00'],
    ring: '#39ff14',
    welcome: '#39ff14',
    glow: 'rgba(57,255,20,0.7)',
    spill: 'rgba(57,255,20,0.13)',
    spark: (i) => (i % 2 ? '#ff8a2a' : '#39ff14'),
  },
  Halloween: {
    tube: (i) => (i % 2 ? '#b44dff' : '#39ff14'),
    lit: ['#ffe0b8', '#ff9a3c', '#ff6a00', '#b83c00'],
    ring: '#ff8a2a',
    welcome: '#ff8a2a',
    glow: 'rgba(255,120,20,0.7)',
    spill: 'rgba(140,60,255,0.16)',
    spark: () => 'rgba(170,110,255,0.8)',
  },
  Winter: {
    tube: () => '#9fdcff',
    lit: ['#ffffff', '#c9eeff', '#4fa9e8', '#1d6db0'],
    ring: '#dff3ff',
    welcome: '#e6f6ff',
    glow: 'rgba(120,200,255,0.8)',
    spill: 'rgba(120,200,255,0.14)',
    spark: () => '#f4fbff',
  },
};

function hexPath(cx: number, cy: number, r = 58): SkPath {
  const p = Skia.Path.Make();
  [0, 1, 2, 3, 4, 5].forEach((k) => {
    const a = (Math.PI / 3) * k;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (k === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  });
  p.close();
  return p;
}

export function HiveTossSkia({ displayName, onDone, full = false }: { displayName: string | null; onDone: () => void; full?: boolean }) {
  const irisAt = full ? FULL_IRIS_AT : IRIS_AT;
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const season = currentSeason();
  const look = LOOKS[season ?? 'standard'];
  const S = Math.min(W - 30, 380);
  const x0 = (W - S) / 2;
  const y0 = H * 0.42 - S / 2;
  const k = S / 400;
  const ox = x0 + LIT[0] * k;
  const oy = y0 + LIT[1] * k;
  const irisMax = Math.hypot(Math.max(ox, W - ox), Math.max(oy, H - oy)) * 1.25;
  const groundY = y0 + S * 0.9;

  const emblem = useImage(seasonalPourEmblem() as number);
  const font = useFont(require('@expo-google-fonts/anton/400Regular/Anton_400Regular.ttf'), 30);
  const hexes = useMemo(() => CELLS.map(([cx, cy]) => hexPath(cx, cy)), []);
  const text = `Welcome Back${displayName ? `, ${displayName}` : ''}`;
  const tw = font ? font.measureText(text).width : 0;
  const tx = (W - tw) / 2;
  const ty = y0 + S * 0.98 + 30;

  const toss = useSharedValue(0);
  const land = useSharedValue(0);
  const c0 = useSharedValue(0);
  const c1 = useSharedValue(0);
  const c2 = useSharedValue(0);
  const c3 = useSharedValue(0);
  const c4 = useSharedValue(0);
  const c5 = useSharedValue(0);
  const c6 = useSharedValue(0);
  const cells = [c0, c1, c2, c3, c4, c5, c6];
  const logo = useSharedValue(0);
  const welcome = useSharedValue(0);
  const sweep = useSharedValue(0);
  const iris = useSharedValue(0);
  const pour = useSharedValue(0);
  // Keeps the beer alive once poured: bubbles rising, the head rolling.
  const fizz = useSharedValue(0);

  useEffect(() => {
    toss.set(withDelay(TOSS_AT, withTiming(1, { duration: TOSS_MS, easing: Easing.bezier(0.3, 0.6, 0.4, 1) })));
    land.set(withDelay(LAND_AT, withTiming(1, { duration: 700, easing: Easing.out(Easing.quad) })));
    cells.forEach((c, i) => {
      const at = i === 6 ? LIT_AT : CELLS_AT + i * CELL_STEP;
      // A neon tube catching: flicker, then on.
      c.set(withDelay(at, withSequence(withTiming(0.85, { duration: 80 }), withTiming(0.15, { duration: 50 }), withTiming(1, { duration: 100 }))));
    });
    // A steady pour: eases in as the stream starts, slows as it tops off.
    pour.set(withDelay(full ? FULL_POUR_AT : POUR_AT, withTiming(1, { duration: full ? FULL_POUR_MS : POUR_MS, easing: full ? Easing.inOut(Easing.sin) : Easing.out(Easing.quad) })));
    fizz.set(withDelay(full ? FULL_POUR_AT : POUR_AT, withRepeat(withTiming(1, { duration: 1600, easing: Easing.linear }), -1, false)));
    logo.set(withDelay(LOGO_AT, withTiming(1, { duration: 320, easing: Easing.out(Easing.quad) })));
    welcome.set(withDelay(WELCOME_AT, withTiming(1, { duration: 500, easing: Easing.bezier(0.2, 0.8, 0.2, 1) })));
    sweep.set(withDelay(SWEEP_AT, withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.quad) })));
    iris.set(withDelay(irisAt, withTiming(1, { duration: IRIS_MS, easing: Easing.bezier(0.6, 0, 0.4, 1) })));
    const thud = setTimeout(() => haptics.thud(), LAND_AT);
    const done = setTimeout(onDone, irisAt + IRIS_MS);
    return () => {
      clearTimeout(thud);
      clearTimeout(done);
    };
    // Mount-only: the open runs on its own clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Up from below the screen, over the top, down onto its spot with a
  // little squash; five flips on the way.
  const coinTransform = useDerivedValue(() => {
    const t = toss.get();
    const rise = Math.min(1, t / 0.48);
    const fall = t < 0.48 ? 0 : Math.min(1, (t - 0.48) / 0.4);
    const y = t < 0.48 ? 600 - 720 * (1 - (1 - rise) * (1 - rise)) : t < 0.88 ? -120 + 120 * fall * fall : 0;
    const squash = t > 0.88 && t < 0.97 ? Math.sin(((t - 0.88) / 0.09) * Math.PI) * 0.04 : 0;
    const s = (t < 0.48 ? 0.6 + 0.44 * rise : 1.04 - 0.04 * fall) + squash;
    return [{ translateY: y }, { perspective: 900 }, { rotateX: Math.min(1, t / 0.88) * 10 * Math.PI }, { scale: s }, { scaleY: 1 - squash * 1.5 }];
  });
  const front = useDerivedValue(() => (Math.cos(Math.min(1, toss.get() / 0.88) * 10 * Math.PI) >= 0 ? 1 : 0));
  const back = useDerivedValue(() => 1 - front.get());
  const shadowOpacity = useDerivedValue(() => {
    const t = toss.get();
    return t < 0.48 ? (t / 0.48) * 0.25 : 0.25 + 0.75 * Math.min(1, (t - 0.48) / 0.4);
  });
  const shadowTransform = useDerivedValue(() => {
    const t = toss.get();
    return [{ scale: t < 0.48 ? 0.3 + 0.2 * (t / 0.48) : 0.5 + 0.5 * Math.min(1, (t - 0.48) / 0.4) }];
  });
  const ringOpacity = useDerivedValue(() => (land.get() > 0 ? 1 - land.get() : 0));
  const ringTransform = useDerivedValue(() => [{ scale: 0.6 + 1.8 * land.get() }]);
  const logoTransform = useDerivedValue(() => [{ scale: 1.06 - 0.06 * logo.get() }]);
  const welcomeTransform = useDerivedValue(() => [{ translateY: 14 * (1 - welcome.get()) }]);
  const sweepStart = useDerivedValue(() => vec(tx - 2 * tw + 2 * tw * sweep.get(), 0));
  const sweepEnd = useDerivedValue(() => vec(tx + tw + 2 * tw * sweep.get(), 0));
  const stageOpacity = useDerivedValue(() => 1 - Math.min(1, iris.get() * 2.5));
  const stageTransform = useDerivedValue(() => [{ scale: 1 + 0.35 * iris.get() }]);
  const irisHole = (r: number) => {
    'worklet';
    const p = Skia.Path.Make();
    for (let i = 0; i < 6; i++) {
      const a = ((60 * i - 90) * Math.PI) / 180;
      if (i === 0) p.moveTo(ox + r * Math.cos(a), oy + r * Math.sin(a));
      else p.lineTo(ox + r * Math.cos(a), oy + r * Math.sin(a));
    }
    p.close();
    return p;
  };
  const room = useDerivedValue(() => {
    const p = Skia.Path.Make();
    p.addRect(Skia.XYWHRect(0, 0, W, H));
    p.addPath(irisHole(Math.max(0.01, irisMax * iris.get())));
    p.setFillType(FillType.EvenOdd);
    return p;
  });
  const irisRing = useDerivedValue(() => irisHole(Math.max(0.01, irisMax * iris.get())));
  const irisRingOpacity = useDerivedValue(() => (iris.get() > 0 ? 1 - iris.get() * 0.6 : 0));
  const decorStyle = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, iris.get() * 2.5) }));

  const hive = { x: x0, y: y0, k };
  return (
    <View style={styles.gate} accessible accessibilityLabel={`The Weekend. ${text}`}>
      <Canvas style={StyleSheet.absoluteFill}>
        {/* The room, with a hexagon hole that grows to let the app through. */}
        <Path path={room} color={Brand.bg} />
        <Path path={irisRing} style="stroke" strokeWidth={2.5} color={look.lit[2]} opacity={irisRingOpacity}>
          <BlurMask blur={4} style="solid" />
        </Path>

        <Group opacity={stageOpacity} transform={stageTransform} origin={vec(ox, oy)}>
          <Rect x={0} y={0} width={W} height={H}>
            <RadialGradient c={vec(W / 2, y0 + S / 2)} r={Math.max(W, H) * 0.55} colors={[look.spill, 'transparent']} />
          </Rect>

          {/* Shadow, landing ring and sparks on the ground. */}
          <Group opacity={shadowOpacity} transform={shadowTransform} origin={vec(W / 2, groundY)}>
            <Oval x={W / 2 - 80} y={groundY - 12} width={160} height={24} color="rgba(0,0,0,0.85)">
              <BlurMask blur={9} style="normal" />
            </Oval>
          </Group>
          <Group opacity={ringOpacity} transform={ringTransform} origin={vec(W / 2, groundY)}>
            <Oval x={W / 2 - 90} y={groundY - 28} width={180} height={56} style="stroke" strokeWidth={3} color={look.ring}>
              <BlurMask blur={5} style="solid" />
            </Oval>
          </Group>
          {SPARKS.map(([dx, dy], i) => (
            <Spark key={i} x={W / 2} y={groundY} dx={dx} dy={dy} land={land} color={look.spark(i)} big={season === 'Halloween'} />
          ))}

          {/* The coin: the hive on the front, an orange honeycomb on the back. */}
          <Group transform={coinTransform} origin={vec(W / 2, y0 + S / 2)}>
            <Group opacity={back} transform={[{ translateX: hive.x }, { translateY: hive.y }, { scale: hive.k }]}>
              {hexes.map((p, i) => (
                <Group key={i}>
                  <Path path={p} color={i === 6 ? '#ff7a1a' : 'rgba(255,122,26,0.14)'} />
                  <Path path={p} style="stroke" strokeWidth={3} color="#ff8a2a">
                    <BlurMask blur={3} style="solid" />
                  </Path>
                </Group>
              ))}
            </Group>
            <Group opacity={front}>
              <Group transform={[{ translateX: hive.x }, { translateY: hive.y }, { scale: hive.k }]}>
                {hexes.map((p, i) => (
                  <Cell key={i} path={p} cx={CELLS[i][0]} cy={CELLS[i][1]} on={cells[i]} color={i === 6 ? look.lit[2] : look.tube(i)} lit={i === 6 ? look.lit : null} pour={pour} fizz={fizz} />
                ))}
              </Group>
              {emblem && (
                <Group opacity={logo} transform={logoTransform} origin={vec(W / 2, y0 + S / 2)}>
                  <Image image={emblem} x={x0} y={y0} width={S} height={S} fit="contain" />
                </Group>
              )}
            </Group>
          </Group>

          {font && (
            <Group opacity={welcome} transform={welcomeTransform}>
              <Text x={tx} y={ty} text={text} font={font} color={look.glow}>
                <BlurMask blur={9} style="normal" />
              </Text>
              <Text x={tx} y={ty} text={text} font={font}>
                <LinearGradient start={sweepStart} end={sweepEnd} colors={[look.welcome, look.welcome, '#ffffff', look.welcome, look.welcome]} positions={[0, 0.42, 0.5, 0.58, 1]} />
              </Text>
            </Group>
          )}
        </Group>
      </Canvas>

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, decorStyle]}>
        <IntroSeasonDecor />
      </Animated.View>
      <Pressable onPress={onDone} hitSlop={12} style={[styles.skip, { top: insets.top + 8 }]}>
        <RNText style={styles.skipText}>Skip →</RNText>
      </Pressable>
    </View>
  );
}

// One cell: dark glass, then a neon tube (a wide soft bloom, a tight
// glow and a white-hot core) that catches when `on` runs; the lit cell
// is poured full (Pour).
const CELL_H = 58 * 0.866;
function Cell({
  path,
  cx,
  cy,
  on,
  color,
  lit,
  pour,
  fizz,
}: {
  path: SkPath;
  cx: number;
  cy: number;
  on: SharedValue<number>;
  color: string;
  lit: string[] | null;
  pour: SharedValue<number>;
  fizz: SharedValue<number>;
}) {
  return (
    <>
      <Path path={path} color={lit ? 'rgba(255,122,26,0.16)' : '#0b130d'} />
      <Path path={path} style="stroke" strokeWidth={2.5} color={color} opacity={0.55} />
      {lit && <Pour path={path} cx={cx} cy={cy} lit={lit} pour={pour} fizz={fizz} />}
      <Group opacity={on}>
        <Path path={path} style="stroke" strokeWidth={6} color={color} opacity={0.6}>
          <BlurMask blur={12} style="normal" />
        </Path>
        <Path path={path} style="stroke" strokeWidth={3.2} color={color} strokeJoin="round">
          <BlurMask blur={2.5} style="solid" />
        </Path>
        <Path path={path} style="stroke" strokeWidth={1} color="rgba(255,255,255,0.8)" strokeJoin="round" />
      </Group>
    </>
  );
}

// The lit cell filling like a glass of beer as `pour` runs 0 → 1: a
// stream falling in from above, the level rising with bubbles, and a
// foam head that builds on top and keeps rolling. The beer stops short
// of the rim; the foam fills the rest.
const FILL = 0.78;
const BUBBLES = [
  [-18, 0.1],
  [6, 0.45],
  [20, 0.75],
  [-6, 0.3],
  [12, 0.9],
];
function Pour({ path, cx, cy, lit, pour, fizz }: { path: SkPath; cx: number; cy: number; lit: string[]; pour: SharedValue<number>; fizz: SharedValue<number> }) {
  const bottom = cy + CELL_H;
  const top = cy - CELL_H;
  const level = useDerivedValue(() => bottom - 2 * CELL_H * FILL * pour.get());
  const foam = useDerivedValue(() => {
    const p = pour.get();
    return p <= 0 ? 0 : 3 + 2 * CELL_H * (1 - FILL) * Math.min(1, p * 1.25);
  });
  const liquid = useDerivedValue(() => Skia.XYWHRect(cx - 60, level.get(), 120, bottom - level.get() + 2));
  // The head: a soft rolling top edge that keeps moving as it pours.
  const head = useDerivedValue(() => {
    const p = fizz.get();
    const y0 = level.get() + 2;
    const y1 = level.get() - foam.get();
    const path = Skia.Path.Make();
    path.moveTo(cx - 60, y0);
    path.lineTo(cx - 60, y1);
    for (let x = -60; x <= 60; x += 6) {
      path.lineTo(cx + x, y1 + 2.4 * Math.sin(x / 7 + p * 2 * Math.PI) + 1.2 * Math.sin(x / 3.1 - p * 4 * Math.PI));
    }
    path.lineTo(cx + 60, y0);
    path.close();
    return path;
  });
  const headOpacity = useDerivedValue(() => (pour.get() > 0 ? 1 : 0));
  const streamTop = top - 46;
  const stream = useDerivedValue(() => {
    const p = pour.get();
    // Thins out at the end of the pour.
    const w = p <= 0 || p >= 1 ? 0 : p > 0.85 ? 6 * ((1 - p) / 0.15) : 6;
    const end = level.get() - foam.get() + 4;
    return Skia.XYWHRect(cx - w / 2 + Math.sin(p * 40) * 0.8, streamTop, w, Math.max(0, end - streamTop));
  });
  return (
    <>
      <Group clip={path}>
        <Rect rect={liquid}>
          <LinearGradient start={vec(cx, top)} end={vec(cx, bottom)} colors={[lit[1], lit[2], lit[3]]} />
        </Rect>
        {BUBBLES.map(([dx, phase], i) => (
          <Bubble key={i} x={cx + dx} bottom={bottom} level={level} pour={pour} fizz={fizz} phase={phase} />
        ))}
        <Path path={head} color="#fff3dc" opacity={headOpacity} />
        <Path path={head} style="stroke" strokeWidth={1.2} color="rgba(255,214,160,0.9)" opacity={headOpacity} />
      </Group>
      <Rect rect={stream}>
        <LinearGradient start={vec(cx, streamTop)} end={vec(cx, bottom)} colors={['rgba(255,190,110,0)', lit[1], lit[2]]} positions={[0, 0.35, 1]} />
      </Rect>
    </>
  );
}

function Bubble({ x, bottom, level, pour, fizz, phase }: { x: number; bottom: number; level: SharedValue<number>; pour: SharedValue<number>; fizz: SharedValue<number>; phase: number }) {
  const cy = useDerivedValue(() => {
    const t = (fizz.get() + phase) % 1;
    return bottom - t * (bottom - level.get());
  });
  const opacity = useDerivedValue(() => (pour.get() > 0 && cy.get() > level.get() + 3 ? 0.75 : 0));
  return <Circle cx={x} cy={cy} r={1.8} color="#fff1d6" opacity={opacity} />;
}

function Spark({ x, y, dx, dy, land, color, big }: { x: number; y: number; dx: number; dy: number; land: SharedValue<number>; color: string; big: boolean }) {
  const cx = useDerivedValue(() => x + dx * land.get());
  const cy = useDerivedValue(() => y + dy * land.get());
  const r = useDerivedValue(() => (big ? 13 : 4) * (1 - 0.6 * land.get()));
  const opacity = useDerivedValue(() => (land.get() > 0 ? 1 - land.get() : 0));
  return (
    <Circle cx={cx} cy={cy} r={r} color={color} opacity={opacity}>
      <BlurMask blur={big ? 8 : 3} style={big ? 'normal' : 'solid'} />
    </Circle>
  );
}

const styles = StyleSheet.create({
  gate: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 100 },
  skip: { position: 'absolute', right: 20, zIndex: 10 },
  skipText: { color: 'rgba(245,244,236,0.4)', fontSize: 12 },
});
