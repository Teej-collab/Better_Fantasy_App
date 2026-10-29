import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { ClipPath, Defs, Path, Pattern, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';

import { seasonalEmblem } from '@/lib/seasonal';

// The Lounge's cameras as a honeycomb (2026-10-29 "Lounge Camera Ring"
// mockups): interlocking hexagons with the banner plate — the logo on the
// brand green and white honeycomb — in the middle of the top row, so
// everyone in the room is on screen at once instead of in a sideways
// scroll. Two rows while the cells can stay a good size, three for a big
// room. Each camera is a rectangle whose corners are painted over in the
// room's background (HexMask): live video can't be clipped to a hexagon
// without a native module, and this looks the same.

export const HIVE_BG = '#0b0d14';
const GAP = 6;
const MAX_CELL = 84;
const MIN_CELL = 60;
const PAD = 10;

function hexPoints(w: number, h: number, inset = 0): string {
  const i = inset;
  return [
    [w / 2, i],
    [w - i, h / 4 + i / 2],
    [w - i, (3 * h) / 4 - i / 2],
    [w / 2, h - i],
    [i, (3 * h) / 4 - i / 2],
    [i, h / 4 + i / 2],
  ]
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
}

type Cell = { x: number; y: number };

export function hiveLayout(people: number, width: number) {
  const cells = people + 1;
  // One row for a small room; otherwise as few rows as keep the cells
  // a good size. Offset rows stick out half a cell, so leave room for it.
  let rows = cells <= 4 ? 1 : 2;
  let size = 0;
  for (; rows <= 4; rows++) {
    const perRow = Math.ceil(cells / rows);
    size = rows === 1 ? Math.min(MAX_CELL, (width - (perRow - 1) * GAP) / perRow) : Math.min(MAX_CELL, (width - (perRow - 0.5) * GAP) / (perRow + 0.5));
    if (size >= MIN_CELL || rows === 4) break;
  }
  const perRow = Math.ceil(cells / rows);
  const w = Math.floor(size);
  const h = Math.round(w * 1.1547);
  const step = h * 0.75 + GAP * 0.6;
  const pitch = w + GAP;
  const counts: number[] = [];
  for (let left = cells; left > 0; left -= perRow) counts.push(Math.min(perRow, left));
  // Lattice spots, then the group centered in the width.
  const spots: Cell[] = [];
  counts.forEach((count, r) => {
    for (let k = 0; k < count; k++) spots.push({ x: k * pitch + (r % 2 ? pitch / 2 : 0), y: r * step });
  });
  const minX = Math.min(...spots.map((s) => s.x));
  const maxX = Math.max(...spots.map((s) => s.x)) + w;
  const shift = (width - (maxX - minX)) / 2 - minX;
  const placed = spots.map((s) => ({ x: Math.round(s.x + shift), y: Math.round(s.y) }));
  // The banner takes the middle of the top row; people fill around it.
  const bannerAt = Math.floor(counts[0] / 2);
  const banner = placed[bannerAt];
  const seats = placed.filter((_, i) => i !== bannerAt);
  return { w, h, height: Math.ceil((counts.length - 1) * step + h), banner, seats };
}

export function LoungeHive<T>({ items, keyOf, renderCell }: { items: T[]; keyOf: (item: T) => string; renderCell: (item: T, w: number, h: number) => ReactNode }) {
  const [width, setWidth] = useState(0);
  const layout = width > 0 ? hiveLayout(items.length, width) : null;
  return (
    <View style={styles.wrap} onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width) - 2 * PAD)}>
      {layout && (
        <View style={{ height: layout.height }}>
          <View style={[styles.cell, { left: layout.banner.x, top: layout.banner.y }]}>
            <HiveBanner w={layout.w} h={layout.h} />
          </View>
          {items.map((item, i) => (
            <View key={keyOf(item)} style={[styles.cell, { left: layout.seats[i].x, top: layout.seats[i].y }]}>
              {renderCell(item, layout.w, layout.h)}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/** Paints a cell's corners in the room's background so its content
 *  reads as a hexagon, then draws the hexagon's rim. */
export function HexMask({ w, h, ring, ringWidth = 2 }: { w: number; h: number; ring: string; ringWidth?: number }) {
  const hex = hexPoints(w, h);
  const outline = `M0 0H${w}V${h}H0Z M${hex.split(' ').join(' L')}Z`;
  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Path d={outline} fill={HIVE_BG} fillRule="evenodd" />
      <Polygon points={hexPoints(w, h, ringWidth / 2)} fill="none" stroke={ring} strokeWidth={ringWidth} strokeLinejoin="round" />
    </Svg>
  );
}

/** The banner plate: brand green, white honeycomb, the logo. */
function HiveBanner({ w, h }: { w: number; h: number }) {
  const hex = hexPoints(w, h);
  const logo = Math.round(w * 0.8);
  return (
    <View style={{ width: w, height: h }} accessible accessibilityRole="image" accessibilityLabel="Presented by The Weekend">
      <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="hiveGreen" cx="50%" cy="42%" r="70%">
            <Stop offset="0" stopColor="#7bff5f" />
            <Stop offset="0.46" stopColor="#39ff14" />
            <Stop offset="1" stopColor="#21c40a" />
          </RadialGradient>
          <Pattern id="hiveLines" width={13.86} height={24} patternUnits="userSpaceOnUse">
            <Path d="M6.93 0L13.86 4V12L6.93 16L0 12V4Z M6.93 16V24" fill="none" stroke="rgba(255,255,255,0.62)" strokeWidth={1} />
          </Pattern>
          <ClipPath id="hiveClip">
            <Polygon points={hex} />
          </ClipPath>
        </Defs>
        <Polygon points={hex} fill="url(#hiveGreen)" />
        <Rect width={w} height={h} fill="url(#hiveLines)" clipPath="url(#hiveClip)" />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Image source={seasonalEmblem()} style={{ width: logo, height: logo }} contentFit="contain" />
      </View>
      <HexMask w={w} h={h} ring="#ffffff" ringWidth={2.5} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: PAD, paddingTop: 10, paddingBottom: 6 },
  cell: { position: 'absolute' },
  center: { alignItems: 'center', justifyContent: 'center' },
});
