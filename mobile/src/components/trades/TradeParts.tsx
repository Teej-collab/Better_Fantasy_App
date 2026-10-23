import { Pressable, StyleSheet, View } from 'react-native';

import { TONES } from '@/components/commissioner/CommishParts';
import { Text } from '@/components/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import type { Trade, TradeEvaluation, TradeValuePlayer } from '@/lib/types';

// The Trades overhaul's shared pieces (2026-10-23, the approved "Trades"
// mockups 4–6): the fairness meter, a trade's one-line value read, the
// starting-lineup before → after list and the drop picker. Values are
// rest-of-season points a week (backend app/domain/trade_values.py).

export const YOU = TONES.blue;
export const THEM = TONES.orange;
const EVEN = TONES.green;

export function pos(position: string | null | undefined): string {
  return position === 'DEF' ? 'D/ST' : (position ?? '');
}

export function pts(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}`;
}

/** "Good for you · +3.4 pts a week" — the read on a trade you're in. */
export function verdictFor(change: number): { text: string; color: string } {
  if (Math.abs(change) < 1.5) return { text: `Looks even · ${pts(change)} pts a week for you`, color: EVEN };
  if (change > 0) return { text: `Good for you · ${pts(change)} pts a week`, color: YOU };
  return { text: `Favors them · ${pts(change)} pts a week for you`, color: THEM };
}

/** A league trade between two other teams: which side it leans to. */
export function leanFor(trade: Trade): string | null {
  const v = trade.value;
  if (!v) return null;
  if (v.verdict === 'even') return 'Looks even';
  if (v.verdict !== 'leans') return null;
  const name = v.leans_team_id === trade.proposing_team_id ? trade.proposing_team_name : trade.receiving_team_name;
  return `Leans ${name ?? 'one side'}`;
}

export function ValueMeter({ change, empty }: { change: number; empty?: boolean }) {
  const needle = Math.max(4, Math.min(96, 50 + change * 4));
  const v = verdictFor(change);
  return (
    <View style={styles.meter}>
      <View style={styles.meterHead}>
        <Text style={styles.kicker}>Trade value</Text>
        <Text style={[styles.meterVerdict, { color: empty ? Colors.textSecondary : v.color }]}>
          {empty ? 'Pick players on both sides' : v.text.split(' · ')[0]}
        </Text>
      </View>
      <View style={styles.track} accessibilityLabel={empty ? undefined : v.text}>
        <View style={[styles.trackSide, { backgroundColor: `${THEM}55` }]} />
        <View style={styles.trackMid} />
        <View style={[styles.trackSide, { backgroundColor: `${YOU}55` }]} />
        {!empty && <View style={[styles.needle, { left: `${needle}%` }]} />}
      </View>
      <View style={styles.meterLabels}>
        <Text style={styles.tiny}>Better for them</Text>
        <Text style={styles.tiny}>{empty ? 'Even' : `${pts(change)} / wk`}</Text>
        <Text style={styles.tiny}>Better for you</Text>
      </View>
    </View>
  );
}

export function LineupChange({ lineup, title = 'Your starting lineup, before → after' }: { lineup: TradeEvaluation['my_lineup']; title?: string }) {
  const color = Math.abs(lineup.change) < 0.5 ? Colors.textSecondary : lineup.change > 0 ? YOU : THEM;
  return (
    <View style={styles.card}>
      <View style={styles.meterHead}>
        <Text style={styles.kicker}>{title}</Text>
        <Text style={[styles.lineupTotal, { color }]}>{pts(lineup.change)} / wk</Text>
      </View>
      {lineup.slots.length === 0 ? (
        <Text style={styles.muted}>Your starters stay the same.</Text>
      ) : (
        lineup.slots.map((s, i) => (
          <View key={`${s.slot}-${i}`} style={styles.slotRow}>
            <Text style={styles.slot}>{s.slot}</Text>
            <Text style={styles.slotNames} numberOfLines={2}>
              {s.before ?? 'Empty'} <Text style={styles.muted}>→</Text> <Text style={styles.bold}>{s.after ?? 'Empty'}</Text>
            </Text>
            <Text style={[styles.slotDelta, { color: s.delta >= 0 ? YOU : THEM }]}>{pts(s.delta)}</Text>
          </View>
        ))
      )}
    </View>
  );
}

export function DropPicker({
  needed,
  candidates,
  selected,
  onToggle,
}: {
  needed: number;
  candidates: TradeValuePlayer[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (needed <= 0) return null;
  return (
    <View style={[styles.card, { borderColor: `${TONES.yellow}66` }]}>
      <Text style={styles.bodyBold}>
        {needed === 1 ? 'Your roster is full: pick someone to drop' : `Your roster is full: pick ${needed} players to drop`}
      </Text>
      <Text style={styles.muted}>They’re dropped only when the trade goes through.</Text>
      <View style={styles.chips}>
        {candidates.map((c) => {
          const on = selected.includes(c.id);
          return (
            <Pressable
              key={c.id}
              onPress={() => {
                haptics.select();
                onToggle(c.id);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[styles.chip, on && { borderColor: TONES.yellow, backgroundColor: `${TONES.yellow}22` }]}>
              <Text style={styles.chipText}>{c.name}</Text>
              <Text style={styles.tiny}>
                {pos(c.position)} · {c.per_week.toFixed(1)}/wk
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export const tradeStyles = StyleSheet.create({
  kicker: { color: Colors.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  muted: { color: Colors.textSecondary, fontSize: 13 },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', padding: Spacing.md, gap: Spacing.sm },
});

const styles = StyleSheet.create({
  ...tradeStyles,
  meter: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: Spacing.md, gap: 8 },
  meterHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: Spacing.sm },
  meterVerdict: { fontSize: 15, fontWeight: '800', flexShrink: 1, textAlign: 'right' },
  track: { height: 12, borderRadius: 6, flexDirection: 'row', overflow: 'visible' },
  trackSide: { flex: 2, height: 12 },
  trackMid: { flex: 1, height: 12, backgroundColor: 'rgba(255,255,255,0.12)' },
  needle: { position: 'absolute', top: -4, width: 6, height: 20, marginLeft: -3, borderRadius: 3, backgroundColor: Colors.text },
  meterLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  tiny: { color: Colors.textSecondary, fontSize: 11 },
  lineupTotal: { fontSize: 14, fontWeight: '800' },
  slotRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)' },
  slot: { width: 44, color: Colors.textSecondary, fontSize: 12, fontWeight: '800' },
  slotNames: { flex: 1, color: Colors.text, fontSize: 13 },
  slotDelta: { width: 48, textAlign: 'right', fontSize: 13, fontWeight: '800' },
  bold: { fontWeight: '700', color: Colors.text },
  bodyBold: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  chipText: { color: Colors.text, fontSize: 13, fontWeight: '700' },
});
