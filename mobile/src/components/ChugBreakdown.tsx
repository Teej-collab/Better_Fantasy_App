import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import type { ChugLedgerEvent } from '@/lib/types';

// "Why?" under a Chug Leaderboard row (port of the web's
// ChugBreakdown.tsx): the owner's chug history, one short line per
// event, folded away until tapped so the screen stays its usual size.

function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0';
}

function playerLabel(r: { player_name: string; position: string | null; points: number }): string {
  const name = r.position === 'DEF' || r.position === 'D/ST' ? `${r.player_name} D/ST` : r.player_name;
  return `${name} (${r.points < 0 ? `−${Math.abs(r.points)}` : r.points})`;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function describeChugEvent(e: ChugLedgerEvent): { label: string; detail: string } {
  switch (e.kind) {
    case 'earned':
      return {
        label: `Wk ${e.week}`,
        detail: e.reasons.length ? e.reasons.map(playerLabel).join(', ') : `${e.chugs} starter${e.chugs === 1 ? '' : 's'} scored 0 or less`,
      };
    case 'doubled':
      return { label: `Wk ${e.week} deadline`, detail: `Missed — doubled ${e.owed_before} → ${e.owed_after}` };
    case 'fined':
      return { label: `Wk ${e.week} deadline`, detail: `3rd miss — ${e.owed_before} chugs became a $${e.fine_amount ?? 0} fine` };
    case 'waived':
      return { label: `Wk ${e.week} deadline`, detail: 'Doubling waived by the commissioner' };
    case 'chug':
      return {
        label: new Date(e.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        detail: `Chug posted${e.score !== null ? ` · ${e.score.toFixed(1)}/10` : ''}${e.change === 0 ? ' · nothing owed, just for fun' : ''}`,
      };
    case 'paid':
      return {
        label: 'Paid',
        detail: `Paid Commissioner $${e.dollars}${e.amount > 1 ? ` (${e.amount} chugs)` : ''}${e.at ? ` · ${shortDate(e.at)}` : ''}`,
      };
    case 'fine_paid':
      return { label: 'Fine paid', detail: `Paid Commissioner $${e.dollars} fine${e.at ? ` · ${shortDate(e.at)}` : ''}` };
    case 'correction':
      return { label: 'Correction', detail: `${e.note || 'Commissioner correction'} · ${shortDate(e.at)}` };
    case 'adjustment':
      return { label: 'Adjustment', detail: 'Commissioner correction' };
  }
}

export function ChugBreakdown({ events }: { events: ChugLedgerEvent[] }) {
  const [open, setOpen] = useState(false);
  if (events.length === 0) return null;
  return (
    <View>
      <Pressable
        onPress={() => {
          haptics.select();
          setOpen((o) => !o);
        }}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? 'Hide chug history' : 'Why? Show chug history'}>
        <Text style={styles.toggle}>{open ? 'Hide ▴' : 'Why? ▾'}</Text>
      </Pressable>
      {open && (
        <View style={styles.list}>
          {events.map((e, i) => {
            const { label, detail } = describeChugEvent(e);
            return (
              <View
                key={i}
                style={[styles.row, i > 0 && styles.divided]}
                accessible
                accessibilityLabel={`${label}: ${detail}. ${signed(e.change)}, ${e.balance} owed after.`}>
                <Text style={styles.label}>{label}</Text>
                <Text style={styles.detail}>{detail}</Text>
                <Text style={[styles.change, e.change > 0 ? styles.up : e.change < 0 ? styles.down : styles.flat]}>{signed(e.change)}</Text>
                <Text style={styles.balance}>= {e.balance}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
  list: { marginTop: Spacing.xs, backgroundColor: Colors.tile, borderRadius: Radius.md, paddingHorizontal: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm, paddingVertical: 6 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  label: { width: 84, color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
  detail: { flex: 1, color: Colors.text, fontSize: 12, lineHeight: 17 },
  change: { width: 28, textAlign: 'right', fontFamily: Fonts.monoBold, fontSize: 12 },
  up: { color: '#fbbf24' },
  down: { color: Colors.win },
  flat: { color: Colors.textSecondary },
  balance: { width: 34, textAlign: 'right', fontFamily: Fonts.mono, fontSize: 12, color: Colors.textSecondary },
});
