import { Image } from 'expo-image';
import { useEffect, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { NeonPanel } from '@/components/NeonPanel';
import { Text } from '@/components/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';

// A card is the web's .neon-panel (components/NeonPanel.tsx): `color`
// is its section color, `style` styles the inside of the card, and
// `outerStyle` places the card itself (margins, flex).
export function Card({
  children,
  style,
  color,
  outerStyle,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  color?: string;
  outerStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <NeonPanel color={color} style={outerStyle} contentStyle={style}>
      {children}
    </NeonPanel>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

// Custom logo when the owner uploaded one, else their team's initials —
// same fallback the web app's avatars use.
export function TeamAvatar({ name, logoUrl, size = 40 }: { name: string; logoUrl: string | null; size?: number }) {
  const dims = { width: size, height: size, borderRadius: size / 2 };
  if (logoUrl) return <Image source={{ uri: logoUrl }} style={dims} contentFit="cover" transition={150} />;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <View style={[dims, styles.initials]}>
      <Text style={[styles.initialsText, { fontSize: size * 0.38 }]}>{initials}</Text>
    </View>
  );
}

export function formatScore(score: number | null | undefined): string {
  return score === null || score === undefined ? '–' : score.toFixed(2);
}

// `onPress` is optional when a Link (asChild) supplies it.
export function PressableRow({ onPress, children }: { onPress?: () => void; children: ReactNode }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      {children}
    </Pressable>
  );
}

// Shimmering placeholder cards while a screen loads, instead of a lone
// spinner — the shape of the page shows up immediately.
export function LoadingState() {
  return (
    <View style={styles.skeleton} accessibilityLabel="Loading" accessible>
      <SkeletonBlock height={22} width="45%" />
      <SkeletonBlock height={120} />
      <SkeletonBlock height={64} />
      <SkeletonBlock height={64} />
      <SkeletonBlock height={64} />
    </View>
  );
}

// One placeholder bar, gently pulsing on the UI thread.
export function SkeletonBlock({ height, width = '100%' }: { height: number; width?: DimensionValue }) {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(0.5);
  useEffect(() => {
    if (reduceMotion) return;
    pulse.set(withRepeat(withTiming(1, { duration: 750, easing: Easing.inOut(Easing.quad) }), -1, true));
  }, [reduceMotion, pulse]);
  const style = useAnimatedStyle(() => ({ opacity: 0.35 + 0.35 * pulse.get() }));
  return <Animated.View style={[styles.bone, { height, width }, style]} />;
}

export function MessageState({ message }: { message: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { flex: 1, gap: Spacing.md, padding: Spacing.lg },
  bone: { borderRadius: Radius.md, backgroundColor: Colors.tileRaised },
  sectionTitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: Spacing.xl,
    marginBottom: Spacing.sm,
  },
  initials: { backgroundColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  initialsText: { color: Colors.text, fontWeight: '700' },
  row: { paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg },
  rowPressed: { backgroundColor: Colors.border },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  message: { color: Colors.textSecondary, fontSize: 15, textAlign: 'center' },
});
