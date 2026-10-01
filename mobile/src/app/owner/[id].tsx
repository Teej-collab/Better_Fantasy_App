import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppRefreshControl } from '@/components/AppRefreshControl';
import { PageTitle, SeasonTabs } from '@/components/league/LeagueUI';
import { NeonPanel } from '@/components/NeonPanel';
import { Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { Colors, Radius, SectionColors, Spacing } from '@/constants/theme';
import { useCareerProfile, useOwnerBadges, useOwnerDraftGrade, useSeasonProfile, useSeasons } from '@/lib/queries';
import type { PeriodSummary } from '@/lib/types';

// Port of the web's /owners/[ownerId]: championship and award badges, a
// season's profile (with that season's draft grade), and the career.
export default function OwnerScreen() {
  const params = useLocalSearchParams<{ id: string; season?: string }>();
  const ownerId = Number(params.id);
  const seasons = useSeasons().data ?? [];
  const [season, setSeason] = useState<number | null>(params.season ? Number(params.season) : null);
  const shown = season ?? seasons[0] ?? null;
  const career = useCareerProfile(ownerId);
  const badges = useOwnerBadges(ownerId).data;
  const profile = useSeasonProfile(ownerId, shown);
  const draftGrade = useOwnerDraftGrade(shown, ownerId).data;

  if (career.isPending) return <LoadingState />;
  if (!career.data) return <MessageState message="No data for this owner." />;
  const c = career.data;
  const p = profile.data;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" refreshControl={<AppRefreshControl />}>
      <Stack.Screen options={{ title: c.team_name }} />
      <View style={styles.gapSm}>
        <PageTitle>{c.team_name}</PageTitle>
        {badges && (badges.championship_years.length > 0 || Object.keys(badges.award_summary).length > 0) && (
          <View style={styles.badges}>
            {badges.championship_years.length > 0 && (
              <View style={[styles.badge, styles.champBadge]}>
                <Text style={styles.champText}>
                  🏆 {badges.championship_years.length > 1 ? `${badges.championship_years.length}x Champion` : 'Champion'} (
                  {badges.championship_years.join(', ')})
                </Text>
              </View>
            )}
            {Object.entries(badges.award_summary).map(([type, years]) => (
              <View key={type} style={[styles.badge, styles.awardBadge]}>
                <Text style={styles.awardText}>
                  {years.length > 1 ? `${years.length}x ` : ''}
                  {type}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={styles.gap}>
        <Text style={styles.heading}>Season</Text>
        <SeasonTabs seasons={seasons} active={shown} onSelect={setSeason} />
        {profile.isPending ? (
          <LoadingState />
        ) : p ? (
          <View style={styles.gap}>
            <PeriodCard title="Regular season" summary={p.regular} />
            <PeriodCard title="Playoffs" summary={p.playoff} />
            <View style={styles.statGrid}>
              <Stat label="Best week" value={p.best_week ? `Wk ${p.best_week.week} — ${p.best_week.score}` : '—'} />
              <Stat label="Worst week" value={p.worst_week ? `Wk ${p.worst_week.week} — ${p.worst_week.score}` : '—'} />
              <Stat label="Avg luck" value={p.avg_luck ?? '—'} />
              <Stat label="Power rank" value={p.current_power_rank ?? '—'} />
              <Stat label="Draft grade" value={draftGrade?.grade?.letter_grade ?? '—'} />
            </View>
            {draftGrade?.narrative && <Text style={styles.narrative}>{draftGrade.narrative}</Text>}
          </View>
        ) : (
          <Text style={styles.muted}>No data for {shown}.</Text>
        )}
      </View>

      <View style={styles.gap}>
        <Text style={styles.heading}>
          Career ({c.seasons[0]}–{c.seasons[c.seasons.length - 1]})
        </Text>
        <PeriodCard title="Regular season" summary={c.regular} />
        <PeriodCard title="Playoffs" summary={c.playoff} />
        <View style={styles.statGrid}>
          <Stat label="Best season" value={c.best_season ? `${c.best_season.season} (${c.best_season.record})` : '—'} />
          <Stat label="Worst season" value={c.worst_season ? `${c.worst_season.season} (${c.worst_season.record})` : '—'} />
          <Stat
            label="Best week ever"
            value={c.best_week ? `${c.best_week.season} Wk ${c.best_week.week} — ${c.best_week.score}` : '—'}
          />
          <Stat
            label="Worst week ever"
            value={c.worst_week ? `${c.worst_week.season} Wk ${c.worst_week.week} — ${c.worst_week.score}` : '—'}
          />
        </View>
      </View>
    </ScrollView>
  );
}

function PeriodCard({ title, summary }: { title: string; summary: PeriodSummary | null }) {
  return (
    <NeonPanel color={SectionColors.league} contentStyle={styles.period}>
      <Text style={styles.periodTitle}>{title}</Text>
      {summary ? (
        <View style={styles.periodStats}>
          <Stat label="Record" value={summary.record} />
          <Stat label="PF" value={summary.pf} />
          <Stat label="PA" value={summary.pa} />
        </View>
      ) : (
        <Text style={styles.muted}>No games</Text>
      )}
    </NeonPanel>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.xl },
  gap: { gap: Spacing.md },
  gapSm: { gap: Spacing.sm },
  heading: { color: Colors.text, fontSize: 16, fontWeight: '500' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  badge: { borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  champBadge: { backgroundColor: 'rgba(251,191,36,0.2)' },
  champText: { color: '#fcd34d', fontSize: 12, fontWeight: '500' },
  awardBadge: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  awardText: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  period: { gap: Spacing.sm },
  periodTitle: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: '500' },
  periodStats: { flexDirection: 'row' },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: Spacing.md },
  stat: { width: '50%', minWidth: 90, flexGrow: 1, flexBasis: '33%' },
  statLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  statValue: { color: Colors.text, fontSize: 14, fontWeight: '500', fontVariant: ['tabular-nums'] },
  narrative: { color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 20 },
  muted: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
});
