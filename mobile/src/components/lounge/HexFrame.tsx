import { memo, useState, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Text } from '@/components/Text';
import { Fonts } from '@/constants/theme';
import { teamGlow, type ScoringHit } from '@/lib/scoringHighlights';

// A Lounge camera tile's honeycomb frame (2026-10-18 "Scoring
// highlights" mockups): a ring of the app's charcoal hex plates
// (HoneycombBackground's look, at tile scale) with light behind them
// that only shows through the seams. At rest the light is a faint grey;
// when someone's score moves (lib/scoringHighlights.ts), it turns the
// colors of the NFL team that did it, primary from one corner and
// secondary from the other, with the points on a frosted chip.

const SQRT3 = Math.sqrt(3);

function hexPoints(cx: number, cy: number, r: number): string {
  let pts = '';
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    pts += `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)} `;
  }
  return pts.trim();
}

/** Flat-top plates covering w×h: each a dark plate with a see-through
 *  rim, so a lit seam washes onto the plates beside it. */
function plates(w: number, h: number, r: number): { rim: string; face: string }[] {
  const gap = Math.max(1.2, r * 0.2);
  const plate = r - gap / SQRT3;
  const out: { rim: string; face: string }[] = [];
  for (let col = -1; col * 1.5 * r < w + r; col++) {
    for (let row = -1; row * SQRT3 * r < h + r; row++) {
      const cx = col * 1.5 * r;
      const cy = row * SQRT3 * r + (col % 2 !== 0 ? (SQRT3 * r) / 2 : 0);
      out.push({ rim: hexPoints(cx, cy, plate), face: hexPoints(cx, cy, plate * 0.8) });
    }
  }
  return out;
}

// The plates never change for a tile's size, so they're drawn once and
// iOS keeps them as one bitmap; the room re-renders every second.
const Plates = memo(function Plates({ width, height, r }: { width: number; height: number; r: number }) {
  const cells = plates(width, height, r);
  return (
    <View shouldRasterizeIOS renderToHardwareTextureAndroid style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#ffffff" stopOpacity={0.08} />
            <Stop offset="0.45" stopColor="#ffffff" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {cells.map((c, i) => (
          <Polygon key={`r${i}`} points={c.rim} fill="#0c0c0f" fillOpacity={0.62} />
        ))}
        {cells.map((c, i) => (
          <Polygon key={`f${i}`} points={c.face} fill="#141418" />
        ))}
        <Rect width={width} height={height} fill="url(#sheen)" />
      </Svg>
    </View>
  );
});

export function HexFrame({
  width,
  height,
  hit,
  fallback,
  rail = false,
  style,
  children,
}: {
  width: number;
  height: number;
  hit: ScoringHit | undefined;
  // The glow for a team we don't know (the app's accent).
  fallback: string;
  // The full-screen rail's slimmer tiles: a thinner frame, no play line.
  rail?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const band = rail ? 5 : 7;
  const radius = rail ? 11 : 14;
  // The last hit's colors stay while the light fades back out.
  const [last, setLast] = useState<ScoringHit | undefined>(hit);
  if (hit && hit !== last) setLast(hit);
  const shown = hit ?? last;
  const [c1, c2] = teamGlow(shown?.team ?? null, fallback);
  const loss = !!hit && hit.points < 0;
  const lightStyle = useAnimatedStyle(() => ({ opacity: withTiming(hit ? (loss ? 0.4 : 1) : 0, { duration: 600 }) }));
  const chipStyle = useAnimatedStyle(() => ({ opacity: withTiming(hit ? 1 : 0, { duration: 400 }) }));

  return (
    <View
      style={[
        { width, height, borderRadius: radius },
        hit && !loss && { shadowColor: c1, shadowOpacity: 0.85, shadowRadius: rail ? 9 : 14, shadowOffset: { width: 0, height: 0 } },
        style,
      ]}>
      <View style={[StyleSheet.absoluteFill, styles.clip, { borderRadius: radius }]}>
        <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
          <Defs>
            <RadialGradient id="idle" cx="50%" cy="0%" r="80%">
              <Stop offset="0" stopColor="#96a0b6" stopOpacity={0.22} />
              <Stop offset="1" stopColor="#96a0b6" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width={width} height={height} fill="url(#idle)" />
        </Svg>
        <Animated.View style={[StyleSheet.absoluteFill, lightStyle]}>
          <Svg width={width} height={height}>
            <Defs>
              <LinearGradient id="wash" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={c1} stopOpacity={1} />
                <Stop offset="1" stopColor={c2} stopOpacity={1} />
              </LinearGradient>
              <RadialGradient id="first" cx="5%" cy="0%" r="75%">
                <Stop offset="0" stopColor={c1} stopOpacity={1} />
                <Stop offset="1" stopColor={c1} stopOpacity={0} />
              </RadialGradient>
              <RadialGradient id="second" cx="95%" cy="100%" r="75%">
                <Stop offset="0" stopColor={c2} stopOpacity={1} />
                <Stop offset="1" stopColor={c2} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect width={width} height={height} fill="url(#wash)" />
            <Rect width={width} height={height} fill="url(#first)" />
            <Rect width={width} height={height} fill="url(#second)" />
          </Svg>
        </Animated.View>
        <Plates width={width} height={height} r={rail ? 6.5 : 8} />
      </View>

      <View style={[styles.inner, { top: band, left: band, right: band, bottom: band, borderRadius: radius - Math.round(band * 0.55) }]}>
        {children}
        <Animated.View style={[styles.chip, rail && styles.chipRail, { borderColor: loss ? 'rgba(248,113,113,0.55)' : c1 }, chipStyle]} pointerEvents="none">
          <View style={[styles.stripe, rail && styles.stripeRail]}>
            <View style={[styles.stripeHalf, { backgroundColor: c1 }]} />
            <View style={[styles.stripeHalf, { backgroundColor: c2 }]} />
          </View>
          <Text style={[styles.points, rail && styles.pointsRail, loss && styles.pointsLoss]} maxFontSizeMultiplier={1.1}>
            {shown ? `${shown.points >= 0 ? '+' : '−'}${Math.abs(shown.points).toFixed(1)}` : ''}
          </Text>
        </Animated.View>
        {!rail && (
          <Animated.Text
            style={[styles.play, { textShadowColor: c1 }, chipStyle]}
            numberOfLines={1}
            maxFontSizeMultiplier={1.1}
            pointerEvents="none">
            {shown?.play.toUpperCase() ?? ''}
          </Animated.Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden', backgroundColor: '#07080b' },
  inner: { position: 'absolute', overflow: 'hidden', backgroundColor: '#0c0e13', borderWidth: 1, borderColor: 'rgba(0,0,0,0.85)' },
  chip: {
    position: 'absolute',
    top: 6,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 22,
    paddingLeft: 5,
    paddingRight: 7,
    borderRadius: 7,
    borderWidth: 1,
    backgroundColor: 'rgba(8,10,14,0.8)',
  },
  chipRail: { top: 4, right: 4, height: 18, gap: 4, paddingLeft: 4, paddingRight: 5 },
  stripe: { width: 4, height: 12, borderRadius: 2, overflow: 'hidden' },
  stripeRail: { height: 10 },
  stripeHalf: { flex: 1 },
  points: { color: '#fff', fontFamily: Fonts.monoBold, fontSize: 13 },
  pointsRail: { fontSize: 11 },
  pointsLoss: { color: '#ff8a9a' },
  play: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    maxWidth: '55%',
    color: '#fff',
    fontFamily: Fonts.display,
    fontSize: 10,
    letterSpacing: 0.8,
    textShadowRadius: 8,
    textShadowOffset: { width: 0, height: 0 },
  },
});
