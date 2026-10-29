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
import type { NflGame } from '@/lib/types';

// Weather Watch's living panes (Niko's idea, 2026-10-29 "Weather Watch ·
// animated" mockup; the web's twin is frontend/src/components/living/
// WeatherFx.tsx): each game's row sits on its own weather. Storms rain
// and flash with lightning (tap one to make it strike), rain beads on the
// glass, snow falls with frost in the corners, and wind blows swirls
// across, over any of the others too (tap for a gust). With Reduce
// Motion on, just the still tint.

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
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Bumped by a tap: a strike for storms, a gust for wind.
  const [poke, setPoke] = useState(0);
  const color = kindColor(kind);
  const interactive = !reduceMotion && (kind === 'storm' || blowing);
  const onLayout = (e: LayoutChangeEvent) => setSize({ w: Math.round(e.nativeEvent.layout.width), h: Math.round(e.nativeEvent.layout.height) });

  const fx = size.w > 0 && (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {kind === 'storm' && <Clouds w={size.w} still={reduceMotion} />}
      {!reduceMotion && (kind === 'storm' || kind === 'rain') && <Rain w={size.w} h={size.h} heavy={kind === 'storm'} />}
      {!reduceMotion && kind === 'rain' && <Beads w={size.w} h={size.h} />}
      {(kind === 'snow' || kind === 'cold') && <Frost w={size.w} h={size.h} still={reduceMotion} />}
      {!reduceMotion && kind === 'snow' && <Snow w={size.w} h={size.h} />}
      {!reduceMotion && blowing && <Wind w={size.w} h={size.h} poke={poke} />}
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

function Rain({ w, h, heavy }: { w: number; h: number; heavy: boolean }) {
  const count = heavy ? 16 : 10;
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Streak key={i} x={((i * 61) % 100) / 100 * (w + 40) - 20} h={h} offset={((i * 37) % 100) / 100} heavy={heavy} />
      ))}
    </>
  );
}

function Streak({ x, h, offset, heavy }: { x: number; h: number; offset: number; heavy: boolean }) {
  const t = useLoop(heavy ? 520 : 800, offset);
  const len = heavy ? 18 : 12;
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: -len + t.get() * (h + len) }, { translateX: -t.get() * 14 }, { rotate: '15deg' }] }));
  return <Animated.View style={[{ position: 'absolute', top: 0, left: x, width: 1, height: len, backgroundColor: heavy ? 'rgba(170,190,255,0.35)' : 'rgba(140,200,255,0.3)' }, style]} />;
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

function Snow({ w, h }: { w: number; h: number }) {
  return (
    <>
      {Array.from({ length: 16 }, (_, i) => (
        <Flake key={i} x={((i * 37 + 9) % 100) / 100 * w} h={h} size={2 + (i % 3)} offset={((i * 0.71) % 4) / 4} duration={3200 + (i % 5) * 600} />
      ))}
    </>
  );
}

function Flake({ x, h, size, offset, duration }: { x: number; h: number; size: number; offset: number; duration: number }) {
  const t = useLoop(duration, offset);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: -8 + t.get() * (h + 16) }, { translateX: t.get() * 14 }] }));
  return <Animated.View style={[{ position: 'absolute', top: 0, left: x, width: size, height: size, borderRadius: size, backgroundColor: '#fff', opacity: 0.8 }, style]} />;
}

// ---- Wind ----

const AnimatedPath = Animated.createAnimatedComponent(Path);
const SWIRL_DASH = 460;

function Wind({ w, h, poke }: { w: number; h: number; poke: number }) {
  // Paths drawn for a 390 × 120 pane, scaled to this one.
  const paths = [
    'M-20 34 C60 18 120 46 190 30 S300 12 330 26 C350 36 335 52 318 46',
    'M-20 74 C70 62 140 88 230 70 S340 58 420 70',
    'M-20 100 C80 92 150 108 210 98 C250 92 265 78 250 72 C238 68 228 76 238 82',
  ];
  return (
    <Svg width={w} height={h} viewBox="0 0 390 120" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
      {paths.map((d, i) => (
        <Swirl key={i} d={d} delay={i * 870} poke={poke} />
      ))}
    </Svg>
  );
}

function Swirl({ d, delay, poke }: { d: string; delay: number; poke: number }) {
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
  return <AnimatedPath d={d} fill="none" stroke="#8cffe6" strokeLinecap="round" strokeDasharray={[60, 400]} animatedProps={props} />;
}

const styles = StyleSheet.create({
  pane: { borderRadius: 16, borderWidth: 1, backgroundColor: PANE_BG, overflow: 'hidden' },
  content: { paddingHorizontal: 12, paddingVertical: 10 },
  edge: { borderRadius: 16, borderWidth: 1.5, borderColor: 'rgba(190,180,255,0.9)' },
  bead: { position: 'absolute', width: 5, height: 7, borderRadius: 3, backgroundColor: 'rgba(200,230,255,0.45)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.6)' },
});
