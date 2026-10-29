import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { haptics } from '@/lib/haptics';
import { hasSkia } from '@/lib/skia';
import type { NflGame } from '@/lib/types';

// Weather Watch's living panes (Niko's idea, 2026-10-29 "Weather Watch ·
// animated" mockup; the web's twin is frontend/src/components/living/
// WeatherFx.tsx): each game's row sits on its own weather. Rain speckles
// the glass (Niko: drops hitting the screen, not falling lines) and
// storms flash with lightning too (tap one to make it strike); snow falls
// with frost in the corners, from a few flurries up to a sideways
// blizzard; and wind blows swirls across, over any of the others too (tap
// for a gust). Builds with Skia draw it all with real soft light
// (WeatherFxSkia.tsx); these plain versions are for older builds. With
// Reduce Motion on, just the still tint.

type Weather = NonNullable<NflGame['weather']>;
export type WeatherKind = 'storm' | 'snow' | 'rain' | 'wind' | 'cold';

const PANE_BG = '#10141f';
const STORM = '#a99bff';
const RAIN = '#4cc3ff';
const ICE = '#cfeaff';
const WIND = '#5ff2d6';

// Wind that changes a game: kickers miss, teams run more. 15 mph
// sustained or 25 mph gusts.
export function windy(w: Weather): boolean {
  return (w.wind_mph ?? 0) >= 15 || (w.wind_gust_mph ?? 0) >= 25;
}

export function weatherKind(w: Weather): WeatherKind {
  const c = w.condition?.toLowerCase() ?? '';
  if (/thunder|storm|lightning/.test(c)) return 'storm';
  if (/snow|sleet|flurr|ice|wintry/.test(c)) return 'snow';
  if (/rain|shower|drizzle/.test(c)) return 'rain';
  if (windy(w) || /wind/.test(c)) return 'wind';
  return 'cold';
}

export type SnowLevel = 'flurries' | 'snow' | 'blizzard';

export function snowLevel(w: Weather): SnowLevel {
  const c = w.condition?.toLowerCase() ?? '';
  if (/blizzard|heavy snow/.test(c) || (w.wind_mph ?? 0) >= 20 || (w.wind_gust_mph ?? 0) >= 35) return 'blizzard';
  if (/flurr|light snow|snow shower/.test(c)) return 'flurries';
  return 'snow';
}

/** What the pane calls the weather: ESPN's words, except "Windy" when the
 *  wind is the story (ESPN would say "Partly cloudy") and "Blizzard" for
 *  snow in a gale. */
export function weatherLabel(w: Weather): string | null {
  const kind = weatherKind(w);
  if (kind === 'wind') return 'Windy';
  if (kind === 'snow' && snowLevel(w) === 'blizzard') return 'Blizzard';
  return w.condition;
}

export function kindColor(kind: WeatherKind): string {
  return kind === 'storm' ? STORM : kind === 'rain' ? RAIN : kind === 'wind' ? WIND : ICE;
}

// "Wind 14 mph, gusts 23" from 10 mph up; gusts only when clearly stronger.
export function windLine(w: Weather): string | null {
  if ((w.wind_mph ?? 0) < 10) return null;
  return `Wind ${w.wind_mph} mph${(w.wind_gust_mph ?? 0) > (w.wind_mph ?? 0) + 5 ? `, gusts ${w.wind_gust_mph}` : ''}`;
}

/** A game's row on its weather. */
export function WeatherPane({ weather, label, children }: { weather: Weather; label: string; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const kind = weatherKind(weather);
  const blowing = windy(weather);
  const level = kind === 'snow' ? snowLevel(weather) : null;
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Bumped by a tap: a strike for storms, a gust for wind.
  const [poke, setPoke] = useState(0);
  const color = kindColor(kind);
  const interactive = !reduceMotion && (kind === 'storm' || blowing);
  const onLayout = (e: LayoutChangeEvent) => setSize({ w: Math.round(e.nativeEvent.layout.width), h: Math.round(e.nativeEvent.layout.height) });

  const skia = hasSkia && !reduceMotion && size.w > 0;
  // Required here, not imported: older builds have no Skia to load.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const WeatherFxSkia = skia ? (require('@/components/living/WeatherFxSkia') as typeof import('@/components/living/WeatherFxSkia')).WeatherFxSkia : null;
  const fx = WeatherFxSkia ? (
    <WeatherFxSkia w={size.w} h={size.h} kind={kind} level={level} blowing={blowing} poke={poke} />
  ) : size.w > 0 && (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {kind === 'storm' && <Clouds w={size.w} still={reduceMotion} />}
      {!reduceMotion && (kind === 'storm' || kind === 'rain') && <Rain w={size.w} h={size.h} heavy={kind === 'storm'} />}
      {!reduceMotion && kind === 'rain' && <Beads w={size.w} h={size.h} />}
      {(kind === 'snow' || kind === 'cold') && <Frost w={size.w} h={size.h} still={reduceMotion} />}
      {kind === 'snow' && level === 'blizzard' && <Whiteout still={reduceMotion} />}
      {!reduceMotion && level && <Snow w={size.w} h={size.h} level={level} />}
      {!reduceMotion && (blowing || level === 'blizzard') && <Wind w={size.w} h={size.h} poke={poke} white={kind === 'snow'} />}
      {!reduceMotion && kind === 'storm' && <Lightning w={size.w} poke={poke} />}
    </View>
  );

  const body = (
    <View onLayout={onLayout} style={[styles.pane, { borderColor: withAlphaHex(color, 0.35) }]}>
      {fx}
      <View style={styles.content}>{children}</View>
    </View>
  );
  if (!interactive) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={kind === 'storm' ? 'Plays a lightning strike' : 'Plays a gust of wind'}
      onPress={() => {
        if (kind === 'storm') haptics.thud();
        else haptics.tap();
        setPoke((n) => n + 1);
      }}>
      {body}
    </Pressable>
  );
}

function withAlphaHex(hex: string, alpha: number): string {
  return `${hex}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')}`;
}

// A value looping 0 → 1 forever, starting `offset` of the way in.
function useLoop(duration: number, offset = 0, easing = Easing.linear): SharedValue<number> {
  const v = useSharedValue(offset);
  useEffect(() => {
    v.set(
      withSequence(
        withTiming(1, { duration: duration * (1 - offset), easing }),
        withRepeat(withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration, easing })), -1),
      ),
    );
    return () => cancelAnimation(v);
  }, [v, duration, offset, easing]);
  return v;
}

// ---- Storm ----

function Clouds({ w, still }: { w: number; still: boolean }) {
  const drift = useSharedValue(0);
  useEffect(() => {
    if (still) return;
    drift.set(withRepeat(withTiming(1, { duration: 9000, easing: Easing.inOut(Easing.sin) }), -1, true));
    return () => cancelAnimation(drift);
  }, [drift, still]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: drift.get() * w * 0.06 }] }));
  return (
    <Animated.View style={[{ position: 'absolute', left: -w * 0.1, top: -36, width: w * 1.2, height: 90 }, style]}>
      <Svg width={w * 1.2} height={90}>
        <Defs>
          <RadialGradient id="cl" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#464b6e" stopOpacity={0.6} />
            <Stop offset="1" stopColor="#464b6e" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={w * 0.5} height={80} fill="url(#cl)" />
        <Rect x={w * 0.35} y={-10} width={w * 0.55} height={90} fill="url(#cl)" />
        <Rect x={w * 0.75} y={4} width={w * 0.45} height={76} fill="url(#cl)" />
      </Svg>
    </Animated.View>
  );
}

function Lightning({ w, poke }: { w: number; poke: number }) {
  const flash = useSharedValue(0);
  useEffect(() => {
    // Flicker, flicker, gone; again every five and a half seconds.
    const strike = () => withSequence(withTiming(1, { duration: 60 }), withTiming(0.1, { duration: 90 }), withTiming(0.85, { duration: 70 }), withTiming(0, { duration: 320 }));
    if (poke > 0) flash.set(withSequence(strike(), withDelay(4800, withRepeat(withSequence(strike(), withDelay(4900, withTiming(0, { duration: 0 }))), -1))));
    else flash.set(withDelay(3200, withRepeat(withSequence(strike(), withDelay(4900, withTiming(0, { duration: 0 }))), -1)));
    return () => cancelAnimation(flash);
  }, [flash, poke]);
  const style = useAnimatedStyle(() => ({ opacity: flash.get() }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <Svg width={w} height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="fl" cx="70%" cy="0%" r="90%">
            <Stop offset="0" stopColor="#e1dcff" stopOpacity={0.55} />
            <Stop offset="0.6" stopColor="#968cff" stopOpacity={0.12} />
            <Stop offset="1" stopColor="#968cff" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#fl)" />
      </Svg>
      <Svg width={30} height={68} viewBox="0 0 40 90" style={{ position: 'absolute', right: 64, top: -4 }}>
        <Path d="M24 0 L8 40 L20 40 L10 90 L34 32 L21 32 L30 0 Z" fill="#f2efff" />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.edge]} />
    </Animated.View>
  );
}

// ---- Rain ----

// Drops hitting the glass: each speck lands, swells, and fades where it hit.
function Rain({ w, h, heavy }: { w: number; h: number; heavy: boolean }) {
  const count = heavy ? 26 : 14;
  const duration = heavy ? 1100 : 1800;
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Speck key={i} x={((i * 47 + 9) % 97) / 100 * w} y={((i * 31 + 5) % 90) / 100 * h} size={3 + ((i * 7) % 5)} offset={((i * 0.29) % 1)} duration={duration} heavy={heavy} />
      ))}
    </>
  );
}

function Speck({ x, y, size, offset, duration, heavy }: { x: number; y: number; size: number; offset: number; duration: number; heavy: boolean }) {
  const t = useLoop(duration, offset);
  const style = useAnimatedStyle(() => {
    const p = t.get();
    return {
      opacity: p < 0.08 ? p / 0.08 : 1 - (p - 0.08) / 0.92,
      transform: [{ translateY: p * 3 }, { scale: p < 0.08 ? 0.2 + (p / 0.08) * 0.95 : p < 0.18 ? 1.15 - ((p - 0.08) / 0.1) * 0.15 : 1 }],
    };
  });
  return (
    <Animated.View
      style={[
        styles.speck,
        { left: x, top: y, width: size, height: size, borderRadius: size, backgroundColor: heavy ? 'rgba(205,200,255,0.55)' : 'rgba(190,225,255,0.5)' },
        style,
      ]}
    />
  );
}

function Beads({ w, h }: { w: number; h: number }) {
  return (
    <>
      {Array.from({ length: 8 }, (_, i) => (
        <Bead key={i} x={(((i * 53 + 17) % 92) + 2) / 100 * w} y={(((i * 29 + 11) % 55) + 6) / 100 * h} offset={((i * 0.37) % 1)} duration={3200 + (i % 4) * 500} />
      ))}
    </>
  );
}

function Bead({ x, y, offset, duration }: { x: number; y: number; offset: number; duration: number }) {
  const t = useLoop(duration, offset, Easing.in(Easing.quad));
  const style = useAnimatedStyle(() => {
    const p = t.get();
    return {
      opacity: p < 0.12 ? p / 0.12 : 1 - (p - 0.12) / 0.88,
      transform: [{ translateY: p < 0.55 ? 0 : (p - 0.55) * 140 }, { scale: p < 0.12 ? 0.4 + (p / 0.12) * 0.6 : 1 }],
    };
  });
  return <Animated.View style={[styles.bead, { left: x, top: y }, style]} />;
}

// ---- Snow and cold ----

function Frost({ w, h, still }: { w: number; h: number; still: boolean }) {
  const breathe = useSharedValue(1);
  useEffect(() => {
    if (still) return;
    breathe.set(withRepeat(withTiming(0.6, { duration: 4000, easing: Easing.inOut(Easing.sin) }), -1, true));
    return () => cancelAnimation(breathe);
  }, [breathe, still]);
  const style = useAnimatedStyle(() => ({ opacity: breathe.get() }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <Svg width={w} height={h}>
        <Defs>
          <RadialGradient id="f1" cx="0%" cy="0%" r="45%">
            <Stop offset="0" stopColor="#e6f5ff" stopOpacity={0.35} />
            <Stop offset="1" stopColor="#e6f5ff" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="f2" cx="100%" cy="100%" r="45%">
            <Stop offset="0" stopColor="#e6f5ff" stopOpacity={0.28} />
            <Stop offset="1" stopColor="#e6f5ff" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={w} height={h} fill="url(#f1)" />
        <Rect width={w} height={h} fill="url(#f2)" />
      </Svg>
    </Animated.View>
  );
}

const SNOW = {
  flurries: { count: 9, base: 4600, step: 800 },
  snow: { count: 18, base: 3200, step: 600 },
  blizzard: { count: 40, base: 900, step: 250 },
} as const;

function Snow({ w, h, level }: { w: number; h: number; level: SnowLevel }) {
  const { count, base, step } = SNOW[level];
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Flake
          key={i}
          x={((i * 37 + 9) % 100) / 100 * w}
          y={((i * 23) % 100) / 100 * h}
          w={w}
          h={h}
          size={2 + (i % (level === 'blizzard' ? 4 : 3))}
          offset={((i * 0.71) % 4) / 4}
          duration={base + (i % 5) * step}
          sideways={level === 'blizzard'}
        />
      ))}
    </>
  );
}

function Flake({ x, y, w, h, size, offset, duration, sideways }: { x: number; y: number; w: number; h: number; size: number; offset: number; duration: number; sideways: boolean }) {
  const t = useLoop(duration, offset);
  // Falling, or in a blizzard driven sideways across the whole pane.
  const style = useAnimatedStyle(() =>
    sideways
      ? { transform: [{ translateX: -x - 10 + t.get() * (w + 20) }, { translateY: -y * 0.4 + t.get() * h * 0.6 }] }
      : { transform: [{ translateY: -y - 8 + t.get() * (h + 16) }, { translateX: t.get() * 14 }] },
  );
  return <Animated.View style={[{ position: 'absolute', top: y, left: x, width: size, height: size, borderRadius: size, backgroundColor: '#fff', opacity: 0.8 }, style]} />;
}

// A blizzard's white haze, thickening and thinning.
function Whiteout({ still }: { still: boolean }) {
  const v = useSharedValue(0.75);
  useEffect(() => {
    if (still) return;
    v.set(withRepeat(withTiming(0.35, { duration: 1600, easing: Easing.inOut(Easing.sin) }), -1, true));
    return () => cancelAnimation(v);
  }, [v, still]);
  const style = useAnimatedStyle(() => ({ opacity: v.get() }));
  return <Animated.View style={[StyleSheet.absoluteFill, styles.whiteout, style]} />;
}

// ---- Wind ----

const AnimatedPath = Animated.createAnimatedComponent(Path);
const SWIRL_DASH = 460;

function Wind({ w, h, poke, white }: { w: number; h: number; poke: number; white: boolean }) {
  // Paths drawn for a 390 × 120 pane, scaled to this one.
  const paths = [
    'M-20 34 C60 18 120 46 190 30 S300 12 330 26 C350 36 335 52 318 46',
    'M-20 74 C70 62 140 88 230 70 S340 58 420 70',
    'M-20 100 C80 92 150 108 210 98 C250 92 265 78 250 72 C238 68 228 76 238 82',
  ];
  return (
    <Svg width={w} height={h} viewBox="0 0 390 120" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
      {paths.map((d, i) => (
        <Swirl key={i} d={d} delay={i * 870} poke={poke} color={white ? '#f0faff' : '#8cffe6'} />
      ))}
    </Svg>
  );
}

function Swirl({ d, delay, poke, color }: { d: string; delay: number; poke: number; color: string }) {
  const t = useSharedValue(0);
  // 0 → 1 while a tapped gust blows: brighter, thicker swirls.
  const gust = useSharedValue(0);
  useEffect(() => {
    const run = (duration: number) => withRepeat(withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration, easing: Easing.bezier(0.4, 0, 0.3, 1) })), -1);
    if (poke > 0) {
      // A tap: three quick gusts, then back to the breeze.
      gust.set(withSequence(withTiming(1, { duration: 150 }), withDelay(1900, withTiming(0, { duration: 400 }))));
      t.set(withSequence(withTiming(0, { duration: 0 }), withDelay(delay / 3.5, withRepeat(withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration: 700 })), 3)), run(2600)));
    } else {
      t.set(withDelay(delay, run(2600)));
    }
    return () => {
      cancelAnimation(t);
      cancelAnimation(gust);
    };
  }, [t, gust, delay, poke]);
  const props = useAnimatedProps(() => ({
    strokeDashoffset: SWIRL_DASH * (1 - t.get()),
    strokeOpacity: 0.45 + 0.3 * gust.get(),
    strokeWidth: 2 + gust.get(),
  }));
  return <AnimatedPath d={d} fill="none" stroke={color} strokeLinecap="round" strokeDasharray={[60, 400]} animatedProps={props} />;
}

const styles = StyleSheet.create({
  pane: { borderRadius: 16, borderWidth: 1, backgroundColor: PANE_BG, overflow: 'hidden' },
  content: { paddingHorizontal: 12, paddingVertical: 10 },
  edge: { borderRadius: 16, borderWidth: 1.5, borderColor: 'rgba(190,180,255,0.9)' },
  speck: { position: 'absolute' },
  whiteout: { backgroundColor: 'rgba(230,242,255,0.16)' },
  bead: { position: 'absolute', width: 5, height: 7, borderRadius: 3, backgroundColor: 'rgba(200,230,255,0.45)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.6)' },
});
