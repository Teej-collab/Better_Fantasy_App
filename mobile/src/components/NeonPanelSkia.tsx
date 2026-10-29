import { BlurMask, Canvas, Path, Skia, SweepGradient, vec, type SkPath } from '@shopify/react-native-skia';
import { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { Colors } from '@/constants/theme';

// NeonPanel drawn with Skia (build 10 on): the same sweeping segment of
// the ring color, but as light, a crisp line on the card's edge with a
// soft bloom around it that spills past the card the way the web's
// .neon-panel does. Only required where Skia exists (lib/skia.ts).

const RING_WIDTH = 1.5;
// How far the bloom reaches past the card.
const PAD = 14;

type Props = {
  children: ReactNode;
  colors: readonly string[];
  locations: readonly number[];
  // A Multi ring (several colors) rather than one color's traveling light.
  multi: boolean;
  color: string;
  rotation: SharedValue<number>;
  still: boolean;
  glow: number;
  radius: number;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
};

export function NeonPanelSkia({ children, colors, locations, multi, color, rotation, still, glow, radius, style, contentStyle }: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  const { w, h } = size;
  const c = vec(PAD + w / 2, PAD + h / 2);
  const edge = { x: PAD + RING_WIDTH / 2, y: PAD + RING_WIDTH / 2, width: w - RING_WIDTH, height: h - RING_WIDTH, r: radius - RING_WIDTH / 2 };
  const outline = useMemo(() => {
    const p = Skia.Path.Make();
    if (w > 0) p.addRRect(Skia.RRectXY(Skia.XYWHRect(edge.x, edge.y, edge.width, edge.height), edge.r, edge.r));
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, h, radius]);
  const perimeter = w > 0 ? 2 * (edge.width + edge.height) - (8 - 2 * Math.PI) * edge.r : 1;
  // The comet's length as a share of the way round.
  const tail = Math.min(0.22, 220 / perimeter);

  // Where the light's head is, 0–1 of the way round: one lap per turn of
  // the shared clock, at an even speed all the way round (2026-10-29:
  // turning like a clock hand raced it across the corners and short ends).
  const head = useDerivedValue(() => ((still ? 225 : rotation.value) % 360) / 360, [still]);
  const transform = useDerivedValue(() => [{ rotate: (((still ? 225 : rotation.value) - 90) * Math.PI) / 180 }], [still]);

  return (
    <View style={style} onLayout={onLayout}>
      {w > 0 && (
        // Still layer: the ring and its soft glow, drawn once.
        <Canvas pointerEvents="none" style={{ position: 'absolute', left: -PAD, top: -PAD, width: w + PAD * 2, height: h + PAD * 2 }}>
          <Path path={outline} style="stroke" strokeWidth={RING_WIDTH} color={Colors.border} />
          {!multi && (
            <Path path={outline} style="stroke" strokeWidth={4} color={color} opacity={Math.min(0.5, glow)}>
              <BlurMask blur={8} style="normal" />
            </Path>
          )}
        </Canvas>
      )}
      {w > 0 && (
        // Moving layer: no blur, so each frame is cheap.
        <Canvas pointerEvents="none" style={{ position: 'absolute', left: -PAD, top: -PAD, width: w + PAD * 2, height: h + PAD * 2 }}>
          {multi ? (
            <Path path={outline} style="stroke" strokeWidth={RING_WIDTH}>
              <SweepGradient c={c} colors={[...colors]} positions={[...locations]} transform={transform} origin={c} />
            </Path>
          ) : (
            <>
              <Comet path={outline} head={head} length={tail} width={7} color={color} opacity={0.12} />
              <Comet path={outline} head={head} length={tail} width={RING_WIDTH} color={color} opacity={0.3} />
              <Comet path={outline} head={head} length={tail * 0.55} width={RING_WIDTH} color={color} opacity={0.6} />
              <Comet path={outline} head={head} length={tail * 0.22} width={RING_WIDTH + 0.6} color={color} opacity={1} />
            </>
          )}
        </Canvas>
      )}
      <View style={[styles.content, { margin: RING_WIDTH, borderRadius: radius - RING_WIDTH }, contentStyle]}>{children}</View>
    </View>
  );
}

// One stroke of the comet: the stretch of the outline `length` long that
// ends at `head` (both 0–1 of the way round), split in two where it
// crosses the outline's start.
function Comet({ path, head, length, width, color, opacity }: { path: SkPath; head: SharedValue<number>; length: number; width: number; color: string; opacity: number }) {
  const start = useDerivedValue(() => Math.max(0, head.value - length), [length]);
  const wrapStart = useDerivedValue(() => (head.value < length ? 1 - (length - head.value) : 1), [length]);
  return (
    <>
      <Path path={path} style="stroke" strokeWidth={width} strokeCap="round" color={color} opacity={opacity} start={start} end={head} />
      <Path path={path} style="stroke" strokeWidth={width} strokeCap="round" color={color} opacity={opacity} start={wrapStart} end={1} />
    </>
  );
}

const styles = StyleSheet.create({
  content: { backgroundColor: Colors.surface, padding: 16, overflow: 'hidden' },
});
