import { StyleSheet, View } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

import { Text } from '@/components/Text';
import { Colors } from '@/constants/theme';
import { positionColor } from '@/lib/positionColors';

// Small pieces the War Room pages share (2026-10-28, the approved
// "Draft Room & Keepers Reimagined" mockups): the colored position tag,
// a hexagon chip like the Lounge's camera frames, and the "chance he's
// still there" bar.

export function posLabel(position: string | null | undefined): string {
  return position === 'DEF' ? 'D/ST' : (position ?? '—');
}

export function PosTag({ position }: { position: string | null | undefined }) {
  return (
    <View style={[styles.pos, { backgroundColor: positionColor(position ?? null) }]}>
      <Text style={styles.posText}>{posLabel(position)}</Text>
    </View>
  );
}

const HEX = '25,3 75,3 100,50 75,97 25,97 0,50';

/** A flat-top hexagon with initials, filled when `on`. */
export function HexChip({ label, on, width = 28 }: { label: string; on: boolean; width?: number }) {
  const height = Math.round(width * 0.88);
  return (
    <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={width} height={height} viewBox="0 0 100 100" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
        <Polygon points={HEX} fill={on ? Colors.accent : Colors.tile} stroke={on ? Colors.accent : Colors.border} strokeWidth={4} />
      </Svg>
      <Text style={[styles.hexText, { color: on ? '#0d1016' : Colors.textSecondary }]} maxFontSizeMultiplier={1}>
        {label}
      </Text>
    </View>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? parts[0]?.[1] ?? '')).toUpperCase();
}

export function chanceColor(chance: number): string {
  if (chance >= 0.75) return Colors.accent;
  if (chance >= 0.5) return '#facc15';
  return '#fb923c';
}

export function ChanceBar({ chance }: { chance: number }) {
  const color = chanceColor(chance);
  return (
    <View style={styles.chanceRow} accessible accessibilityLabel={`${Math.round(chance * 100)} percent chance he's still there`}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(chance * 100)}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.chanceText, { color }]}>{Math.round(chance * 100)}% he&apos;s there</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pos: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, minWidth: 30, alignItems: 'center' },
  posText: { color: '#0d1016', fontSize: 11, fontWeight: '800' },
  hexText: { fontSize: 9, fontWeight: '800' },
  chanceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { flex: 1, height: 8, borderRadius: 4, backgroundColor: Colors.tile, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  chanceText: { fontSize: 13, fontWeight: '700', minWidth: 104 },
});
