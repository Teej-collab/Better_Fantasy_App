import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppRefreshControl } from '@/components/AppRefreshControl';
import { ListPanel, Muted, PageTitle, SeasonTabs, SmallHeader } from '@/components/league/LeagueUI';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Colors, Radius, SectionColors, Spacing } from '@/constants/theme';
import { openPlayer, useSeasonDraftGrades, useSeasons } from '@/lib/queries';
import type { DraftPick } from '@/lib/types';

// Same grade colors as the web's DraftGradesLeaderboard.
const GRADE_COLOR: Record<string, [string, string]> = {
  A: ['#34d399', 'rgba(16,185,129,0.15)'],
  B: ['#38bdf8', 'rgba(14,165,233,0.15)'],
  C: ['#fbbf24', 'rgba(245,158,11,0.15)'],
  D: ['#fb923c', 'rgba(249,115,22,0.15)'],
  F: ['#f87171', 'rgba(239,68,68,0.15)'],
};

// Port of the web's /seasons/[season]/draft: each team's draft grade
// with its write-up, then the full draft board by round.
export default function DraftGradesScreen() {
  const params = useLocalSearchParams<{ season: string }>();
  const seasons = useSeasons().data ?? [];
  const [season, setSeason] = useState(Number(params.season));
  const q = useSeasonDraftGrades(season);
  const [open, setOpen] = useState<number | null>(null);

  const picks = useMemo(() => q.data?.picks ?? [], [q.data]);
  const grades = [...(q.data?.grades ?? [])].sort((a, b) => b.percentile - a.percentile);
  const teamByOwner = useMemo(() => new Map(picks.map((p) => [p.owner_id, p.owner_name])), [picks]);
  const rounds = useMemo(() => {
    const byRound = new Map<number, DraftPick[]>();
    for (const p of picks) byRound.set(p.round, [...(byRound.get(p.round) ?? []), p]);
    return [...byRound.entries()].sort((a, b) => a[0] - b[0]);
  }, [picks]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" refreshControl={<AppRefreshControl />}>
      <Stack.Screen options={{ title: 'Draft' }} />
      <PageTitle>Draft</PageTitle>
      <SeasonTabs seasons={seasons} active={season} onSelect={setSeason} />
      {q.isPending ? (
        <LoadingState />
      ) : !q.data ? (
        <Muted>No draft found for {season}.</Muted>
      ) : (
        <>
          {grades.length === 0 ? (
            <Muted>
              Draft grades haven&apos;t been computed for {season} yet — they appear automatically shortly after the real draft
              finishes.
            </Muted>
          ) : (
            <View style={styles.gap}>
              <SmallHeader>Draft Grades</SmallHeader>
              <ListPanel color={SectionColors.draft}>
                {grades.map((g, i) => {
                  const [color, bg] = GRADE_COLOR[g.letter_grade] ?? [Colors.text, 'rgba(255,255,255,0.1)'];
                  const isOpen = open === g.owner_id;
                  const narrative = q.data?.narratives[String(g.owner_id)];
                  return (
                    <View key={g.owner_id} style={[styles.gradeRow, i > 0 && styles.divided]}>
                      <Pressable onPress={() => setOpen(isOpen ? null : g.owner_id)} style={styles.gradeHead}>
                        <View style={[styles.grade, { backgroundColor: bg }]}>
                          <Text style={[styles.gradeText, { color }]}>{g.letter_grade}</Text>
                        </View>
                        <View style={styles.flex}>
                          <Text style={styles.name}>{teamByOwner.get(g.owner_id) ?? g.owner_name}</Text>
                          <Text style={styles.small}>
                            {Math.round(g.percentile)}th percentile · {g.total_projected_points.toFixed(1)} pts drafted
                          </Text>
                        </View>
                        <Text style={styles.toggle}>{isOpen ? 'Hide recap ▲' : 'Read recap ▼'}</Text>
                      </Pressable>
                      {isOpen && (
                        <View style={styles.recap}>
                          <Text style={narrative ? styles.recapText : styles.small}>
                            {narrative ?? 'No write-up generated yet for this team.'}
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                })}
              </ListPanel>
            </View>
          )}

          <View style={styles.gap}>
            <SmallHeader>Full Draft Board</SmallHeader>
            {rounds.map(([round, roundPicks]) => (
              <View key={round} style={styles.gapSm}>
                <Text style={styles.round}>Round {round}</Text>
                {roundPicks
                  .sort((a, b) => a.pick_number - b.pick_number)
                  .map((p) => (
                    <Pressable
                      key={p.pick_number}
                      disabled={!p.sleeper_player_id}
                      onPress={() => openPlayer(p.sleeper_player_id)}
                      style={styles.pick}>
                      <Text style={styles.pickNumber}>
                        {p.round}.{String(p.round_pick).padStart(2, '0')}
                      </Text>
                      <View style={styles.flex}>
                        <Text style={styles.name}>
                          {p.player_name ?? '—'}
                          {p.player_position ? `  ${p.player_position === 'DEF' ? 'D/ST' : p.player_position}` : ''}
                          {p.is_keeper ? '  (K)' : p.is_autopick ? '  (auto)' : ''}
                        </Text>
                        <Text style={styles.small}>{p.owner_name}</Text>
                      </View>
                    </Pressable>
                  ))}
              </View>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.lg },
  gap: { gap: Spacing.md },
  gapSm: { gap: 4 },
  flex: { flex: 1 },
  gradeRow: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.06)' },
  gradeHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  grade: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  gradeText: { fontSize: 16, fontWeight: '700' },
  name: { color: Colors.text, fontSize: 14, fontWeight: '500' },
  small: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  toggle: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  recap: { marginTop: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.tileRaised, padding: Spacing.md },
  recapText: { color: Colors.text, fontSize: 14, lineHeight: 20 },
  round: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginTop: Spacing.sm },
  pick: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.surface },
  pickNumber: { width: 40, color: 'rgba(255,255,255,0.5)', fontSize: 13, fontVariant: ['tabular-nums'] },
});
