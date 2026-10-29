import { BlurMask, Canvas, DashPathEffect, Group, RoundedRect, SweepGradient, vec } from '@shopify/react-native-skia';
import { useState, type ReactNode } from 'react';
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
  // How far round the card's edge, for the light to travel along.
  const perimeter = 2 * (edge.width + edge.height) - (8 - 2 * Math.PI) * edge.r;
  const tail = Math.min(perimeter * 0.22, 220);

  // Where the light's head is along the edge: one lap per turn of the
  // shared clock, at an even speed all the way round (2026-10-29: turning
  // like a clock hand raced it across the corners and short ends).
  const head = useDerivedValue(() => (((still ? 225 : rotation.value) % 360) / 360) * perimeter);
  // A dash `len` long ending at the head.
  const phaseFor = (len: number) => {
    'worklet';
    return (((perimeter - head.value + len) % perimeter) + perimeter) % perimeter;
  };
  const tailPhase = useDerivedValue(() => phaseFor(tail));
  const midPhase = useDerivedValue(() => phaseFor(tail * 0.55));
  const tipPhase = useDerivedValue(() => phaseFor(tail * 0.22));
  // Multi rings keep their full band of colors, turning slowly.
  const transform = useDerivedValue(() => [{ rotate: (((still ? 225 : rotation.value) - 90) * Math.PI) / 180 }]);

  return (
    <View style={style} onLayout={onLayout}>
      {w > 0 && (
        <Canvas pointerEvents="none" style={{ position: 'absolute', left: -PAD, top: -PAD, width: w + PAD * 2, height: h + PAD * 2 }}>
          <RoundedRect {...edge} style="stroke" strokeWidth={RING_WIDTH} color={Colors.border} />
          {multi ? (
            <>
              <Group opacity={Math.min(1, glow * 2.2)}>
                <RoundedRect {...edge} style="stroke" strokeWidth={5}>
                  <SweepGradient c={c} colors={[...colors]} positions={[...locations]} transform={transform} origin={c} />
                  <BlurMask blur={9} style="normal" />
                </RoundedRect>
              </Group>
              <RoundedRect {...edge} style="stroke" strokeWidth={RING_WIDTH}>
                <SweepGradient c={c} colors={[...colors]} positions={[...locations]} transform={transform} origin={c} />
                <BlurMask blur={1.5} style="solid" />
              </RoundedRect>
            </>
          ) : (
            <>
              {/* The bloom around the tail. */}
              <Group opacity={Math.min(1, glow * 2)}>
                <RoundedRect {...edge} style="stroke" strokeWidth={5} strokeCap="round" color={color}>
                  <DashPathEffect intervals={[tail, perimeter - tail]} phase={tailPhase} />
                  <BlurMask blur={9} style="normal" />
                </RoundedRect>
              </Group>
              {/* The comet: a long faint tail, brighter toward a hot tip. */}
              <RoundedRect {...edge} style="stroke" strokeWidth={RING_WIDTH} strokeCap="round" color={color} opacity={0.3}>
                <DashPathEffect intervals={[tail, perimeter - tail]} phase={tailPhase} />
              </RoundedRect>
              <RoundedRect {...edge} style="stroke" strokeWidth={RING_WIDTH} strokeCap="round" color={color} opacity={0.6}>
                <DashPathEffect intervals={[tail * 0.55, perimeter - tail * 0.55]} phase={midPhase} />
              </RoundedRect>
              <RoundedRect {...edge} style="stroke" strokeWidth={RING_WIDTH + 0.5} strokeCap="round" color={color}>
                <DashPathEffect intervals={[tail * 0.22, perimeter - tail * 0.22]} phase={tipPhase} />
                <BlurMask blur={1.5} style="solid" />
              </RoundedRect>
            </>
          )}
        </Canvas>
      )}
      <View style={[styles.content, { margin: RING_WIDTH, borderRadius: radius - RING_WIDTH }, contentStyle]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { backgroundColor: Colors.surface, padding: 16, overflow: 'hidden' },
});
