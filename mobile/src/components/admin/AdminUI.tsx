import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Polygon, Polyline, Stop } from 'react-native-svg';

import { AppRefreshControl } from '@/components/AppRefreshControl';
import { NeonPanel } from '@/components/NeonPanel';
import { Display, Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { useMe } from '@/lib/queries';

// Shared building blocks for the admin screens — ports of the web's
// components/admin/AdminUi.tsx, KpiCard, LineChart and DonutChart.

// The web's --admin-accent: a control-room blue, Admin's own color.
export const ADMIN_ACCENT = '#38bdf8';
const GOOD = '#10b981';
const WARN = '#f59e0b';
const BAD = '#ef4444';

export const WINDOW_OPTIONS = [7, 30, 90] as const;

// Site owner only; every /admin endpoint re-checks this server-side.
export function AdminScreen({ children }: { children: ReactNode }) {
  const me = useMe();
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" refreshControl={<AppRefreshControl />} automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
      {me.isPending ? (
        <LoadingState />
      ) : !me.data?.is_site_owner ? (
        <MessageState message="Not authorized. This page is only visible to the site owner." />
      ) : (
        children
      )}
    </ScrollView>
  );
}

export function AdminSection({ title, hint, action, children }: { title: string; hint?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <NeonPanel color={ADMIN_ACCENT} radius={12} contentStyle={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {action}
      </View>
      {hint && <Text style={styles.hint}>{hint}</Text>}
      {children}
    </NeonPanel>
  );
}

export function WindowPicker({ value, onChange, disabled, options = WINDOW_OPTIONS }: { value: number; onChange: (days: number) => void; disabled?: boolean; options?: readonly number[] }) {
  return (
    <View style={styles.windowRow}>
      {options.map((d) => (
        <Pressable key={d} onPress={() => {
            haptics.select();
            onChange(d);
          }} disabled={disabled} style={[styles.windowPill, value === d && styles.windowActive, disabled && styles.dim]}>
          <Text style={[styles.windowText, value === d && styles.windowTextActive]}>{d === 1 ? '24h' : `${d}d`}</Text>
        </Pressable>
      ))}
    </View>
  );
}

type Tone = 'default' | 'good' | 'warn' | 'bad';
const TONE_COLOR: Record<Tone, string> = { default: Colors.text, good: GOOD, warn: WARN, bad: BAD };

export function StatTile({ label, value, hint, tone = 'default', live = false }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; live?: boolean }) {
  return (
    <NeonPanel color={ADMIN_ACCENT} radius={12} style={styles.tileOuter} contentStyle={styles.tile}>
      <View style={styles.tileLabelRow}>
        {live && <View style={styles.liveDot} />}
        <Text style={styles.tileLabel} numberOfLines={2}>
          {label}
        </Text>
      </View>
      <Display style={[styles.tileValue, { color: TONE_COLOR[tone] }]}>{value}</Display>
      {hint && <Text style={styles.tileHint}>{hint}</Text>}
    </NeonPanel>
  );
}

// Two-up grid of tiles (the web's grid-cols-2 on a phone).
export function TileGrid({ children }: { children: ReactNode }) {
  return <View style={styles.tileGrid}>{children}</View>;
}

export function BarRow({ label, value, max, right, color = ADMIN_ACCENT }: { label: ReactNode; value: number; max: number; right?: ReactNode; color?: string }) {
  const pctWidth = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <View style={styles.barRow}>
      <Text style={styles.barLabel}>{label}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pctWidth}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.barRight}>{right ?? value.toLocaleString()}</Text>
    </View>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <Text style={styles.empty}>{children}</Text>;
}

const PILL_TONES: Record<Tone, { bg: string; fg: string }> = {
  default: { bg: 'rgba(255,255,255,0.1)', fg: 'rgba(255,255,255,0.6)' },
  bad: { bg: 'rgba(239,68,68,0.15)', fg: BAD },
  warn: { bg: 'rgba(245,158,11,0.15)', fg: WARN },
  good: { bg: 'rgba(16,185,129,0.15)', fg: GOOD },
};

export function Pill({ children, tone = 'default' }: { children: ReactNode; tone?: Tone }) {
  return (
    <View style={[styles.pill, { backgroundColor: PILL_TONES[tone].bg }]}>
      <Text style={[styles.pillText, { color: PILL_TONES[tone].fg }]}>{children}</Text>
    </View>
  );
}

// A badge in the admin accent (Commissioner) or green (Admin).
export function RoleBadge({ label, green }: { label: string; green?: boolean }) {
  return (
    <View style={[styles.role, { backgroundColor: green ? 'rgba(16,185,129,0.15)' : 'rgba(56,189,248,0.15)' }]}>
      <Text style={[styles.roleText, { color: green ? '#34d399' : ADMIN_ACCENT }]}>{label}</Text>
    </View>
  );
}

export function Divided({ index, children, style }: { index: number; children: ReactNode; style?: object }) {
  return <View style={[styles.listItem, index > 0 && styles.divided, style]}>{children}</View>;
}

export function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// The web's adminFormat.relativeTime: like timeAgo, but a real date past 30 days.
export function relativeTime(iso: string): string {
  const diffSeconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSeconds < 60) return 'just now';
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatDuration(seconds: number | undefined | null): string {
  if (seconds === undefined || seconds === null) return '?';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

export function pct(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`;
}

export function dayLabel(isoDate: string): string {
  // A bare YYYY-MM-DD parses as UTC midnight (the previous day west of
  // UTC) — pin it to local noon instead.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? new Date(`${isoDate}T12:00:00`) : new Date(isoDate);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function platformLabel(platform: string | null, device?: string | null): string {
  const p = platform === 'ios' ? 'iOS' : platform === 'android' ? 'Android' : platform === 'web' ? 'Web' : 'Unknown';
  return device ? `${p} · ${device}` : p;
}

// ---- Charts ------------------------------------------------------------

export type LineSeries = { label: string; color: string; values: number[] };

// The web's LineChart: one or more series over shared x labels. Touch
// and drag to read every series' value at that point.
export function LineChart({ labels, series, height = 160 }: { labels: string[]; series: LineSeries[]; height?: number }) {
  const [width, setWidth] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const padding = 8;
  const maxValue = Math.max(1, ...series.flatMap((s) => s.values));
  const n = labels.length;
  const stepX = n > 1 && width ? (width - padding * 2) / (n - 1) : 0;
  const xFor = (i: number) => padding + i * stepX;
  const yFor = (v: number) => height - padding - (v / maxValue) * (height - padding * 2);
  const pointsFor = (values: number[]) => values.map((v, i) => `${xFor(i)},${yFor(v)}`).join(' ');

  function track(e: GestureResponderEvent) {
    if (!n) return;
    const index = Math.round((e.nativeEvent.locationX - padding) / (stepX || 1));
    setHoverIndex(Math.max(0, Math.min(n - 1, index)));
  }

  return (
    <View>
      <View
        style={{ height }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={track}
        onResponderMove={track}
        onResponderRelease={() => setHoverIndex(null)}
        onResponderTerminate={() => setHoverIndex(null)}>
        {width > 0 && n > 0 && (
          <Svg width={width} height={height}>
            <Defs>
              {series.map((s, i) => (
                <LinearGradient key={s.label} id={`grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0%" stopColor={s.color} stopOpacity={0.25} />
                  <Stop offset="100%" stopColor={s.color} stopOpacity={0} />
                </LinearGradient>
              ))}
            </Defs>
            {series.map((s, i) => (
              <Polygon
                key={`fill-${s.label}`}
                points={`${padding},${height - padding} ${pointsFor(s.values)} ${xFor(n - 1)},${height - padding}`}
                fill={`url(#grad-${i})`}
              />
            ))}
            {series.map((s) => (
              <Polyline key={`line-${s.label}`} points={pointsFor(s.values)} fill="none" stroke={s.color} strokeWidth={2} />
            ))}
            {hoverIndex !== null && (
              <Line x1={xFor(hoverIndex)} y1={padding} x2={xFor(hoverIndex)} y2={height - padding} stroke="rgba(255,255,255,0.15)" />
            )}
            {hoverIndex !== null &&
              series.map((s) => <Circle key={`dot-${s.label}`} cx={xFor(hoverIndex)} cy={yFor(s.values[hoverIndex] ?? 0)} r={3} fill={s.color} />)}
          </Svg>
        )}
        {hoverIndex !== null && (
          <View
            pointerEvents="none"
            style={[styles.tooltip, hoverIndex > n / 2 ? { right: width - xFor(hoverIndex) } : { left: xFor(hoverIndex) }]}>
            <Text style={styles.tooltipTitle}>{labels[hoverIndex]}</Text>
            {series.map((s) => (
              <View key={s.label} style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: s.color }]} />
                <Text style={styles.tooltipText}>
                  {s.label}: {s.values[hoverIndex] ?? 0}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
      <View style={styles.legend}>
        {series.map((s) => (
          <View key={s.label} style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: s.color }]} />
            <Text style={styles.legendText}>{s.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const DONUT_COLORS = ['#39ff14', '#22d3ee', '#a855f7', '#f59e0b', '#ec4899', '#64748b'];

export function DonutChart({ slices, centerLabel }: { slices: { label: string; value: number }[]; centerLabel?: string }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const arcs = slices.reduce<{ dash: number; offset: number }[]>((acc, s) => {
    const prev = acc[acc.length - 1];
    acc.push({ dash: total > 0 ? (s.value / total) * circumference : 0, offset: prev ? prev.offset + prev.dash : 0 });
    return acc;
  }, []);
  const colorFor = (i: number) => DONUT_COLORS[Math.min(i, DONUT_COLORS.length - 1)];
  return (
    <View style={styles.donutRow}>
      <Svg width={112} height={112} viewBox="0 0 100 100" style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={50} cy={50} r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={14} />
        {total > 0 &&
          slices.map((s, i) => (
            <Circle
              key={s.label}
              cx={50}
              cy={50}
              r={radius}
              fill="none"
              stroke={colorFor(i)}
              strokeWidth={14}
              strokeDasharray={`${arcs[i].dash} ${circumference - arcs[i].dash}`}
              strokeDashoffset={-arcs[i].offset}
            />
          ))}
      </Svg>
      <View style={styles.donutLegend}>
        {centerLabel && <Text style={styles.hint}>{centerLabel}</Text>}
        {slices.length === 0 ? (
          <EmptyNote>No data yet.</EmptyNote>
        ) : (
          slices.map((s, i) => (
            <View key={s.label} style={styles.legendRow}>
              <View style={[styles.legendDot, { backgroundColor: colorFor(i) }]} />
              <Text style={[styles.legendText, styles.flex]}>{s.label}</Text>
              <Text style={styles.legendText}>{total > 0 ? `${Math.round((s.value / total) * 100)}%` : '0%'}</Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

export const adminStyles = StyleSheet.create({
  gap: { gap: Spacing.lg },
  gapSm: { gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  flex: { flex: 1, minWidth: 0 },
  body: { color: Colors.text, fontSize: 14 },
  medium: { color: Colors.text, fontSize: 14, fontWeight: '500' },
  small: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  tiny: { color: 'rgba(255,255,255,0.45)', fontSize: 11 },
  soft: { color: 'rgba(255,255,255,0.6)', fontSize: 14 },
  mono: { fontFamily: Fonts.mono, fontSize: 12, color: Colors.text },
  right: { textAlign: 'right' },
  link: { color: ADMIN_ACCENT, fontSize: 13 },
  error: { color: Colors.loss, fontSize: 13 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.08)', marginVertical: 4 },
});

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.lg },
  flex: { flex: 1, minWidth: 0 },
  dim: { opacity: 0.5 },
  section: { gap: Spacing.sm, padding: Spacing.lg },
  sectionHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.md },
  sectionTitle: { flex: 1, color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  hint: { color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 17 },
  windowRow: { flexDirection: 'row', gap: 4 },
  windowPill: { backgroundColor: Colors.surface, borderRadius: Radius.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 8, paddingVertical: 2 },
  windowActive: { borderColor: ADMIN_ACCENT, backgroundColor: 'rgba(56,189,248,0.12)' },
  windowText: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '500' },
  windowTextActive: { color: ADMIN_ACCENT },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  tileOuter: { flexBasis: '46%', flexGrow: 1 },
  tile: { gap: 4, padding: Spacing.md },
  tileLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tileLabel: { flexShrink: 1, color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  tileValue: { fontSize: 24, letterSpacing: 0, fontVariant: ['tabular-nums'] },
  tileHint: { color: 'rgba(255,255,255,0.45)', fontSize: 11 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: GOOD },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  barLabel: { width: 112, color: Colors.text, fontSize: 13 },
  barTrack: { flex: 1, height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.1)' },
  barFill: { height: '100%', borderRadius: 6 },
  barRight: { flexShrink: 0, maxWidth: 130, color: 'rgba(255,255,255,0.5)', fontSize: 12, textAlign: 'right', fontVariant: ['tabular-nums'] },
  empty: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
  pill: { alignSelf: 'flex-start', borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2 },
  pillText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  role: { borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2 },
  roleText: { fontSize: 10, fontWeight: '700' },
  listItem: { paddingVertical: Spacing.sm, gap: 2 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.06)' },
  tooltip: {
    position: 'absolute',
    top: 0,
    gap: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: Colors.bg,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tooltipTitle: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '500' },
  tooltipText: { color: Colors.text, fontSize: 11, fontVariant: ['tabular-nums'] },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, marginTop: 4 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  donutRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  donutLegend: { flex: 1, gap: 4 },
});
