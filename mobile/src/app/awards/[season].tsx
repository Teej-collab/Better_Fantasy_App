import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppRefreshControl } from '@/components/AppRefreshControl';
import { ListPanel, Muted, openOwner, PageTitle, RankedCategoryCard, SeasonTabs, SmallHeader } from '@/components/league/LeagueUI';
import { NeonPanel } from '@/components/NeonPanel';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Colors, SectionColors, Spacing } from '@/constants/theme';
import { AWARD_DESCRIPTIONS } from '@/lib/awardDescriptions';
import { useAwardLeaderboards, useRecordBook, useSeasonAwards, useSeasons } from '@/lib/queries';
import type { RecordCategory } from '@/lib/types';

// Port of the web's /seasons/[season]/awards and its All-Time Records
// tab: a season's champion and awards, or the record book and all-time
// award leaderboards.
export default function AwardsScreen() {
  const params = useLocalSearchParams<{ season: string }>();
  const seasons = useSeasons().data ?? [];
  const [season, setSeason] = useState(Number(params.season));
  const [allTime, setAllTime] = useState(false);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" refreshControl={<AppRefreshControl />}>
      <Stack.Screen options={{ title: 'Awards' }} />
      <PageTitle>Awards</PageTitle>
      <SeasonTabs
        seasons={seasons}
        active={season}
        onSelect={(s) => {
          setSeason(s);
          setAllTime(false);
        }}
        extra={{ label: 'All-Time Records', active: allTime, onPress: () => setAllTime(true) }}
      />
      {allTime ? <AllTime /> : <SeasonAwardsView season={season} />}
    </ScrollView>
  );
}

function SeasonAwardsView({ season }: { season: number }) {
  const q = useSeasonAwards(season);
  if (q.isPending) return <LoadingState />;
  const champion = q.data?.champion;
  const awards = q.data?.awards ?? [];
  return (
    <View style={styles.gap}>
      {champion && (
        <NeonPanel color={SectionColors.awards} contentStyle={styles.champion}>
          <Text style={styles.trophy}>🏆</Text>
          <View>
            <Text style={styles.name}>{champion.team_name}</Text>
            <Pressable onPress={() => openOwner(champion.owner_id)}>
              <Text style={styles.owner}>{champion.owner_name}</Text>
            </Pressable>
          </View>
        </NeonPanel>
      )}
      {awards.length === 0 ? (
        <Muted>No awards recorded for {season} yet.</Muted>
      ) : (
        <ListPanel color={SectionColors.awards}>
          {awards.map((a, i) => (
            <View key={i} style={[styles.row, i > 0 && styles.divided]}>
              <View style={styles.flex}>
                <Text style={styles.name}>{a.award_type}</Text>
                {a.detail && <Text style={styles.detail}>{a.detail}</Text>}
              </View>
              <Pressable onPress={() => openOwner(a.owner_id)}>
                <Text style={styles.owner}>{a.owner_name}</Text>
              </Pressable>
            </View>
          ))}
        </ListPanel>
      )}
    </View>
  );
}

function recordContext(entry: RecordCategory['entries'][number]): string {
  if (entry.opponent_team_name) {
    const own = entry.own_score !== undefined ? entry.own_score.toFixed(1) : null;
    return own
      ? `${own} – ${entry.opponent_score?.toFixed(1)} vs ${entry.opponent_team_name} · Season ${entry.season}${entry.week ? `, Wk ${entry.week}` : ''}`
      : `vs ${entry.opponent_team_name} · Season ${entry.season}`;
  }
  return entry.week ? `Season ${entry.season}, Week ${entry.week}` : `Season ${entry.season}`;
}

// The web's RecordBook + AwardLeaderboards.
function AllTime() {
  const records = useRecordBook();
  const leaders = useAwardLeaderboards();
  if (records.isPending || leaders.isPending) return <LoadingState />;
  const categories = (records.data ?? []).filter((c) => c.entries.length > 0);
  const awards = leaders.data ?? [];
  return (
    <View style={styles.gapLg}>
      {categories.length > 0 && (
        <View style={styles.gap}>
          <View>
            <SmallHeader>All-Time Records</SmallHeader>
            <Text style={styles.detail}>The league&apos;s history, updated the moment a record is broken.</Text>
          </View>
          {categories.map((c) => (
            <RankedCategoryCard
              key={c.key}
              emoji={c.emoji}
              label={c.label}
              description={AWARD_DESCRIPTIONS[c.key]}
              color={SectionColors.awards}
              entries={c.entries.map((e) => ({
                key: `${e.owner_id}-${e.season}-${e.week ?? 'season'}`,
                name: e.owner_name,
                value: `${e.value.toFixed(1)} ${c.unit}`,
                context: `${e.team_name} · ${recordContext(e)}`,
                onPress: () => openOwner(e.owner_id),
              }))}
            />
          ))}
        </View>
      )}
      {awards.length > 0 && (
        <View style={styles.gap}>
          <View>
            <SmallHeader>All-Time Awards</SmallHeader>
            <Text style={styles.detail}>Every yearly award the league hands out, and who&apos;s won it the most.</Text>
          </View>
          {awards.map((c) => (
            <RankedCategoryCard
              key={c.key}
              emoji={c.emoji}
              label={c.label}
              description={AWARD_DESCRIPTIONS[c.key]}
              color={SectionColors.awards}
              emptyMessage="Not yet awarded."
              entries={c.winners.map((w) => ({
                key: String(w.owner_id),
                name: w.owner_name,
                value: `${w.wins}x`,
                onPress: () => openOwner(w.owner_id),
              }))}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.lg },
  gap: { gap: Spacing.md },
  gapLg: { gap: Spacing.xl },
  champion: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  trophy: { fontSize: 26 },
  name: { color: Colors.text, fontSize: 15, fontWeight: '500' },
  owner: { color: 'rgba(255,255,255,0.6)', fontSize: 14 },
  detail: { color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 17 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.06)' },
  flex: { flex: 1 },
});
