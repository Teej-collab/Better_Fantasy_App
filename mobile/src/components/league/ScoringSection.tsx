import { StyleSheet, View } from 'react-native';

import { Card, LoadingState, MessageState } from '@/components/ui';
import { Text } from '@/components/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useScoringCatalog } from '@/lib/queries';
import { detailLabel, pointsLabel, scoredGroups, scoringSummary } from '@/lib/scoringDisplay';

// League → Scoring (2026-10-22): the league's full scoring rules, the
// way ESPN's league settings page lists them. Read-only; the
// commissioner changes them in Commissioner Tools → Scoring.

const GREEN = '#4ade80';
const RED = '#f87171';

export function ScoringSection() {
  const query = useScoringCatalog();
  if (query.isPending) return <LoadingState />;
  if (!query.data) return <MessageState message="Couldn't load the scoring rules." actionLabel="Try again" onAction={() => query.refetch()} />;
  const catalog = query.data;
  const groups = scoredGroups(catalog);
  return (
    <View style={styles.page}>
      <View style={styles.chips}>
        {scoringSummary(catalog).map((chip) => (
          <View key={chip} style={styles.chip}>
            <Text style={styles.chipText}>{chip}</Text>
          </View>
        ))}
      </View>
      {groups.map((group) => (
        <Card key={group.key} style={styles.card}>
          <Text style={styles.groupTitle} accessibilityRole="header">
            {group.label}
          </Text>
          {group.stats.map((stat, i) => {
            const value = stat.value ?? 0;
            return (
              <View key={stat.key} style={[styles.row, i > 0 && styles.divided]} accessible accessibilityLabel={`${stat.label}, ${pointsLabel(value)} points. ${detailLabel(stat)}`}>
                <View style={styles.flex}>
                  <Text style={styles.label}>{stat.label}</Text>
                  <Text style={styles.detail}>
                    {detailLabel(stat)}
                    {stat.tracked ? '' : ' · not tracked yet'}
                  </Text>
                </View>
                <Text style={[styles.value, { color: value < 0 ? RED : value > 0 ? GREEN : 'rgba(255,255,255,0.5)' }]}>{pointsLabel(value)}</Text>
              </View>
            );
          })}
        </Card>
      ))}
      <Text style={styles.foot}>
        {`${catalog.season} season. Anything not listed scores 0. Your commissioner sets these in Commissioner Tools.`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: Spacing.lg },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', backgroundColor: Colors.tile, paddingHorizontal: Spacing.md, paddingVertical: 6 },
  chipText: { color: Colors.text, fontSize: 13, fontWeight: '700' },
  card: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  groupTitle: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', paddingVertical: Spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm + 2 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)' },
  flex: { flex: 1, gap: 2 },
  label: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  detail: { color: 'rgba(255,255,255,0.55)', fontSize: 12 },
  value: { fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'], minWidth: 56, textAlign: 'right' },
  foot: { color: 'rgba(255,255,255,0.5)', fontSize: 12, textAlign: 'center' },
});
