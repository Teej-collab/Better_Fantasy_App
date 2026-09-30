import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { NeonPanel } from '@/components/NeonPanel';
import { Text } from '@/components/Text';
import { Colors, Spacing } from '@/constants/theme';

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

export function PressableRow({ onPress, children }: { onPress: () => void; children: ReactNode }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      {children}
    </Pressable>
  );
}

export function LoadingState() {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={Colors.accent} />
    </View>
  );
}

export function MessageState({ message }: { message: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
