import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  makeMutable,
  useAnimatedStyle,
  useReducedMotion,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Colors, Radius } from '@/constants/theme';
import { ringColorFor, useAppearance } from '@/lib/appearance';

const RING_WIDTH = 1.5;
const ROTATION_MS = 5000;

// One rotation shared by every panel, like the web's single
// --panel-border-angle timeline (frontend/src/app/globals.css, the
// 2026-09 battery pass): ten cards on Home still run one animation.
const rotation = makeMutable(0);
let rotationStarted = false;
function startRotation() {
  if (rotationStarted) return;
  rotationStarted = true;
  rotation.value = withRepeat(withTiming(360, { duration: ROTATION_MS, easing: Easing.linear }), -1, false);
}

type Props = {
  children: ReactNode;
  // This card's section color (constants/theme.ts SectionColors). Only
  // shows in the Cosmic theme; Calm rings use the owner's ring color
  // (lib/appearance.ts ringColorFor).
  color?: string;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  radius?: number;
};

// The web's .neon-panel: a dark card with a bright segment of its
// section color sweeping around the border. Here, a gradient that
// rotates behind a card inset by the ring width, clipped to the rounded
// shape. With Reduce Motion on, the ring holds still.
export function NeonPanel({ children, color: sectionColor, style, contentStyle, radius = Radius.lg }: Props) {
  const appearance = useAppearance();
  const color = ringColorFor(appearance, sectionColor);
  const reduceMotion = useReducedMotion();
  const [size, setSize] = useState(0);
  useEffect(() => {
    if (!reduceMotion) startRotation();
  }, [reduceMotion]);

  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));

  function onLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    // Big enough that the rotating square always covers the corners.
    setSize(Math.ceil(Math.hypot(width, height)));
  }

  return (
    <View style={[styles.glow, { shadowColor: color, borderRadius: radius }, style]}>
      <View style={[styles.clip, { borderRadius: radius }]} onLayout={onLayout}>
        <View style={[StyleSheet.absoluteFill, styles.ringBase, { borderRadius: radius }]} />
        {size > 0 && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.spinner,
              { width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 },
              reduceMotion ? styles.still : spin,
            ]}>
            <LinearGradient
              colors={[color, `${color}00`, `${color}00`]}
              locations={[0, 0.3, 1]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        )}
        <View style={[styles.content, { borderRadius: radius - RING_WIDTH }, contentStyle]}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  glow: {
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  clip: { overflow: 'hidden', padding: RING_WIDTH },
  ringBase: { backgroundColor: Colors.border },
  spinner: { position: 'absolute', left: '50%', top: '50%' },
  still: { transform: [{ rotate: '225deg' }] },
  content: { backgroundColor: Colors.surface, padding: 16 },
});
