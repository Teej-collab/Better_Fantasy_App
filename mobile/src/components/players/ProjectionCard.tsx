import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { Card } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { formatPoints } from '@/lib/format';
import type { LeagueProjection } from '@/lib/types';

// The player screen's projection (2026-11-05): this week's number in the
// league's own scoring with its floor-to-ceiling range, what each source
// says, the stat line and the inputs behind it, the odds of the bonuses
// this league pays, and the rest of the season week by week.
const SOURCE_LABEL = { model: 'Ours', espn: 'ESPN', sleeper: 'Sleeper' } as const;
const STAT_LABEL: Record<string, string> = {
  pass_yd: 'pass yds', pass_td: 'pass TD', pass_int: 'INT', rush_att: 'car', rush_yd: 'rush yds', rush_td: 'rush TD',
  tgt: 'tgt', rec: 'rec', rec_yd: 'rec yds', rec_td: 'rec TD', fg_made_0_39: 'FG <40', fg_made_40_49: 'FG 40s',
  fg_made_50_plus: 'FG 50+', xp_made: 'XP', def_sack: 'sacks', def_int: 'INT', def_fum_rec: 'FR',
  pts_allow: 'pts allowed', idp_tackle: 'tkl', idp_sack: 'sacks', idp_int: 'INT', idp_pass_def: 'PD',
};
const BONUS_LABEL: Record<string, string> = {
  bonus_pass_300: '300+ pass yds', bonus_pass_400: '400+ pass yds', bonus_rush_100: '100+ rush yds',
  bonus_rush_200: '200+ rush yds', bonus_rec_100: '100+ rec yds', bonus_rec_200: '200+ rec yds',
};

function statText(key: string, value: number): string {
  const digits = key.endsWith('_yd') || key === 'pts_allow' ? 0 : 1;
  return `${value.toFixed(digits)} ${STAT_LABEL[key] ?? key}`;
}

export function ProjectionCard({ projection }: { projection: LeagueProjection }) {
  const { points, floor, ceiling, by_source, stat_line, why, bonus_odds, rest_of_season } = projection;
  const range = floor !== null && ceiling !== null && ceiling > floor ? ceiling - floor : null;
  const marker = range ? Math.min(1, Math.max(0, (points - floor!) / range)) : 0.5;
  const stats = Object.entries(stat_line).filter(([k, v]) => STAT_LABEL[k] && v >= 0.05 && k !== 'tgt');
  const bonuses = Object.entries(bonus_odds).filter(([k]) => BONUS_LABEL[k]);
  return (
    <Card style={styles.card}>
      <View style={styles.top}>
        <View>
          <Text style={styles.kicker}>Week {projection.week} projection</Text>
          <Text style={styles.points}>{formatPoints(points)}</Text>
        </View>
        <View style={styles.sources}>
          {(['model', 'espn', 'sleeper'] as const).map((s) =>
            by_source[s] !== undefined ? (
              <View key={s} style={styles.source}>
                <Text style={styles.sourceLabel}>{SOURCE_LABEL[s]}</Text>
                <Text style={styles.sourceValue}>{formatPoints(by_source[s])}</Text>
              </View>
            ) : null,
          )}
        </View>
      </View>
      {range !== null && (
        <View accessible accessibilityLabel={`Floor ${formatPoints(floor)}, ceiling ${formatPoints(ceiling)}`}>
          <View style={styles.bar}>
            <View style={[styles.marker, { left: `${marker * 100}%` }]} />
          </View>
          <View style={styles.barLabels}>
            <Text style={styles.muted}>Floor {formatPoints(floor)}</Text>
            <Text style={styles.muted}>Ceiling {formatPoints(ceiling)}</Text>
          </View>
        </View>
      )}
      {stats.length > 0 && <Text style={styles.line}>{stats.map(([k, v]) => statText(k, v)).join(' · ')}</Text>}
      {why?.team && (
        <Text style={styles.muted}>
          {why.implied !== undefined
            ? `${why.team} is projected for ${why.implied} points vs ${why.opp}`
            : why.opp_implied !== undefined
              ? `${why.opp} is projected for ${why.opp_implied} points vs ${why.team}`
              : `${why.team} vs ${why.opp}`}
          {why.matchup !== undefined && why.matchup !== 1
            ? ` · ${why.matchup > 1 ? 'soft' : 'tough'} matchup for the position`
            : ''}
        </Text>
      )}
      {bonuses.length > 0 && (
        <Text style={styles.muted}>
          {bonuses.map(([k, v]) => `${Math.round(v * 100)}% chance of ${BONUS_LABEL[k]}`).join(' · ')}
        </Text>
      )}
      {rest_of_season.length > 0 && (
        <View style={styles.ros}>
          {rest_of_season.slice(0, 8).map((w) => (
            <View key={w.week} style={styles.rosWeek}>
              <Text style={styles.rosLabel}>W{w.week}</Text>
              <Text style={styles.rosValue}>{formatPoints(w.points)}</Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.sm },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  kicker: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  points: { color: Colors.text, fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'] },
  sources: { flexDirection: 'row', gap: Spacing.md },
  source: { alignItems: 'center' },
  sourceLabel: { color: Colors.textSecondary, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  sourceValue: { color: Colors.text, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  bar: { height: 6, borderRadius: 3, backgroundColor: Colors.border, marginTop: 4 },
  marker: { position: 'absolute', top: -4, width: 4, height: 14, marginLeft: -2, borderRadius: 2, backgroundColor: Colors.accent },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  line: { color: Colors.text, fontSize: 13, lineHeight: 18 },
  muted: { color: Colors.textSecondary, fontSize: 12, lineHeight: 17 },
  ros: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  rosWeek: { alignItems: 'center', minWidth: 40, paddingVertical: 4, paddingHorizontal: 6, borderRadius: 8, backgroundColor: Colors.tileRaised },
  rosLabel: { color: Colors.textSecondary, fontSize: 10, fontWeight: '700' },
  rosValue: { color: Colors.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
