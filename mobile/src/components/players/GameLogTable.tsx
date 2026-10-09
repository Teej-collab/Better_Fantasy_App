import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatPoints } from '@/lib/format';
import type { PlayerGameLog } from '@/lib/types';

// The game log like ESPN's (2026-10): pick a category, then a row per game
// — week, opponent and result, our fantasy points, and that category's
// box-score line. ESPN's full lines are wider than a phone, so each
// category shows the columns ESPN's own app does.
const COLUMNS: Record<string, string[]> = {
  passing: ['CMP', 'ATT', 'YDS', 'TD', 'INT'],
  rushing: ['CAR', 'YDS', 'TD', 'LNG'],
  receiving: ['REC', 'TGTS', 'YDS', 'TD'],
  fumbles: ['FUM', 'LST'],
  fieldgoals: ['FG', 'LNG', 'FG%'],
  pats: ['XP', 'PTS'],
};

function columnsFor(category: PlayerGameLog['categories'][number]): number[] {
  const wanted = COLUMNS[category.key] ?? [];
  const picked = wanted.map((label) => category.labels.indexOf(label)).filter((i) => i >= 0);
  return picked.length ? picked : category.labels.slice(0, 4).map((_, i) => i);
}

export function GameLogTable({ log, accent }: { log: PlayerGameLog; accent: string }) {
  const [selected, setSelected] = useState(0);
  const category = log.categories[selected] ?? log.categories[0];
  if (!category) return null;
  const columns = columnsFor(category);

  return (
    <View style={styles.wrap}>
      {log.categories.length > 1 && (
        <View style={styles.tabs} accessibilityRole="tablist">
          {log.categories.map((c, i) => {
            const on = c === category;
            return (
              <Pressable
                key={c.key}
                onPress={() => setSelected(i)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                style={[styles.tab, on && { backgroundColor: Colors.tileRaised, borderColor: accent }]}>
                <Text style={[styles.tabText, on && styles.tabTextOn]} numberOfLines={1}>
                  {c.title}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
      <View style={[styles.row, styles.head]}>
        <Text style={[styles.week, styles.headText]}>WK</Text>
        <Text style={[styles.opp, styles.headText]}>OPP</Text>
        <Text style={[styles.cell, styles.headText]}>FPTS</Text>
        {columns.map((i) => (
          <Text key={i} style={[styles.cell, styles.headText]}>
            {category.labels[i]}
          </Text>
        ))}
      </View>
      {log.games.map((game, r) => (
        <View
          key={game.week}
          style={[styles.row, r % 2 === 0 && styles.striped]}
          accessible
          accessibilityLabel={`Week ${game.week}, ${game.opponent ?? ''} ${game.result ?? ''}: ${formatPoints(game.fantasy_points)} points, ${columns
            .map((i) => `${category.labels[i]} ${game.stats[category.key]?.[i] ?? '–'}`)
            .join(', ')}`}>
          <Text style={styles.week}>{game.week}</Text>
          <View style={styles.opp}>
            <Text style={styles.oppText}>{game.opponent ?? '—'}</Text>
            {game.result && <Text style={styles.result}>{game.result}</Text>}
          </View>
          <Text style={[styles.cell, styles.points]}>{game.fantasy_points != null ? formatPoints(game.fantasy_points) : '–'}</Text>
          {columns.map((i) => (
            <Text key={i} style={styles.cell}>
              {game.stats[category.key]?.[i] ?? '–'}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 2 },
  tabs: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  tab: { flex: 1, paddingVertical: 7, borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  tabText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '700' },
  tabTextOn: { color: Colors.text },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 40, paddingHorizontal: 4 },
  head: { minHeight: 28, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headText: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700' },
  striped: { backgroundColor: 'rgba(255,255,255,0.03)' },
  week: { width: 28, color: Colors.textSecondary, fontSize: 13 },
  opp: { width: 62 },
  oppText: { color: Colors.text, fontSize: 13 },
  result: { color: Colors.textSecondary, fontSize: 10, marginTop: 1 },
  cell: { flex: 1, textAlign: 'right', color: Colors.text, fontSize: 13, fontVariant: ['tabular-nums'] },
  points: { fontWeight: '800' },
});
