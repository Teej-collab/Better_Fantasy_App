import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, View, useWindowDimensions, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Defs, Ellipse, LinearGradient as SvgLinear, Path, Polygon, RadialGradient, Stop } from 'react-native-svg';

import { Text } from '@/components/Text';
import { Fonts } from '@/constants/theme';
import { haptics } from '@/lib/haptics';

import { WORDMARK_PATHS, WORDMARK_VIEWBOX } from './wordmark';

// The Owners Box look (Settings > Look > Owners Box, 2026-11-17): the
// suite at night. One floodlight rising from the open box on each screen,
// smoked-glass panels, scoreboard numbers, and green only ever as light.
// Approved from the "Owners Box Prototype" artifact.
export const OB = {
  void: '#060708',
  night: '#0b0d10',
  glass: 'rgba(255,255,255,0.034)',
  glass2: 'rgba(255,255,255,0.06)',
  rim: 'rgba(255,255,255,0.075)',
  rim2: 'rgba(255,255,255,0.13)',
  ink: '#f2f3ee',
  ink2: '#c8ccd2',
  mute: '#808894',
  dim: '#4b525c',
  lamp: '#39ff14',
  lampHi: '#d4ffc6',
  live: '#ff4d4d',
  warn: '#ffcf7a',
  display: 'BigShoulders_800ExtraBold',
  displayBlack: 'BigShoulders_900Black',
} as const;

/** A smoked-glass panel. `lit` is the one panel on a screen that matters:
 *  a green edge of light along its top and a glow falling from it. */
export function ObPane({
  lit = false,
  style,
  contentStyle,
  radius = 22,
  onPress,
  label,
  children,
}: {
  lit?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  radius?: number;
  onPress?: () => void;
  label?: string;
  children: ReactNode;
}) {
  const body = (
    <View style={[styles.pane, { borderRadius: radius }, lit && styles.paneLit, onPress ? null : style]}>
      <LinearGradient
        pointerEvents="none"
        colors={lit ? ['rgba(57,255,20,0.13)', 'rgba(57,255,20,0)'] : ['rgba(255,255,255,0.035)', 'rgba(255,255,255,0)']}
        locations={[0, 0.55]}
        style={StyleSheet.absoluteFill}
      />
      {lit && <LitEdge />}
      <View style={[styles.paneBody, contentStyle]}>{children}</View>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [style, pressed && styles.pressed]}>
      {body}
    </Pressable>
  );
}

// The light running along a lit panel's top edge.
function LitEdge() {
  const reduce = useReducedMotion();
  const x = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    x.value = withRepeat(withSequence(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 2600, easing: Easing.inOut(Easing.quad) })), -1);
  }, [reduce, x]);
  const move = useAnimatedStyle(() => ({ left: `${10 + x.value * 40}%` }));
  return (
    <Animated.View pointerEvents="none" style={[styles.edge, move]}>
      <LinearGradient colors={['rgba(57,255,20,0)', OB.lamp, 'rgba(57,255,20,0)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}

/** The lit look as a layer, for a card that lays out its own children
 *  (the elite cards): the green wash and the light along the top. */
export function ObLitLayer() {
  return (
    <>
      <LinearGradient pointerEvents="none" colors={['rgba(57,255,20,0.13)', 'rgba(57,255,20,0)']} locations={[0, 0.55]} style={StyleSheet.absoluteFill} />
      <LitEdge />
    </>
  );
}

/** The honeycomb cell, Owners Box style: a box open at the top, its edge
 *  lit. Holds a picture (an owner) or anything else, with an optional
 *  rank or seed on its bottom edge. */
export function ObCell({
  width,
  color,
  fill,
  image,
  badge,
  style,
  children,
}: {
  width: number;
  color?: string;
  fill?: string;
  image?: string | null;
  badge?: string | number | null;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const r = Math.round(width * 0.24);
  // Green, or the elite kit's "yours" color (white in Owners Box), lights the box.
  const lit = color === OB.lamp || color === '#39ff14' || color === OB.ink;
  const solid = fill && fill !== OB.night && !fill.startsWith('#10') && !fill.startsWith('#0');
  return (
    <View style={[{ width, height: width }, style]}>
      <View style={[styles.cell, { borderRadius: r }, lit && styles.cellLit, solid ? { backgroundColor: OB.ink, borderColor: OB.ink, borderTopColor: 'transparent' } : null]}>
        {image ? <Image source={{ uri: image }} style={[StyleSheet.absoluteFill, { borderRadius: r - 1 }]} resizeMode="cover" /> : null}
        <View style={[styles.boxLamp, { left: r * 0.5, right: r * 0.5 }, !lit && !solid && styles.cellLampQuiet]} />
        {image ? null : children}
      </View>
      {badge !== undefined && badge !== null && (
        <View style={styles.cellBadge}>
          <Text style={styles.cellBadgeText}>{badge}</Text>
        </View>
      )}
    </View>
  );
}

/** A player in an open box: his headshot over a faint team logo. */
export function ObPortrait({ width, headshot, logo, color }: { width: number; headshot?: string | null; logo?: string | null; color?: string }) {
  const r = Math.round(width * 0.24);
  const lit = color === OB.lamp || color === '#39ff14';
  return (
    <View style={[styles.cell, { width, height: width, borderRadius: r, overflow: 'hidden' }, lit && styles.cellLit]}>
      {logo ? <Image source={{ uri: logo }} style={{ position: 'absolute', width: width * 0.9, height: width * 0.9, opacity: headshot ? 0.18 : 1 }} resizeMode="contain" /> : null}
      {headshot ? <Image source={{ uri: headshot }} style={{ position: 'absolute', bottom: 0, width: width * 1.25, height: width * 0.92 }} resizeMode="contain" /> : null}
      <View style={[styles.boxLamp, { left: r * 0.5, right: r * 0.5 }, !lit && styles.cellLampQuiet]} />
    </View>
  );
}

/** The floodlight behind a screen: a cone of green light from the top
 *  center, slowly breathing. Replaces the honeycomb. */
export function Floodlight({ soft = false }: { soft?: boolean }) {
  const { width } = useWindowDimensions();
  const reduce = useReducedMotion();
  const o = useSharedValue(1);
  useEffect(() => {
    if (reduce) return;
    o.value = withRepeat(withSequence(withTiming(0.75, { duration: 4000 }), withTiming(1, { duration: 4000 })), -1);
  }, [reduce, o]);
  const breathe = useAnimatedStyle(() => ({ opacity: o.value * (soft ? 0.55 : 1) }));
  const w = width;
  const h = 560;
  const c = w / 2;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: OB.night }]}>
      <Animated.View style={[styles.flood, breathe]}>
        <Svg width={w} height={h}>
          <Defs>
            <SvgLinear id="cone" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={OB.lamp} stopOpacity={0.16} />
              <Stop offset="0.75" stopColor={OB.lamp} stopOpacity={0} />
            </SvgLinear>
            <RadialGradient id="halo" cx="50%" cy="0%" rx="65%" ry="70%">
              <Stop offset="0" stopColor={OB.lamp} stopOpacity={0.12} />
              <Stop offset="1" stopColor={OB.lamp} stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id="hot" cx="50%" cy="0%" rx="50%" ry="100%">
              <Stop offset="0" stopColor={OB.lampHi} stopOpacity={0.45} />
              <Stop offset="1" stopColor={OB.lampHi} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Ellipse cx={c} cy={0} rx={w * 0.75} ry={h * 0.8} fill="url(#halo)" />
          <Polygon points={`${c - 36},0 ${c + 36},0 ${c + w * 0.42},${h} ${c - w * 0.42},${h}`} fill="url(#cone)" />
          <Ellipse cx={c} cy={0} rx={90} ry={34} fill="url(#hot)" />
        </Svg>
      </Animated.View>
    </View>
  );
}

/** A rank or seed in an open box: the top edge open and lit. Yours is
 *  solid white. */
export function OpenBox({ n, mine = false, off = false, size = 30 }: { n: string | number; mine?: boolean; off?: boolean; size?: number }) {
  const r = Math.round(size * 0.22);
  return (
    <View style={[styles.box, { width: size, height: size, borderRadius: r }, mine && styles.boxMine]}>
      <View style={[styles.boxLamp, { left: r * 0.5, right: r * 0.5 }, off && styles.boxLampOff]} />
      <Text style={[styles.boxText, { fontSize: size * 0.54, color: mine ? OB.void : OB.ink }]} numberOfLines={1} adjustsFontSizeToFit>
        {n}
      </Text>
    </View>
  );
}

export function LiveDot({ color = OB.live, size = 7 }: { color?: string; size?: number }) {
  const reduce = useReducedMotion();
  const s = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    s.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }), -1);
  }, [reduce, s]);
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: 1 + s.value * 1.6 }], opacity: 0.55 * (1 - s.value) }));
  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: size / 2, backgroundColor: color }, ring]} />
      <View style={[StyleSheet.absoluteFill, { borderRadius: size / 2, backgroundColor: color }]} />
    </View>
  );
}

/** Small tracked-out mono label: "WEEK 10 · SUNDAY". */
export function Eyebrow({ children, color = OB.mute, live = false, style }: { children: ReactNode; color?: string; live?: boolean; style?: StyleProp<TextStyle> }) {
  const text = (
    <Text style={[styles.eyebrow, { color }, style]} numberOfLines={1}>
      {typeof children === 'string' ? children.toUpperCase() : children}
    </Text>
  );
  if (!live) return text;
  return (
    <View style={styles.eyebrowRow}>
      <LiveDot />
      {text}
    </View>
  );
}

/** A section's label with a hairline running off it, and an optional
 *  link on the right. */
export function SectionHead({ label, link, onLink }: { label: string; link?: string; onLink?: () => void }) {
  return (
    <View style={styles.secHead}>
      <Text style={styles.secLabel} numberOfLines={1}>
        {label.toUpperCase()}
      </Text>
      <LinearGradient colors={[OB.rim2, 'rgba(255,255,255,0)']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.secRule} />
      {link ? (
        <Pressable
          hitSlop={8}
          onPress={() => {
            haptics.tap();
            onLink?.();
          }}
          accessibilityRole="link">
          <Text style={styles.secLink}>{link} ›</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A screen's big uppercase title over its eyebrow. */
export function ObTitle({ kicker, title, subtitle, align = 'left', live = false }: { kicker?: string | null; title: string; subtitle?: string | null; align?: 'left' | 'center'; live?: boolean }) {
  return (
    <View style={[styles.titleBlock, align === 'center' && styles.center]}>
      {kicker ? <Eyebrow live={live} color={live ? OB.mute : OB.lamp}>{kicker}</Eyebrow> : null}
      <Text style={[styles.title, align === 'center' && styles.textCenter]} accessibilityRole="header">
        {title.toUpperCase()}
      </Text>
      {subtitle ? <Text style={[styles.subtitle, align === 'center' && styles.textCenter]}>{subtitle}</Text> : null}
    </View>
  );
}

/** A win-chance bar: green light filling a dark track, a bright head where it ends. */
export function ObWinBar({ percent, height = 4 }: { percent: number; height?: number }) {
  const p = Math.max(2, Math.min(100, percent));
  return (
    <View style={[styles.track, { height, borderRadius: height }]} accessibilityLabel={`${Math.round(percent)} percent to win`}>
      <LinearGradient colors={['rgba(57,255,20,0.25)', OB.lamp]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={[styles.fill, { width: `${p}%`, borderRadius: height }]} />
      <View style={[styles.head, { left: `${p}%`, width: height + 6, height: height + 6, marginLeft: -(height + 6) / 2, marginTop: -(height + 6) / 2, borderRadius: height + 6 }]} />
    </View>
  );
}

export function Wordmark({ width = 92, color = OB.ink }: { width?: number; color?: string }) {
  const [, , vw, vh] = WORDMARK_VIEWBOX.split(' ').map(Number);
  return (
    <Svg width={width} height={(width * vh) / vw} viewBox={WORDMARK_VIEWBOX} accessibilityLabel="Owners Box">
      {WORDMARK_PATHS.map((d, i) => (
        <Path key={i} d={d} fill={color} />
      ))}
    </Svg>
  );
}

/** The open box itself, lid lifted and light inside. */
export function Cube({ width = 30 }: { width?: number }) {
  return (
    <Svg width={width} height={width * 1.5} viewBox="-104 -112 208 312">
      <Defs>
        <SvgLinear id="hole" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#f2ffe9" />
          <Stop offset="0.6" stopColor={OB.lamp} />
          <Stop offset="1" stopColor="#1f9a0a" />
        </SvgLinear>
      </Defs>
      <Polygon points="-90,42 0,84 0,184 -90,142" fill="#1b2027" stroke="#fff" strokeWidth={9} strokeLinejoin="round" />
      <Polygon points="0,84 90,42 90,142 0,184" fill="#0e1115" stroke="#fff" strokeWidth={9} strokeLinejoin="round" />
      <Polygon points="0,0 90,42 0,84 -90,42" fill="#2a2f37" stroke="#fff" strokeWidth={9} strokeLinejoin="round" />
      <Polygon points="0,7 76,42 0,77 -76,42" fill="url(#hole)" />
      <Polygon points="0,0 90,42 0,84 -90,42" fill="#1a1e25" stroke="#fff" strokeWidth={9} strokeLinejoin="round" transform="translate(6,-78) rotate(-10 0 42)" />
    </Svg>
  );
}

export const obText = StyleSheet.create({
  num: { fontFamily: OB.display, color: OB.ink, fontVariant: ['tabular-nums'] },
  mono: { fontFamily: Fonts.mono, color: OB.mute, fontSize: 11 },
  name: { fontFamily: Fonts.bodySemiBold, color: OB.ink, fontSize: 14 },
  body: { color: OB.ink2, fontSize: 13.5, lineHeight: 20 },
});

const styles = StyleSheet.create({
  pane: { overflow: 'hidden', backgroundColor: OB.glass, borderWidth: 1, borderColor: OB.rim },
  paneLit: { borderColor: 'rgba(57,255,20,0.2)', backgroundColor: 'rgba(255,255,255,0.045)' },
  paneBody: { padding: 16 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
  edge: { position: 'absolute', top: 0, height: 1.5, width: '50%' },
  flood: { position: 'absolute', top: -20, left: 0, right: 0, alignItems: 'center' },
  box: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.22)', borderTopColor: 'transparent' },
  boxMine: { backgroundColor: OB.ink, borderColor: OB.ink, borderTopColor: 'transparent' },
  boxLamp: { position: 'absolute', top: -1.5, height: 1.5, backgroundColor: OB.lamp, shadowColor: OB.lamp, shadowOpacity: 0.9, shadowRadius: 5, shadowOffset: { width: 0, height: -2 } },
  boxLampOff: { backgroundColor: OB.dim, shadowOpacity: 0 },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.035)', borderWidth: 1.5, borderColor: OB.rim2, borderTopColor: 'transparent' },
  cellLit: { borderColor: 'rgba(57,255,20,0.45)', borderTopColor: 'transparent', backgroundColor: 'rgba(57,255,20,0.06)' },
  cellLampQuiet: { backgroundColor: 'rgba(255,255,255,0.35)', shadowOpacity: 0 },
  cellBadge: { position: 'absolute', bottom: -6, alignSelf: 'center', minWidth: 22, paddingHorizontal: 5, borderRadius: 8, backgroundColor: OB.void, borderWidth: 1, borderColor: OB.rim2, alignItems: 'center' },
  cellBadgeText: { fontFamily: OB.display, fontSize: 12, lineHeight: 16, color: OB.ink },
  boxText: { fontFamily: OB.display, textAlign: 'center' },
  eyebrow: { fontFamily: Fonts.mono, fontSize: 10.5, letterSpacing: 1.6 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  secHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  secLabel: { fontFamily: Fonts.mono, fontSize: 10.5, letterSpacing: 1.6, color: OB.mute, flexShrink: 0 },
  secRule: { flex: 1, height: 1 },
  secLink: { color: OB.ink2, fontSize: 12.5, fontFamily: Fonts.bodyMedium },
  titleBlock: { gap: 6 },
  center: { alignItems: 'center' },
  textCenter: { textAlign: 'center' },
  title: { fontFamily: OB.displayBlack, fontSize: 44, lineHeight: 42, color: OB.ink, letterSpacing: 0.2, paddingTop: 4 },
  subtitle: { color: OB.ink2, fontSize: 13.5, lineHeight: 19 },
  track: { backgroundColor: 'rgba(255,255,255,0.08)', justifyContent: 'center' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  head: { position: 'absolute', top: '50%', backgroundColor: OB.lampHi, shadowColor: OB.lamp, shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
});
