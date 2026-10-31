import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

import { Text } from '@/components/Text';
import { haptics } from '@/lib/haptics';

// The elite pass's shared kit (2026-10-31, canvas "Elite League Pages"):
// the Hive Mark's look — dark glass, green neon cells, one cell lit
// orange — for Chug, Awards, the League sections and the matchup page.
// Fixed brand colors like the Wheel and the Hive Builder, not the theme
// accent, so every league's pages read as the same product.
export const Elite = {
  green: '#39ff14',
  mint: '#9dff86',
  orange: '#ff7a1a',
  peach: '#ffb27a',
  cream: '#f5f4ec',
  blue: '#7dd3fc',
  card: '#141a22',
  cell: '#10151c',
  deep: '#07090c',
  line: 'rgba(255,255,255,0.07)',
  soft: 'rgba(245,244,236,0.65)',
  faint: 'rgba(245,244,236,0.5)',
  grey: 'rgba(245,244,236,0.4)',
} as const;

export const ANTON = 'Anton_400Regular';
export const SATISFY = 'Satisfy_400Regular';

// A pointy-top hexagon `w` wide and `h` tall, pulled in by `inset` and
// moved by `offset` (room for a glow around it).
export function hexPoints(w: number, h: number, inset = 0, offset = 0): string {
  const i = inset;
  return [
    [w / 2, i],
    [w - i, h / 4 + i / 2],
    [w - i, (3 * h) / 4 - i / 2],
    [w / 2, h - i],
    [i, (3 * h) / 4 - i / 2],
    [i, h / 4 + i / 2],
  ]
    .map(([x, y]) => `${(x + offset).toFixed(1)},${(y + offset).toFixed(1)}`)
    .join(' ');
}

export const HEX_RATIO = 1.1547;

/** One honeycomb cell with its content centered: `color` is the rim,
 *  `fill` the glass, `glow` a soft halo of the rim's color. */
export function Hex({
  width,
  color,
  fill = Elite.cell,
  glow = false,
  strokeWidth = 2,
  style,
  children,
}: {
  width: number;
  color: string;
  fill?: string;
  glow?: boolean;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const h = width * HEX_RATIO;
  const pad = glow ? 9 : 2;
  const points = hexPoints(width, h, strokeWidth / 2 + 0.5, pad);
  return (
    <View style={[{ width, height: h, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Svg width={width + 2 * pad} height={h + 2 * pad} style={{ position: 'absolute', left: -pad, top: -pad }} pointerEvents="none">
        {glow && (
          <>
            <Polygon points={points} fill="none" stroke={color} strokeWidth={14} strokeOpacity={0.12} strokeLinejoin="round" />
            <Polygon points={points} fill="none" stroke={color} strokeWidth={7} strokeOpacity={0.25} strokeLinejoin="round" />
          </>
        )}
        <Polygon points={points} fill={fill} stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      </Svg>
      {children}
    </View>
  );
}

/** Rows of `wide` and `wide - 1` cells, each short row tucked into the
 *  gaps of the rows around it. */
export function Honeycomb({ cell, wide = 4, gap = 6, children }: { cell: number; wide?: number; gap?: number; children: ReactNode[] }) {
  const h = cell * HEX_RATIO;
  const rows: ReactNode[][] = [];
  let i = 0;
  while (i < children.length) {
    const n = rows.length % 2 === 0 ? wide : wide - 1;
    rows.push(children.slice(i, i + n));
    i += n;
  }
  return (
    <View style={styles.honeycomb}>
      {rows.map((row, r) => (
        <View key={r} style={[styles.honeyRow, { gap, marginTop: r === 0 ? 0 : -h / 4 + gap }]}>
          {row}
        </View>
      ))}
    </View>
  );
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

/** The pages' heading: an orange script kicker over a green neon title. */
export function EliteTitle({ kicker, title, subtitle }: { kicker?: string | null; title: string; subtitle?: string | null }) {
  return (
    <View style={styles.titleBlock}>
      {kicker ? <Text style={styles.kicker}>{kicker}</Text> : null}
      <Text style={styles.title} accessibilityRole="header">
        {title.toUpperCase()}
      </Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

/** A section label in Anton. */
export function EliteLabel({ children, color = Elite.cream }: { children: ReactNode; color?: string }) {
  return (
    <Text style={[styles.label, { color }]} accessibilityRole="header">
      {children}
    </Text>
  );
}

// The season chips (SeasonTabs' props), green when picked.
export function EliteChips(props: {
  seasons: number[];
  active: number | null;
  onSelect: (season: number) => void;
  extra?: { label: string; active: boolean; onPress: () => void };
}) {
  const chip = (key: string, label: string, active: boolean, onPress: () => void) => (
    <Pressable
      key={key}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.chip, active && styles.chipOn]}>
      <Text style={[styles.chipText, active && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {props.seasons.map((s) => chip(String(s), String(s), s === props.active && !props.extra?.active, () => props.onSelect(s)))}
      {props.extra && chip('extra', props.extra.label, props.extra.active, props.extra.onPress)}
    </ScrollView>
  );
}

// The segmented control (Segmented's props), the picked one lit green.
export function EliteSegmented<T extends string>(props: { options: { key: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.segmented}>
      {props.options.map((o) => {
        const on = props.value === o.key;
        return (
          <Pressable
            key={o.key}
            onPress={() => {
              haptics.select();
              props.onChange(o.key);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[styles.segment, on && styles.segmentOn]}>
            <Text style={[styles.segmentText, on && styles.segmentTextOn]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A glass card: plain, `green` (lit), `orange` (the hero) or `deep`
 *  (the black LED plates). */
export function EliteCard({ tone = 'plain', style, children }: { tone?: 'plain' | 'green' | 'orange' | 'deep'; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return <View style={[styles.card, tone !== 'plain' && styles[tone], style]}>{children}</View>;
}

/** A small stat tile: a big Anton value over a caption. */
export function StatTile({ value, caption, color = Elite.cream, borderColor }: { value: string; caption: string; color?: string; borderColor?: string }) {
  return (
    <View style={[styles.tile, borderColor ? { borderColor } : null]}>
      <Text style={[styles.tileValue, { color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
        {value}
      </Text>
      <Text style={styles.tileCaption}>{caption}</Text>
    </View>
  );
}

/** A tug-of-war bar for two win chances (0–100), with a hex marker where
 *  they meet. */
export function EliteWinBar({
  left,
  right,
  leftColor,
  rightColor,
  leftLabel,
  rightLabel,
}: {
  left: number;
  right: number;
  leftColor: string;
  rightColor: string;
  leftLabel?: string;
  rightLabel?: string;
}) {
  const total = left + right || 1;
  const pct = Math.max(2, Math.min(98, (left / total) * 100));
  return (
    <View accessible accessibilityLabel={`Win chance ${Math.round(left)} percent to ${Math.round(right)} percent`}>
      <View style={styles.winTrack}>
        <View style={[styles.winBar, { width: `${pct}%`, backgroundColor: leftColor }]} />
        <View style={[styles.winBarRest, { backgroundColor: rightColor }]} />
        <View style={[styles.winKnot, { left: `${pct}%` }]}>
          <Hex width={16} color={Elite.cream} fill={Elite.cream} strokeWidth={1} />
        </View>
      </View>
      <View style={styles.winLabels}>
        <Text style={[styles.winLabel, { color: left >= right ? leftColor : Elite.soft }]}>{leftLabel ?? `${Math.round(left)}%`}</Text>
        <Text style={[styles.winLabel, { color: right > left ? rightColor : Elite.soft }]}>{rightLabel ?? `${Math.round(right)}%`}</Text>
      </View>
    </View>
  );
}

export type PodiumEntry = { key: string; name: string; value: string; context?: string; onPress?: () => void };

const PODIUM = [
  { place: 1, width: 50, fill: '#c9d1d9', color: '#e5e7eb' },
  { place: 0, width: 62, fill: Elite.orange, color: Elite.peach },
  { place: 2, width: 50, fill: '#b9875a', color: '#d6a77a' },
] as const;

/** A leaderboard as a podium: silver, gold (raised, lit) and bronze
 *  cells, then the rest as a short list. */
export function PodiumBoard({ title, description, entries, emptyMessage }: { title: string; description?: string; entries: PodiumEntry[]; emptyMessage?: string }) {
  const spots = PODIUM.filter((p) => entries[p.place]);
  return (
    <EliteCard style={styles.board}>
      <View>
        <EliteLabel>{title.toUpperCase()}</EliteLabel>
        {description ? <Text style={eliteText.small}>{description}</Text> : null}
      </View>
      {entries.length === 0 ? (
        <Text style={eliteText.small}>{emptyMessage ?? 'No data yet.'}</Text>
      ) : (
        <View style={styles.podium}>
          {spots.map((p) => {
            const e = entries[p.place];
            return (
              <Pressable key={e.key} disabled={!e.onPress} onPress={e.onPress} style={styles.podiumSpot} accessibilityRole="button" accessibilityLabel={`${p.place + 1}. ${e.name}, ${e.value}`}>
                <Hex width={p.width} color={p.color} fill={p.fill} glow={p.place === 0}>
                  <Text style={[styles.podiumPlace, { fontSize: p.place === 0 ? 26 : 20 }]}>{p.place + 1}</Text>
                </Hex>
                <Text style={styles.podiumName} numberOfLines={2}>
                  {e.name}
                </Text>
                <Text style={styles.podiumValue}>{e.value}</Text>
                {e.context ? (
                  <Text style={styles.podiumContext} numberOfLines={3}>
                    {e.context}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}
      {entries.slice(3).map((e, i) => (
        <Pressable key={e.key} disabled={!e.onPress} onPress={e.onPress} style={styles.boardRest}>
          <Text style={[eliteText.small, styles.flexShrink]}>
            {i + 4}. {e.name}
          </Text>
          <Text style={eliteText.small}>{e.value}</Text>
        </Pressable>
      ))}
    </EliteCard>
  );
}

export const eliteText = StyleSheet.create({
  kickerCaps: { color: Elite.soft, fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  body: { color: 'rgba(245,244,236,0.85)', fontSize: 14, lineHeight: 21 },
  small: { color: Elite.soft, fontSize: 12, lineHeight: 17 },
  name: { color: Elite.cream, fontSize: 15, fontWeight: '700' },
  link: { color: Elite.green, fontSize: 13, fontWeight: '600' },
  anton: { fontFamily: ANTON, color: Elite.cream },
  script: { fontFamily: SATISFY, color: '#ffd0a0' },
});

const styles = StyleSheet.create({
  honeycomb: { alignItems: 'center', paddingVertical: 4 },
  honeyRow: { flexDirection: 'row', justifyContent: 'center' },
  titleBlock: { alignItems: 'center', gap: 2 },
  kicker: { fontFamily: SATISFY, fontSize: 24, lineHeight: 30, color: Elite.peach, textShadowColor: 'rgba(255,122,26,0.7)', textShadowRadius: 10 },
  title: {
    fontFamily: ANTON,
    fontSize: 38,
    lineHeight: 44,
    letterSpacing: 1,
    textAlign: 'center',
    color: Elite.green,
    textShadowColor: 'rgba(57,255,20,0.8)',
    textShadowRadius: 14,
  },
  subtitle: { color: Elite.soft, fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 4 },
  label: { fontFamily: ANTON, fontSize: 22, lineHeight: 28, letterSpacing: 0.5 },
  chips: { gap: 8 },
  chip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(57,255,20,0.28)', backgroundColor: Elite.cell, justifyContent: 'center' },
  chipOn: { backgroundColor: Elite.green, borderColor: Elite.green, shadowColor: Elite.green, shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  chipText: { color: 'rgba(245,244,236,0.8)', fontSize: 13, fontWeight: '700' },
  chipTextOn: { color: '#06110a' },
  segmented: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: 16, backgroundColor: Elite.card, borderWidth: 1, borderColor: Elite.line },
  segment: { flex: 1, minHeight: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  segmentOn: { backgroundColor: '#0f1a12', borderWidth: 1, borderColor: 'rgba(57,255,20,0.6)', shadowColor: Elite.green, shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  segmentText: { color: Elite.soft, fontSize: 13, fontWeight: '700' },
  segmentTextOn: { color: Elite.green },
  card: { borderRadius: 22, backgroundColor: Elite.card, borderWidth: 1, borderColor: Elite.line, overflow: 'hidden' },
  green: { borderColor: 'rgba(57,255,20,0.4)', shadowColor: Elite.green, shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, overflow: 'visible' },
  orange: { borderWidth: 2, borderColor: Elite.orange, backgroundColor: '#1a140f', shadowColor: Elite.orange, shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, overflow: 'visible' },
  deep: { backgroundColor: Elite.deep, borderColor: 'rgba(255,122,26,0.45)' },
  tile: { flex: 1, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4, borderRadius: 14, backgroundColor: Elite.card, borderWidth: 1, borderColor: Elite.line },
  tileValue: { fontFamily: ANTON, fontSize: 22, lineHeight: 28 },
  tileCaption: { color: Elite.soft, fontSize: 11, textAlign: 'center' },
  winTrack: { height: 10, borderRadius: 5, flexDirection: 'row', marginTop: 8 },
  winBar: { height: 10, borderTopLeftRadius: 5, borderBottomLeftRadius: 5 },
  winBarRest: { flex: 1, height: 10, borderTopRightRadius: 5, borderBottomRightRadius: 5, opacity: 0.35 },
  winKnot: { position: 'absolute', top: -4, marginLeft: -8 },
  winLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  winLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  flexShrink: { flexShrink: 1 },
  board: { padding: 16, gap: 12 },
  podium: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around' },
  podiumSpot: { flex: 1, alignItems: 'center', gap: 4 },
  podiumPlace: { fontFamily: ANTON, color: '#10151c' },
  podiumName: { color: Elite.cream, fontSize: 13, fontWeight: '700', textAlign: 'center', marginTop: 2 },
  podiumValue: { color: Elite.soft, fontSize: 12 },
  podiumContext: { color: Elite.faint, fontSize: 10.5, textAlign: 'center' },
  boardRest: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)' },
});
