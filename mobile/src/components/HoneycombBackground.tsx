import { useEffect, useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, G, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

import { Floodlight } from '@/components/ob/Ob';
import { Colors, OwnersBox } from '@/constants/theme';
import { useAppearance } from '@/lib/appearance';

// The web's CinematicHoneycombBackground: big charcoal hex plates with a
// light behind them that only shows through the gaps (the neon edges)
// and bleeds onto the plates' rims. A few soft lights wander behind the
// wall and pulse, so edges flare and fade as one passes, and the wall
// drifts a few px a second. Same geometry and tuning as the web
// (flat-top plates, radius 12% of the long edge clamped 70–200, gap
// 4.5% of that).
//
// Built for scrolling on top of it: the plates are one static SVG
// rasterized once, and every moving part (the lights, the drift) is a
// transform or opacity animated on the UI thread — nothing re-renders
// or redraws per frame.
const SQRT3 = Math.sqrt(3);
const AMBIENT = 0.035;
const DRIFT_PX_PER_S = 4;
// One clock drives every light; each moves at a whole-number multiple
// of it so all of them loop seamlessly when it wraps.
const CLOCK_MS = 120_000;

function hexPath(cx: number, cy: number, r: number, turn = 0): string {
  let d = '';
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + turn;
    d += `${i === 0 ? 'M' : 'L'}${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }
  return `${d}Z`;
}

// Owners Box turns each plate 30° to point-up and splits it into a
// cube's three faces (2026-11-23): the lid catches the light, the left
// side sits in half shade, the right in full shade. The gaps between
// plates still carry the light, so the cube edges glow.
function cubeFaces(cx: number, cy: number, r: number): [string, string, string] {
  const v = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  });
  const c = `${cx.toFixed(1)},${cy.toFixed(1)}`;
  // v: 0 top, 1 upper right, 2 lower right, 3 bottom, 4 lower left, 5 upper left.
  return [`M${v[0]}L${v[1]}L${c}L${v[5]}Z`, `M${v[5]}L${c}L${v[3]}L${v[4]}Z`, `M${c}L${v[1]}L${v[2]}L${v[3]}Z`];
}

// A fixed pseudo-random sequence, so the lights take the same paths on
// every render instead of reshuffling.
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

type LightSpec = { size: number; ax: number; ay: number; kx: number; ky: number; kp: number; px: number; py: number; pp: number };

function Light({ spec, clock, cx, cy, color }: { spec: LightSpec; clock: SharedValue<number>; cx: number; cy: number; color: string }) {
  const style = useAnimatedStyle(() => {
    const t = clock.value * Math.PI * 2;
    return {
      opacity: 0.55 + 0.45 * Math.sin(t * spec.kp + spec.pp),
      transform: [
        { translateX: cx + Math.sin(t * spec.kx + spec.px) * spec.ax - spec.size },
        { translateY: cy + Math.sin(t * spec.ky + spec.py) * spec.ay - spec.size },
      ],
    };
  });
  const d = spec.size * 2;
  return (
    <Animated.View style={[styles.light, { width: d, height: d }, style]}>
      <Svg width={d} height={d}>
        <Defs>
          <RadialGradient id="light" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity={1} />
            <Stop offset="0.3" stopColor={color} stopOpacity={0.8} />
            <Stop offset="0.65" stopColor={color} stopOpacity={0.2} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={spec.size} cy={spec.size} r={spec.size} fill="url(#light)" />
      </Svg>
    </Animated.View>
  );
}

// Owners Box hangs its floodlight (components/ob/Ob.tsx) over the same
// hex wall (2026-11-23; it had the floodlight alone). Background lights
// set to Off leaves just the floodlight.
export function HoneycombBackground() {
  if (!OwnersBox) return <HoneycombClassic />;
  return (
    <>
      <HoneycombClassic />
      <Floodlight over />
    </>
  );
}

function HoneycombClassic() {
  const { width, height } = useWindowDimensions();
  const color = useAppearance().honeycomb;
  const lightColors = useAppearance().honeycombColors;
  const systemReduced = useReducedMotion();
  const appReduced = useAppearance().reducedMotion;
  const still = systemReduced || appReduced;

  const cubes = OwnersBox;
  const r = Math.min(200, Math.max(70, 0.12 * Math.max(width, height)));
  const gap = Math.max(3, r * 0.045);
  // The plate sheet is one tile period bigger than the screen (flat-top:
  // 3r across, √3·r down; point-up cubes: √3·r across, 3r down), so
  // drifting it by exactly one period and jumping back is seamless.
  const periodX = cubes ? SQRT3 * r : 3 * r;
  const periodY = cubes ? 3 * r : SQRT3 * r;
  const sheetW = width + periodX;
  const sheetH = height + periodY;

  const { plates, faces } = useMemo(() => {
    const plate = r - gap / SQRT3;
    const paths: string[] = [];
    const sides: [string, string, string][] = [];
    if (cubes) {
      const colStep = SQRT3 * r;
      const rowStep = 1.5 * r;
      for (let row = -1; row * rowStep < sheetH + r; row++) {
        for (let col = -1; col * colStep < sheetW + r; col++) {
          const x = col * colStep + (row % 2 !== 0 ? colStep / 2 : 0);
          const y = row * rowStep;
          paths.push(hexPath(x, y, plate, Math.PI / 6));
          sides.push(cubeFaces(x, y, plate));
        }
      }
    } else {
      const colStep = 1.5 * r;
      const rowStep = SQRT3 * r;
      for (let col = -1; col * colStep < sheetW + r; col++) {
        for (let row = -1; row * rowStep < sheetH + r; row++) {
          paths.push(hexPath(col * colStep, row * rowStep + (col % 2 !== 0 ? rowStep / 2 : 0), plate));
        }
      }
    }
    return { plates: paths, faces: sides };
  }, [cubes, r, gap, sheetW, sheetH]);

  const lights = useMemo<LightSpec[]>(() => {
    const rand = seeded(11);
    // One light per color; Multi-color brings five, plain three.
    const count = Math.max(3, lightColors.length);
    return Array.from({ length: count }, () => ({
      size: r * (2.2 + rand()),
      ax: width * (0.3 + 0.25 * rand()),
      ay: height * (0.3 + 0.25 * rand()),
      kx: 2 + Math.floor(rand() * 3),
      ky: 2 + Math.floor(rand() * 3),
      kp: 12 + Math.floor(rand() * 8),
      px: rand() * Math.PI * 2,
      py: rand() * Math.PI * 2,
      pp: rand() * Math.PI * 2,
    }));
  }, [r, width, height, lightColors.length]);

  const clock = useSharedValue(0);
  const drift = useSharedValue(0);
  useEffect(() => {
    if (still) {
      clock.value = 0;
      drift.value = 0;
      return;
    }
    clock.value = withRepeat(withTiming(1, { duration: CLOCK_MS, easing: Easing.linear }), -1, false);
    drift.value = 0;
    drift.value = withRepeat(
      withTiming(1, { duration: (Math.max(periodX, periodY) / DRIFT_PX_PER_S) * 1000, easing: Easing.linear }),
      -1,
      false,
    );
  }, [still, periodX, periodY, clock, drift]);
  const driftStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -drift.value * periodX }, { translateY: -drift.value * periodY }],
  }));

  // Settings > Appearance > Background: off.
  if (!color) return <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.bg]} />;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.bg]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: color, opacity: AMBIENT }]} />
      {lights.map((spec, i) => (
        <Light key={i} spec={spec} clock={clock} cx={width * 0.5} cy={height * 0.4} color={lightColors[i % lightColors.length]} />
      ))}
      <Animated.View style={[styles.sheet, { width: sheetW, height: sheetH }, driftStyle]}>
        {/* The plates never change, so iOS can keep them as one cached bitmap. */}
        <View shouldRasterizeIOS renderToHardwareTextureAndroid style={StyleSheet.absoluteFill}>
          <Svg width={sheetW} height={sheetH}>
            <Defs>
              {/* Flat charcoal, see-through over the outer quarter so a
                  bright edge washes onto the plate beside it. */}
              <RadialGradient id="plate" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor="#131317" stopOpacity={1} />
                <Stop offset="0.62" stopColor="#101013" stopOpacity={1} />
                <Stop offset="0.8" stopColor="#0d0d10" stopOpacity={0.9} />
                <Stop offset="0.93" stopColor="#0b0b0d" stopOpacity={0.6} />
                <Stop offset="1" stopColor="#0a0a0c" stopOpacity={0.3} />
              </RadialGradient>
              <LinearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#ffffff" stopOpacity={0.035} />
                <Stop offset="0.5" stopColor="#ffffff" stopOpacity={0} />
              </LinearGradient>
            </Defs>
            {plates.map((d, i) => (
              <Path key={i} d={d} fill="url(#plate)" />
            ))}
            {cubes
              ? faces.map(([lid, left, right], i) => (
                  <G key={`f${i}`}>
                    <Path d={lid} fill="#ffffff" fillOpacity={0.05} />
                    <Path d={left} fill="#000000" fillOpacity={0.22} />
                    <Path d={right} fill="#000000" fillOpacity={0.45} />
                    {/* The lid's front edges catch a little light. */}
                    <Path d={lid} fill="none" stroke="#ffffff" strokeOpacity={0.06} strokeWidth={1} />
                  </G>
                ))
              : plates.map((d, i) => <Path key={`s${i}`} d={d} fill="url(#sheen)" />)}
          </Svg>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { backgroundColor: Colors.bg, overflow: 'hidden' },
  light: { position: 'absolute', left: 0, top: 0 },
  sheet: { position: 'absolute', left: 0, top: 0 },
});
