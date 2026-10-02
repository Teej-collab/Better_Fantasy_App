import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Text } from '@/components/Text';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';

// The Join / Create a League flow's building blocks (port of the web's
// components/start/StartFlow.tsx and its CSS module) — the approved
// "Join & Create League Flow" mockups: neon signage on the dark ground,
// one decision per screen.

const ACCENT = Colors.accent;

export function StartScreen({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.screen}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="ga" cx="10%" cy="5%" r="55%">
              <Stop offset="0" stopColor={ACCENT} stopOpacity={0.1} />
              <Stop offset="1" stopColor={ACCENT} stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id="gb" cx="95%" cy="100%" r="60%">
              <Stop offset="0" stopColor="#2fd0ff" stopOpacity={0.08} />
              <Stop offset="1" stopColor="#2fd0ff" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#ga)" />
          <Rect width="100%" height="100%" fill="url(#gb)" />
        </Svg>
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Spacing.xl }]}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive">
        {children}
      </ScrollView>
      {footer && <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>{footer}</View>}
    </View>
  );
}

export function StepDots({ step, total = 3 }: { step: number; total?: number }) {
  return (
    <View style={styles.dots} accessible accessibilityLabel={`Step ${step} of ${total}`}>
      {Array.from({ length: total }, (_, i) => i + 1).map((i) => (
        <View key={i} style={[styles.dot, i <= step && styles.dotDone, i === step && styles.dotNow]} />
      ))}
    </View>
  );
}

export function Kicker({ children }: { children: ReactNode }) {
  return <Text style={styles.kicker}>{children}</Text>;
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text style={styles.title} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Sub({ children }: { children: ReactNode }) {
  return <Text style={styles.sub}>{children}</Text>;
}

export function NeonButton({ label, onPress, disabled, busy, icon }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean; icon?: ReactNode }) {
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy }}
      style={({ pressed }) => [styles.neon, (disabled || busy) && styles.dim, pressed && styles.pressed]}>
      {busy ? <ActivityIndicator color={ACCENT} /> : icon}
      {!busy && <Text style={styles.neonText}>{label}</Text>}
    </Pressable>
  );
}

export function GhostButton({ label, onPress, disabled, flex }: { label: string; onPress: () => void; disabled?: boolean; flex?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [styles.ghost, flex && styles.flex, disabled && styles.dim, pressed && styles.pressed]}>
      <Text style={styles.ghostText}>{label}</Text>
    </Pressable>
  );
}

export function Door({ title, text, accent, icon, onPress }: { title: string; text: string; accent: string; icon: 'users' | 'plus'; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${text}`}
      style={({ pressed }) => [styles.door, { borderColor: `${accent}55`, shadowColor: accent }, pressed && styles.pressed]}>
      <View style={[styles.doorIcon, { backgroundColor: `${accent}1f` }]}>
        <Icon name={icon} color={accent} size={26} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.doorTitle}>{title}</Text>
        <Text style={styles.doorText}>{text}</Text>
      </View>
      <Icon name="chev" color={Colors.textSecondary} size={20} />
    </Pressable>
  );
}

export function OptionCard({ on, title, text, color, icon, onPress }: { on: boolean; title: string; text: string; color: string; icon: 'plus' | 'download'; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        haptics.select();
        onPress();
      }}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      style={[styles.option, on && styles.optionOn]}>
      <Icon name={icon} color={color} size={22} />
      <View style={styles.flex}>
        <Text style={styles.optionTitle}>{title}</Text>
        <Text style={styles.doorText}>{text}</Text>
      </View>
    </Pressable>
  );
}

export function Segments<T extends string | number>({ options, value, onChange, label }: { options: { key: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={styles.segs}>
        {options.map((o) => {
          const on = o.key === value;
          return (
            <Pressable
              key={String(o.key)}
              onPress={() => {
                haptics.select();
                onChange(o.key);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[styles.seg, on && styles.segOn]}>
              <Text style={[styles.segText, on && styles.segTextOn]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>{label}</Text>
      <TextInput placeholderTextColor={Colors.textSecondary} accessibilityLabel={label} {...props} style={[styles.field, props.style]} />
    </View>
  );
}

export function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function BackRow({ step, onBack }: { step?: number; onBack?: () => void }) {
  return (
    <View style={styles.backRow}>
      <Pressable onPress={onBack ?? (() => router.back())} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
        <Icon name="back" color="#aab2bf" size={18} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      {step !== undefined && <StepDots step={step} />}
    </View>
  );
}

const PATHS: Record<string, string[]> = {
  users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  plus: ['M12 5v14', 'M5 12h14'],
  chev: ['M9 18l6-6-6-6'],
  back: ['M15 18l-6-6 6-6'],
  download: ['M12 3v12', 'M7 10l5 5 5-5', 'M5 21h14'],
  check: ['M20 6L9 17l-5-5'],
  camera: ['M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z'],
};

export function Icon({ name, color, size = 22 }: { name: keyof typeof PATHS | string; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {(PATHS[name] ?? []).map((d) => (
        <Path key={d} d={d} />
      ))}
      {name === 'users' && <Circle cx={9} cy={7} r={4} />}
      {name === 'camera' && <Circle cx={12} cy={13} r={4} />}
    </Svg>
  );
}

export const startStyles = StyleSheet.create({
  card: { gap: Spacing.md, padding: Spacing.lg, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  cardLit: { borderColor: 'rgba(57,255,20,0.45)' },
  cardTitle: { fontFamily: Fonts.displayBold, fontSize: 22, letterSpacing: 1, textTransform: 'uppercase', color: Colors.text },
  muted: { color: '#aab2bf', fontSize: 14, lineHeight: 20 },
  found: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  foundText: { color: ACCENT, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  stats: { flexDirection: 'row', gap: Spacing.sm },
  error: { color: Colors.loss, fontSize: 14 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: Colors.border },
  dividerText: { color: Colors.textSecondary, fontSize: 13 },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: Spacing.lg, gap: Spacing.lg },
  footer: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, gap: Spacing.sm },
  flex: { flex: 1 },
  dim: { opacity: 0.45 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.99 }] },
  dots: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2a303a' },
  dotDone: { backgroundColor: ACCENT },
  dotNow: { width: 22 },
  kicker: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600', letterSpacing: 2.5, textTransform: 'uppercase' },
  title: { fontFamily: Fonts.displayBold, fontSize: 32, lineHeight: 36, letterSpacing: 1, textTransform: 'uppercase', color: Colors.text },
  sub: { color: '#aab2bf', fontSize: 15, lineHeight: 22 },
  neon: {
    minHeight: 54,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: ACCENT,
    backgroundColor: 'rgba(6,10,7,0.9)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    shadowColor: ACCENT,
    shadowOpacity: 0.6,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  neonText: { color: ACCENT, fontSize: 15, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },
  ghost: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: '#2a303a', backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.md },
  ghostText: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  door: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
    paddingVertical: 20,
    paddingHorizontal: 18,
    borderRadius: 18,
    borderWidth: 1,
    backgroundColor: Colors.surface,
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
  },
  doorIcon: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  doorTitle: { fontFamily: Fonts.displayBold, fontSize: 22, letterSpacing: 1, textTransform: 'uppercase', color: Colors.text },
  doorText: { color: '#aab2bf', fontSize: 14, lineHeight: 20 },
  option: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, padding: Spacing.lg, borderRadius: Radius.lg, borderWidth: 1, borderColor: '#2a303a', backgroundColor: Colors.surface },
  optionOn: { borderWidth: 2, borderColor: ACCENT, backgroundColor: 'rgba(57,255,20,0.07)' },
  optionTitle: { color: Colors.text, fontSize: 15, fontWeight: '700', marginBottom: 2 },
  group: { gap: Spacing.sm },
  groupLabel: { color: '#aab2bf', fontSize: 13, fontWeight: '600' },
  segs: { flexDirection: 'row', gap: Spacing.sm },
  seg: { flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: '#2a303a', backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  segOn: { borderColor: ACCENT, backgroundColor: 'rgba(57,255,20,0.12)' },
  segText: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  segTextOn: { color: ACCENT },
  field: { minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: '#2a303a', backgroundColor: Colors.tile, color: Colors.text, fontSize: 16, paddingHorizontal: 14 },
  stat: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.tile, alignItems: 'center' },
  statValue: { color: Colors.text, fontFamily: Fonts.monoBold, fontSize: 17 },
  statLabel: { color: Colors.textSecondary, fontSize: 12 },
  backRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  backText: { color: '#aab2bf', fontSize: 14 },
});
