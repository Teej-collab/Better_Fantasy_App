import { router, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { Text } from '@/components/Text';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { trackTap } from '@/lib/analytics';
import { haptics } from '@/lib/haptics';
import { useAppearance } from '@/lib/appearance';

// The Commissioner Tools overhaul's building blocks (2026-10-23, the
// approved "Commissioner Tools overhaul" mockups): a big section title
// with a colored line under it, tappable tool rows that show the
// current setting, segmented choices, switches with an explanation,
// and the full-width save button.

export const TONES = { orange: '#f97316', red: '#f87171', purple: '#a78bfa', blue: '#38bdf8', yellow: '#facc15', green: '#4ade80' } as const;

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.pageHead}>
      <Text style={styles.pageTitle}>{title}</Text>
      {subtitle ? <Text style={styles.pageSub}>{subtitle}</Text> : null}
    </View>
  );
}

export function GroupTitle({ title, color, right }: { title: string; color: string; right?: string }) {
  return (
    <View style={[styles.groupHead, { borderBottomColor: color }]}>
      <Text style={styles.groupTitle} accessibilityRole="header">
        {title}
      </Text>
      {right ? <Text style={[styles.groupRight, { color }]}>{right}</Text> : null}
    </View>
  );
}

export function Panel({ children, color }: { children: ReactNode; color?: string }) {
  return <View style={[styles.panel, color ? { borderColor: `${color}66` } : null]}>{children}</View>;
}

export function ToolRow({ title, value, href, badge, first, target }: { title: string; value?: string; href: Href; badge?: string; first?: boolean; target: string }) {
  const accent = useAppearance().accent;
  return (
    <Pressable
      onPress={() => {
        haptics.select();
        trackTap(`commish.${target}`);
        router.push(href);
      }}
      accessibilityRole="button"
      accessibilityLabel={value ? `${title}. ${value}` : title}
      style={({ pressed }) => [styles.toolRow, !first && styles.divided, pressed && styles.pressed]}>
      <View style={styles.flex}>
        <View style={styles.titleLine}>
          <Text style={styles.toolTitle}>{title}</Text>
          {badge ? (
            <View style={[styles.badge, { backgroundColor: accent }]}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          ) : null}
        </View>
        {value ? (
          <Text style={styles.toolValue} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const accent = useAppearance().accent;
  return (
    <View style={styles.segmented} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => {
              haptics.select();
              onChange(o.value);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={[styles.segment, on && { backgroundColor: accent }]}>
            <Text style={[styles.segmentText, on && styles.segmentTextOn]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chips<T extends string | number>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T | null; onChange: (v: T) => void }) {
  const accent = useAppearance().accent;
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => {
              haptics.select();
              onChange(o.value);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[styles.chip, on && { borderColor: accent, backgroundColor: `${accent}22` }]}>
            <Text style={styles.chipText}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SwitchRow({ title, sub, value, onChange, first }: { title: string; sub?: string; value: boolean; onChange: (v: boolean) => void; first?: boolean }) {
  const accent = useAppearance().accent;
  return (
    <View style={[styles.switchRow, !first && styles.divided]}>
      <View style={styles.flex}>
        <Text style={styles.toolTitle}>{title}</Text>
        {sub ? <Text style={styles.switchSub}>{sub}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={(v) => {
          haptics.select();
          onChange(v);
        }}
        trackColor={{ true: accent, false: 'rgba(255,255,255,0.25)' }}
        accessibilityLabel={title}
      />
    </View>
  );
}

export function BigButton({ label, busyLabel, busy, disabled, onPress, tone = 'accent' }: { label: string; busyLabel?: string; busy?: boolean; disabled?: boolean; onPress: () => void; tone?: 'accent' | 'outline' | 'danger' }) {
  const accent = useAppearance().accent;
  const off = busy || disabled;
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      disabled={off}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.big,
        tone === 'accent' && { backgroundColor: accent },
        tone === 'outline' && styles.bigOutline,
        tone === 'danger' && styles.bigDanger,
        (off || pressed) && { opacity: off ? 0.45 : 0.8 },
      ]}>
      <Text style={[styles.bigText, tone !== 'accent' && { color: tone === 'danger' ? '#f87171' : Colors.text }]}>{busy && busyLabel ? busyLabel : label}</Text>
    </Pressable>
  );
}

export function SmallButton({ label, onPress, color, disabled }: { label: string; onPress: () => void; color?: string; disabled?: boolean }) {
  const accent = useAppearance().accent;
  const c = color ?? accent;
  return (
    <Pressable
      onPress={() => {
        haptics.select();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      hitSlop={6}
      style={({ pressed }) => [styles.small, { backgroundColor: `${c}2e` }, (pressed || disabled) && { opacity: 0.6 }]}>
      <Text style={styles.smallText}>{label}</Text>
    </Pressable>
  );
}

// "Thu, Nov 20 · 6:00 PM"
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return 'Not set';
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

// "In 4 weeks", "Tomorrow", "2 days ago"
export function relative(iso: string | null | undefined): string {
  if (!iso) return '';
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 13) return `In ${Math.round(days / 7)} weeks`;
  if (days > 0) return `In ${days} days`;
  if (days < -13) return `${Math.round(-days / 7)} weeks ago`;
  return `${-days} days ago`;
}

export const partStyles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  label: { color: Colors.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  body: { color: Colors.text, fontSize: 15 },
  sub: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)' },
  input: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: Colors.surface,
    color: Colors.text,
    fontSize: 15,
    paddingHorizontal: 12,
  },
});

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0, gap: 2 },
  pageHead: { gap: 4 },
  pageTitle: { fontFamily: Fonts.display, fontSize: 28, color: Colors.text, textTransform: 'uppercase', letterSpacing: 0.5 },
  pageSub: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20 },
  groupHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingBottom: 6, borderBottomWidth: 2 },
  groupTitle: { fontFamily: Fonts.display, fontSize: 18, color: Colors.text, textTransform: 'uppercase', letterSpacing: 0.6 },
  groupRight: { fontSize: 12, fontWeight: '700' },
  panel: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  toolRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 58, paddingHorizontal: 14, paddingVertical: 10 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)' },
  pressed: { backgroundColor: 'rgba(255,255,255,0.05)' },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toolTitle: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  toolValue: { color: Colors.textSecondary, fontSize: 12 },
  badge: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  badgeText: { color: '#0d1016', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  chevron: { color: 'rgba(255,255,255,0.35)', fontSize: 22, fontWeight: '300' },
  segmented: { flexDirection: 'row', gap: 4, backgroundColor: Colors.tile, borderRadius: 12, padding: 4 },
  segment: { flex: 1, minHeight: 44, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  segmentText: { color: Colors.text, fontSize: 13, fontWeight: '700' },
  segmentTextOn: { color: '#0d1016' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', backgroundColor: Colors.surface },
  chipText: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: 14, paddingVertical: 12 },
  switchSub: { color: Colors.textSecondary, fontSize: 12, lineHeight: 17 },
  big: { minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg },
  bigOutline: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: Colors.surface },
  bigDanger: { borderWidth: 1, borderColor: 'rgba(239,68,68,0.5)', backgroundColor: Colors.surface },
  bigText: { color: '#0d1016', fontSize: 15, fontWeight: '800' },
  small: { minHeight: 36, borderRadius: Radius.pill, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  smallText: { color: Colors.text, fontSize: 13, fontWeight: '700' },
});
