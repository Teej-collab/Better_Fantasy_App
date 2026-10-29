import type { ReactNode } from 'react';
import { View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { Text } from '@/components/Text';
import { hasSkia } from '@/lib/skia';

// The app's glows (2026-10-29 glow pass): real light drawn with Skia on
// build 10 on (GlowSkia.tsx), and the old iOS-shadow look on older
// builds, which can't load Skia (so it's required, never imported).

type Skia = typeof import('@/components/fx/GlowSkia');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const skia = (): Skia => require('@/components/fx/GlowSkia') as Skia;

/** A halo of `color` around a box, `spread` points out. `opacity`, when
 *  given, fades it (a pulse on a scoring play). */
export function GlowBox({
  color,
  radius = 12,
  intensity = 0.6,
  spread = 12,
  opacity,
  style,
  children,
}: {
  color: string;
  radius?: number;
  intensity?: number;
  spread?: number;
  opacity?: SharedValue<number>;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  if (hasSkia) {
    const { GlowBoxSkia } = skia();
    return (
      <GlowBoxSkia color={color} radius={radius} intensity={intensity} spread={spread} opacity={opacity} style={style}>
        {children}
      </GlowBoxSkia>
    );
  }
  return (
    <ShadowBox color={color} intensity={intensity} spread={spread} opacity={opacity} style={style}>
      {children}
    </ShadowBox>
  );
}

function ShadowBox({ color, intensity, spread, opacity, style, children }: { color: string; intensity: number; spread: number; opacity?: SharedValue<number>; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const pulse = useAnimatedStyle(() => ({ shadowOpacity: intensity * (opacity ? opacity.get() : 1) }));
  return <Animated.View style={[style, { shadowColor: color, shadowRadius: spread * 0.8, shadowOffset: { width: 0, height: 0 } }, pulse]}>{children}</Animated.View>;
}

/** A line drawing (24-unit SVG paths) glowing in `color`. */
export function GlowIcon({ paths, color, size, width, fallback }: { paths: string[]; color: string; size: number; width: number; fallback: ReactNode }) {
  if (!hasSkia) return <View style={{ shadowColor: color, shadowOpacity: 0.9, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } }}>{fallback}</View>;
  const { GlowIconSkia } = skia();
  return <GlowIconSkia paths={paths} color={color} size={size} width={width} />;
}

/** Text glowing in its own letter shapes, colored and sized by the
 *  style's textShadowColor / textShadowRadius. */
export function GlowText({ style, children, numberOfLines }: { style?: StyleProp<TextStyle>; children: string; numberOfLines?: number }) {
  if (!hasSkia) {
    return (
      <Text style={style} numberOfLines={numberOfLines}>
        {children}
      </Text>
    );
  }
  const { GlowTextSkia } = skia();
  return (
    <GlowTextSkia style={style} numberOfLines={numberOfLines}>
      {children}
    </GlowTextSkia>
  );
}
