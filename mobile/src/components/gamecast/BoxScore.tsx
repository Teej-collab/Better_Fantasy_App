import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { openPlayer } from '@/lib/queries';
import type { BoxScoreCategory, FantasyImpact, GamecastBoxScore } from '@/lib/types';

// The full box score, like ESPN's (2026-10): pick a team, then every
// category's table. A bar marks your players (green) and your opponent's
// (blue), from the same fantasy-impact data as the stake card. ESPN's
// tables are wider than a phone, so each shows the columns ESPN's own app
// does; the rest are a tap away on the player's card.
const COLUMNS: Record<string, string[]> = {
  passing: ['C/ATT', 'YDS', 'TD', 'INT'],
  rushing: ['CAR', 'YDS', 'TD', 'LONG'],
  receiving: ['REC', 'YDS', 'TD', 'TGTS'],
  fumbles: ['FUM', 'LOST', 'REC'],
  defensive: ['TOT', 'SACKS', 'TFL', 'PD'],
  interceptions: ['INT', 'YDS', 'TD'],
  kickReturns: ['NO', 'YDS', 'LONG', 'TD'],
  puntReturns: ['NO', 'YDS', 'LONG', 'TD'],
  kicking: ['FG', 'LONG', 'XP', 'PTS'],
  punting: ['NO', 'AVG', 'In 20', 'LONG'],
};
const OPPONENT = '#60a5fa';

function columnsFor(category: BoxScoreCategory): number[] {
  const wanted = COLUMNS[category.key] ?? [];
  const picked = wanted.map((label) => category.labels.indexOf(label)).filter((i) => i >= 0);
  return picked.length ? picked : category.labels.slice(0, 4).map((_, i) => i);
}

export function BoxScore({ box, impact, accent }: { box: GamecastBoxScore; impact: FantasyImpact | undefined; accent: string }) {
  const [teamIndex, setTeamIndex] = useState<number | null>(null);
  const mine = new Set((impact?.your_players ?? []).map((p) => String(p.player_id)));
  const theirs = new Set((impact?.opponent_players ?? []).map((p) => String(p.player_id)));
  if (box.teams.length === 0 || box.teams.every((t) => t.categories.length === 0)) return null;

  // Opens on the team with your players in it, else the away team.
  const withMine = box.teams.findIndex((t) => t.categories.some((c) => c.athletes.some((a) => a.player_id && mine.has(a.player_id))));
  const shown = box.teams[teamIndex ?? Math.max(0, withMine)] ?? box.teams[0];

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <Text style={styles.cardTitle}>Box Score</Text>
        {(mine.size > 0 || theirs.size > 0) && (
          <View style={styles.legend}>
            <View style={[styles.legendBar, { backgroundColor: accent }]} />
            <Text style={styles.legendText}>Yours</Text>
            <View style={[styles.legendBar, { backgroundColor: OPPONENT }]} />
            <Text style={styles.legendText}>Opponent</Text>
          </View>
        )}
      </View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {box.teams.map((t, i) => {
          const on = t === shown;
          return (
            <Pressable
              key={t.abbr}
              onPress={() => setTeamIndex(i)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              style={[styles.tab, on && { borderColor: accent, backgroundColor: Colors.tileRaised }]}>
              {t.logo ? <Image source={{ uri: t.logo }} style={styles.tabLogo} contentFit="contain" accessible={false} /> : null}
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{t.abbr}</Text>
            </Pressable>
          );
        })}
      </View>
      {shown.categories.map((category) => {
        const columns = columnsFor(category);
        return (
          <View key={category.key} style={styles.table}>
            <Text style={styles.category}>{category.title.toUpperCase()}</Text>
            <View style={[styles.row, styles.headRow]}>
              <Text style={[styles.nameCell, styles.head]}>PLAYER</Text>
              {columns.map((i) => (
                <Text key={i} style={[styles.statCell, styles.head]}>
                  {category.labels[i]}
                </Text>
              ))}
            </View>
            {category.athletes.map((a, rowIndex) => {
              const bar = a.player_id && mine.has(a.player_id) ? accent : a.player_id && theirs.has(a.player_id) ? OPPONENT : null;
              return (
                <Pressable
                  key={`${a.espn_id ?? rowIndex}`}
                  disabled={!a.player_id}
                  onPress={() => openPlayer(a.player_id)}
                  accessibilityRole={a.player_id ? 'button' : undefined}
                  accessibilityLabel={`${a.name ?? ''}${a.position ? `, ${a.position}` : ''}: ${columns.map((i) => `${category.labels[i]} ${a.stats[i] ?? '–'}`).join(', ')}`}
                  style={({ pressed }) => [styles.row, rowIndex % 2 === 0 && styles.striped, pressed && styles.pressed]}>
                  <View style={[styles.bar, bar ? { backgroundColor: bar } : null]} />
                  <Text style={styles.nameCell} numberOfLines={1}>
                    <Text style={styles.name}>{a.short_name ?? a.name ?? '—'}</Text>
                    {a.position ? <Text style={styles.position}>{` ${a.position}`}</Text> : null}
                  </Text>
                  {columns.map((i) => (
                    <Text key={i} style={styles.statCell}>
                      {a.stats[i] ?? '–'}
                    </Text>
                  ))}
                </Pressable>
              );
            })}
            {category.totals.length > 0 && (
              <View style={[styles.row, styles.totalRow]}>
                <Text style={[styles.nameCell, styles.total]}>TEAM</Text>
                {columns.map((i) => (
                  <Text key={i} style={[styles.statCell, styles.total]}>
                    {category.totals[i] || ''}
                  </Text>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg, gap: Spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendBar: { width: 3, height: 12, borderRadius: 1.5, marginLeft: 6 },
  legendText: { color: Colors.textSecondary, fontSize: 11 },
  tabs: { flexDirection: 'row', gap: Spacing.sm },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tabLogo: { width: 20, height: 20 },
  tabText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '700' },
  tabTextOn: { color: Colors.text },
  table: { gap: 2 },
  category: { color: Colors.text, fontSize: 13, fontWeight: '800', letterSpacing: 0.5, marginTop: Spacing.xs, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 36, paddingRight: 6 },
  headRow: { minHeight: 26, borderBottomWidth: 1, borderBottomColor: Colors.border, paddingLeft: 9 },
  striped: { backgroundColor: 'rgba(255,255,255,0.03)' },
  pressed: { opacity: 0.6 },
  bar: { width: 3, alignSelf: 'stretch', marginRight: 6, borderRadius: 1.5 },
  nameCell: { flex: 1, minWidth: 0 },
  name: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  position: { color: Colors.textSecondary, fontSize: 11 },
  head: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700' },
  statCell: { width: 52, textAlign: 'right', color: Colors.text, fontSize: 14, fontVariant: ['tabular-nums'] },
  totalRow: { borderTopWidth: 1, borderTopColor: Colors.border, paddingLeft: 9, minHeight: 30 },
  total: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700' },
});
