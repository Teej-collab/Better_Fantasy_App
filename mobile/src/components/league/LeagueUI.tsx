import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { NeonPanel } from '@/components/NeonPanel';
import { Display, Text } from '@/components/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useAppearance } from '@/lib/appearance';

export function openOwner(ownerId: number, season?: number) {
  router.push({ pathname: '/owner/[id]', params: season ? { id: String(ownerId), season: String(season) } : { id: String(ownerId) } });
}

export function openTeam(teamId: number) {
  router.push({ pathname: '/team/[id]', params: { id: String(teamId) } });
}

export function PageTitle({ children, subtitle }: { children: ReactNode; subtitle?: string }) {
  return (
    <View style={styles.titleBlock}>
      <Display style={styles.title}>{children}</Display>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
}

export function SmallHeader({ children }: { children: ReactNode }) {
  return <Text style={styles.smallHeader}>{children}</Text>;
}

// The web's SeasonTabs: newest first, plus an optional extra tab
// (All-Time) at the end.
export function SeasonTabs(props: {
  seasons: number[];
  active: number | null;
  onSelect: (season: number) => void;
  extra?: { label: string; active: boolean; onPress: () => void };
}) {
  const accent = useAppearance().accent;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
      {props.seasons.map((s) => {
        const active = s === props.active && !props.extra?.active;
        return (
          <Pressable key={s} onPress={() => props.onSelect(s)} style={[styles.tab, active && { backgroundColor: accent, borderColor: accent }]}>
            <Text style={[styles.tabText, active && styles.tabTextActive]}>{s}</Text>
          </Pressable>
        );
      })}
      {props.extra && (
        <Pressable
          onPress={props.extra.onPress}
          style={[styles.tab, props.extra.active && { backgroundColor: accent, borderColor: accent }]}>
          <Text style={[styles.tabText, props.extra.active && styles.tabTextActive]}>{props.extra.label}</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

// The web's rounded segmented control (StandingsViewTabs).
export function Segmented<T extends string>(props: { options: { key: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.segmented}>
      {props.options.map((o) => (
        <Pressable key={o.key} onPress={() => props.onChange(o.key)} style={[styles.segment, props.value === o.key && styles.segmentActive]}>
          <Text style={[styles.segmentText, props.value === o.key && styles.segmentTextActive]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function ListPanel({ color, children }: { color?: string; children: ReactNode }) {
  return (
    <NeonPanel color={color} radius={Radius.md} contentStyle={styles.list}>
      {children}
    </NeonPanel>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

const MEDALS = ['🥇', '🥈', '🥉'];

export type RankedEntry = { key: string; name: string; value: string; context?: string; onPress?: () => void };

// The web's RankedCategoryCard: emoji title, description, and a
// medal-ranked list.
export function RankedCategoryCard(props: {
  emoji: string;
  label: string;
  description?: string;
  entries: RankedEntry[];
  emptyMessage?: string;
  color?: string;
}) {
  return (
    <NeonPanel color={props.color} contentStyle={styles.ranked}>
      <View>
        <Text style={styles.rankedTitle}>
          {props.emoji} {props.label}
        </Text>
        {props.description && <Text style={styles.rankedDesc}>{props.description}</Text>}
      </View>
      {props.entries.length === 0 ? (
        <Text style={styles.small}>{props.emptyMessage ?? 'No data yet.'}</Text>
      ) : (
        props.entries.map((e, i) => (
          <View key={e.key} style={styles.rankedRow}>
            <Text style={styles.medal}>{MEDALS[i] ?? i + 1}</Text>
            <View style={styles.flex}>
              <View style={styles.rankedLine}>
                <Pressable disabled={!e.onPress} onPress={e.onPress} style={styles.flexShrink}>
                  <Text style={styles.rankedName}>{e.name}</Text>
                </Pressable>
                <Text style={styles.rankedValue}>{e.value}</Text>
              </View>
              {e.context && <Text style={styles.small}>{e.context}</Text>}
            </View>
          </View>
        ))
      )}
    </NeonPanel>
  );
}

export const leagueStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.06)' },
  pressed: { backgroundColor: 'rgba(255,255,255,0.05)' },
  name: { color: Colors.text, fontSize: 14, fontWeight: '500', flexShrink: 1 },
  owner: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  value: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontVariant: ['tabular-nums'] },
  rank: { width: 24, color: 'rgba(255,255,255,0.5)', fontSize: 14, fontVariant: ['tabular-nums'] },
  flex: { flex: 1 },
});

const styles = StyleSheet.create({
  titleBlock: { gap: 4 },
  title: { fontSize: 24, textTransform: 'none', letterSpacing: 0 },
  subtitle: { color: 'rgba(255,255,255,0.6)', fontSize: 14, lineHeight: 20 },
  smallHeader: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  tabs: { gap: Spacing.sm },
  tab: { backgroundColor: Colors.surface, borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md, paddingVertical: 6 },
  tabText: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#06110a' },
  segmented: { flexDirection: 'row', gap: 4, borderRadius: Radius.pill, backgroundColor: Colors.tileRaised, padding: 4 },
  segment: { flex: 1, borderRadius: Radius.pill, paddingVertical: 6, alignItems: 'center' },
  segmentActive: { backgroundColor: 'rgba(255,255,255,0.15)' },
  segmentText: { color: 'rgba(255,255,255,0.5)', fontSize: 14, fontWeight: '500' },
  segmentTextActive: { color: Colors.text },
  list: { padding: 0, backgroundColor: 'rgba(18,22,28,0.92)' },
  muted: { color: 'rgba(255,255,255,0.5)', fontSize: 14, lineHeight: 20 },
  small: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  ranked: { gap: Spacing.sm },
  rankedTitle: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  rankedDesc: { color: 'rgba(255,255,255,0.45)', fontSize: 12 },
  rankedRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  medal: { width: 20, textAlign: 'center', color: Colors.text },
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  rankedLine: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.sm },
  rankedName: { color: Colors.text, fontSize: 14, fontWeight: '500' },
  rankedValue: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontVariant: ['tabular-nums'] },
});
