import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NeonPanel } from '@/components/NeonPanel';
import { Text } from '@/components/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import type { PlayerViewColumn, PlayerViewKey } from '@/lib/types';

// Port of the web's components/players/PlayerViews.tsx: ESPN's Views
// sheet for the Players list and the roster.

// Same set and order as ESPN's own Views sheet. Matchup Stats is each
// list's existing layout.
export const PLAYER_VIEW_OPTIONS: { key: PlayerViewKey; label: string }[] = [
  { key: 'matchup', label: 'Matchup Stats' },
  { key: 'proj_2026', label: '2026 Proj' },
  { key: 'stats_2026', label: '2026 Stats' },
  { key: 'stats_2025', label: '2025 Stats' },
  { key: 'scoring', label: 'Scoring' },
  { key: 'research', label: 'Research' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'rankings', label: 'Rankings' },
  { key: 'ppr_rankings', label: 'PPR Rankings' },
];

const VALID_KEYS = new Set(PLAYER_VIEW_OPTIONS.map((o) => o.key));

// The chosen view for one list, remembered on this phone.
export function usePlayerView(storageKey: string): [PlayerViewKey, (view: PlayerViewKey) => void] {
  const [view, setView] = useState<PlayerViewKey>('matchup');
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(storageKey)
      .then((saved) => {
        if (!cancelled && saved && VALID_KEYS.has(saved as PlayerViewKey)) setView(saved as PlayerViewKey);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  function choose(next: PlayerViewKey) {
    setView(next);
    AsyncStorage.setItem(storageKey, next).catch(() => {});
  }
  return [view, choose];
}

// The pill + bottom sheet ("Views · Close", checkmark on the active one).
export function PlayerViewsPill({ view, onChange }: { view: PlayerViewKey; onChange: (view: PlayerViewKey) => void }) {
  const [open, setOpen] = useState(false);
  const accent = useAppearance().accent;
  const insets = useSafeAreaInsets();
  const label = PLAYER_VIEW_OPTIONS.find((o) => o.key === view)?.label ?? 'Matchup Stats';
  return (
    <>
      <Pressable
        onPress={() => {
          haptics.tap();
          setOpen(true);
        }} hitSlop={6} style={({ pressed }) => [styles.pill, pressed && styles.pressed]}>
        <Text style={styles.pillText}>{label}</Text>
        <Text style={styles.pillChevron}>▾</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]} onPress={() => {}}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Views</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={10} style={styles.sheetClose}>
                <Text style={styles.sheetCloseText}>Close</Text>
              </Pressable>
            </View>
            {PLAYER_VIEW_OPTIONS.map((o) => {
              const active = o.key === view;
              return (
                <Pressable
                  key={o.key}
                  onPress={() => {
                    haptics.select();
                    onChange(o.key);
                    setOpen(false);
                  }}
                  style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
                  <Text style={[styles.optionText, active && { color: accent, fontWeight: '600' }]}>{o.label}</Text>
                  {active && <Text style={{ color: accent }}>✓</Text>}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

export type PlayerViewRow = {
  id: string;
  // Fantasy position (QB/RB/WR/TE/K/DEF) — splits the stat views into
  // per-position sections.
  position: string;
  // The pinned left column: name/team plus whatever the list puts in
  // front of it (an Add button, a slot pill).
  cell: ReactNode;
};

// The season stat views get one section per position family, each with
// only its own columns, so everyone's real stats are visible.
const STAT_VIEWS = new Set<PlayerViewKey>(['proj_2026', 'stats_2026', 'stats_2025']);
const POSITION_FAMILIES: { label: string; positions: string[] }[] = [
  { label: 'Quarterbacks', positions: ['QB'] },
  { label: 'RB / WR / TE', positions: ['RB', 'WR', 'TE'] },
  { label: 'Kickers', positions: ['K'] },
  { label: 'D/ST', positions: ['DEF'] },
];

export function PlayerViewTable({ view, rows, color }: { view: Exclude<PlayerViewKey, 'matchup'>; rows: PlayerViewRow[]; color?: string }) {
  if (!STAT_VIEWS.has(view)) return <ViewSection view={view} rows={rows} color={color} />;
  const sections = POSITION_FAMILIES.map((family) => ({
    ...family,
    rows: rows.filter((r) => family.positions.includes(r.position)),
  })).filter((section) => section.rows.length > 0);
  // One family only (a position filter's on) — no need for a heading.
  if (sections.length === 1) return <ViewSection view={view} rows={sections[0].rows} color={color} />;
  return (
    <View style={styles.sections}>
      {sections.map((section) => (
        <View key={section.label} style={styles.section}>
          <Text style={styles.sectionLabel}>{section.label}</Text>
          <ViewSection view={view} rows={section.rows} color={color} />
        </View>
      ))}
    </View>
  );
}

// Every row is this tall in both halves, so the pinned names line up
// with their stats.
const ROW_HEIGHT = 54;
const GROUP_HEIGHT = 24;
const HEADER_HEIGHT = 32;
const PINNED_WIDTH = 178;
const COLUMN_WIDTH = 56;

// One view's stat columns for a list of players — the player column
// stays pinned on the left while the stats scroll sideways, like ESPN.
function ViewSection({ view, rows, color }: { view: Exclude<PlayerViewKey, 'matchup'>; rows: PlayerViewRow[]; color?: string }) {
  const ids = rows.map((r) => r.id);
  const q = useQuery({
    queryKey: ['player-view', view, ids.join(',')],
    queryFn: () => api.playerView(view, ids),
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
  });
  const current = q.data;
  const columns = current?.columns ?? [];
  const groups = groupSpans(columns);

  if (q.isError && !current) {
    return (
      <NeonPanel color={color} radius={Radius.md}>
        <Text style={styles.error}>{q.error instanceof Error ? q.error.message : "Couldn't load this view"}</Text>
      </NeonPanel>
    );
  }

  return (
    <NeonPanel color={color} radius={Radius.md} contentStyle={styles.tableCard}>
      <View style={styles.table}>
        <View style={[styles.pinned, { width: PINNED_WIDTH }]}>
          {groups.length > 0 && <View style={{ height: GROUP_HEIGHT }} />}
          <View style={[styles.headCell, { height: HEADER_HEIGHT }]}>
            <Text style={styles.headText}>Players</Text>
          </View>
          {rows.map((r, i) => (
            <View key={r.id} style={[styles.pinnedCell, { height: ROW_HEIGHT }, i > 0 && styles.divided]}>
              {r.cell}
            </View>
          ))}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.flex}>
          {!current ? (
            <View style={{ paddingTop: (groups.length ? GROUP_HEIGHT : 0) + HEADER_HEIGHT, paddingHorizontal: Spacing.lg }}>
              <Text style={[styles.muted, { lineHeight: ROW_HEIGHT }]}>Loading…</Text>
            </View>
          ) : (
            <View>
              {groups.length > 0 && (
                <View style={[styles.row, { height: GROUP_HEIGHT }]}>
                  {groups.map((g, i) => (
                    <View key={i} style={[styles.groupCell, { width: g.span * COLUMN_WIDTH }]}>
                      <Text style={styles.groupText} numberOfLines={1}>
                        {g.label}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
              <View style={[styles.row, { height: HEADER_HEIGHT }]}>
                {columns.map((c) => (
                  <View key={c.key} style={[styles.numCell, { width: COLUMN_WIDTH }]}>
                    <Text style={styles.headText} numberOfLines={1}>
                      {c.label}
                    </Text>
                  </View>
                ))}
              </View>
              {rows.map((r, i) => (
                <View key={r.id} style={[styles.row, { height: ROW_HEIGHT }, i > 0 && styles.divided]}>
                  {columns.map((c) => (
                    <View key={c.key} style={[styles.numCell, { width: COLUMN_WIDTH }]}>
                      <Cell column={c} value={current.rows[r.id]?.[c.key] ?? null} />
                    </View>
                  ))}
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
      {current?.note && <Text style={styles.note}>{current.note}</Text>}
    </NeonPanel>
  );
}

function groupSpans(columns: PlayerViewColumn[]): { label: string; span: number }[] {
  if (!columns.some((c) => c.group)) return [];
  const spans: { label: string; span: number }[] = [];
  for (const c of columns) {
    const label = c.group ?? '';
    const last = spans[spans.length - 1];
    if (last && last.label === label) last.span += 1;
    else spans.push({ label, span: 1 });
  }
  return spans;
}

function formatOrdinal(rank: number): string {
  const r100 = rank % 100;
  if (r100 >= 11 && r100 <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}

// Same thresholds as the web's rankColorVar: a tough matchup (top 10
// defense) red, a soft one (23rd+) green.
function rankColor(rank: number): string {
  if (rank <= 10) return Colors.live;
  if (rank <= 22) return Colors.textSecondary;
  return Colors.win;
}

function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function Cell({ column, value }: { column: PlayerViewColumn; value: string | number | null }) {
  let text: string;
  let color: string | undefined;
  if (value === null || value === undefined || value === '') text = '-';
  else if (typeof value === 'string') text = value;
  else {
    switch (column.format) {
      case 'int':
        text = String(Math.round(value));
        break;
      case 'number1':
        text = value.toFixed(1);
        break;
      case 'number2':
        text = String(Number(value.toFixed(2)));
        break;
      case 'ordinal':
        text = formatOrdinal(value);
        break;
      case 'ordinal_matchup':
        text = formatOrdinal(value);
        color = rankColor(value);
        break;
      case 'signed_int':
        text = `${value > 0 ? '+' : ''}${compact(value)}`;
        color = value > 0 ? '#10b981' : value < 0 ? '#ef4444' : undefined;
        break;
      default:
        text = String(value);
    }
  }
  return (
    <Text style={[styles.value, color ? { color } : null]} numberOfLines={1}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.6 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: '#000',
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  pillText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  pillChevron: { color: '#fff', fontSize: 10 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg, backgroundColor: Colors.surface },
  sheetHead: { alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.1)' },
  sheetTitle: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  sheetClose: { position: 'absolute', right: Spacing.lg },
  sheetCloseText: { color: 'rgba(255,255,255,0.6)', fontSize: 14 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  optionText: { color: Colors.text, fontSize: 15 },
  sections: { gap: Spacing.lg },
  section: { gap: 6 },
  sectionLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  tableCard: { padding: 0 },
  table: { flexDirection: 'row' },
  pinned: { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: 'rgba(255,255,255,0.08)' },
  pinnedCell: { justifyContent: 'center', paddingHorizontal: Spacing.md },
  headCell: { justifyContent: 'center', paddingHorizontal: Spacing.md },
  headText: { color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  row: { flexDirection: 'row' },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.05)' },
  groupCell: { alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 3, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.1)' },
  groupText: { color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  numCell: { alignItems: 'flex-end', justifyContent: 'center', paddingHorizontal: 6 },
  value: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontVariant: ['tabular-nums'] },
  muted: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  error: { color: '#ef4444', fontSize: 14 },
  note: { color: 'rgba(255,255,255,0.4)', fontSize: 11, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
});
