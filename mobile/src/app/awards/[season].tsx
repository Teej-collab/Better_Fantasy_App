import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppRefreshControl } from '@/components/AppRefreshControl';
import { ANTON, Elite, EliteCard, EliteChips, EliteLabel, eliteText, EliteTitle, Hex, initials, PodiumBoard } from '@/components/elite/Elite';
import { Muted, openOwner } from '@/components/league/LeagueUI';
import { ShareableCard } from '@/components/ShareableCard';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { AWARD_DESCRIPTIONS } from '@/lib/awardDescriptions';
import { useAwardLeaderboards, useRecordBook, useSeasonAwards, useSeasons } from '@/lib/queries';
import type { RecordCategory, SeasonAwards } from '@/lib/types';

// Port of the web's /seasons/[season]/awards and its All-Time Records
// tab: a season's champion and awards, or the record book and all-time
// award leaderboards. Elite pass (2026-10-31): the Trophy Wall — the
// champion's plate, Boom Week up top, then Glory and Shame cells.
export default function AwardsScreen() {
  const params = useLocalSearchParams<{ season: string }>();
  const seasons = useSeasons().data ?? [];
  const [season, setSeason] = useState(Number(params.season));
  const [allTime, setAllTime] = useState(false);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" refreshControl={<AppRefreshControl />}>
      <Stack.Screen options={{ title: 'Awards' }} />
      <EliteTitle kicker={allTime ? 'The All-Time' : `The ${season}`} title="Trophy Wall" />
      <EliteChips
        seasons={seasons}
        active={season}
        onSelect={(s) => {
          setSeason(s);
          setAllTime(false);
        }}
        extra={{ label: 'All-Time Records', active: allTime, onPress: () => setAllTime(true) }}
      />
      {allTime ? <AllTime /> : <SeasonAwardsView season={season} latest={seasons[0] === season} />}
    </ScrollView>
  );
}

// The awards nobody wants (the web groups them the same way).
const SHAME = new Set(['Bust Week', 'Choke Artist', 'Cold Streak', 'Luckiest Win', 'Snakebit Award', 'Underachiever', 'League Loser']);
const HERO = 'Boom Week';

type Award = SeasonAwards['awards'][number];

// The number an award is about ("179.18 pts" → 179.18, "+177.59 pts vs.
// expected" → +178), short enough for a cell; the winner's initials when
// there isn't one.
function cellValue(a: Award): string {
  const m = a.detail?.match(/([+\-−]?)(\d+(?:\.\d+)?)/);
  if (!m) return initials(a.owner_name);
  const n = Number(m[2]);
  const sign = m[1] === '+' ? '+' : m[1] ? '−' : '';
  const body = n >= 100 ? String(Math.round(n)) : m[2].includes('.') ? n.toFixed(1) : String(n);
  return `${sign}${body}`;
}

function SeasonAwardsView({ season, latest }: { season: number; latest: boolean }) {
  const q = useSeasonAwards(season);
  if (q.isPending) return <LoadingState />;
  const champion = q.data?.champion;
  const awards = q.data?.awards ?? [];
  const hero = awards.find((a) => a.award_type === HERO) ?? null;
  const rest = awards.filter((a) => a !== hero);
  const glory = rest.filter((a) => !SHAME.has(a.award_type));
  const shame = rest.filter((a) => SHAME.has(a.award_type));
  return (
    <View style={styles.gap}>
      {/* The champion and the season's awards go to the group chat as images (2026-10-24). */}
      {champion ? (
        <ShareableCard title={`${season} champion: ${champion.team_name}`}>
          <EliteCard tone="orange" style={styles.plate}>
            <TrophyCell />
            <View style={styles.flex}>
              <Text style={[eliteText.kickerCaps, { color: Elite.peach }]}>CHAMPION</Text>
              <Text style={styles.plateName}>{champion.team_name.toUpperCase()}</Text>
              <Pressable onPress={() => openOwner(champion.owner_id)} hitSlop={6}>
                <Text style={eliteText.small}>{champion.owner_name}</Text>
              </Pressable>
            </View>
          </EliteCard>
        </ShareableCard>
      ) : (
        latest && (
          <EliteCard tone="orange" style={styles.plate}>
            <TrophyCell />
            <View style={styles.flex}>
              <Text style={[eliteText.kickerCaps, { color: Elite.peach }]}>CHAMPION</Text>
              <Text style={styles.plateName}>STILL UP FOR GRABS</Text>
              <Text style={eliteText.small}>Crowned after the title game</Text>
            </View>
          </EliteCard>
        )
      )}
      {awards.length === 0 ? (
        <Muted>No awards recorded for {season} yet.</Muted>
      ) : (
        <ShareableCard title={`${season} season awards`}>
          <View style={styles.gap}>
            {hero && (
              <Pressable onPress={() => openOwner(hero.owner_id)} accessibilityRole="button">
                <EliteCard tone="green" style={styles.hero}>
                  <Hex width={68} color={Elite.green} fill="#0f1a12" glow>
                    <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
                      {cellValue(hero)}
                    </Text>
                  </Hex>
                  <View style={styles.flex}>
                    <Text style={[eliteText.kickerCaps, { color: Elite.green }]}>{hero.award_type.toUpperCase()}</Text>
                    <Text style={styles.heroName}>{hero.owner_name}</Text>
                    {hero.detail && <Text style={eliteText.small}>{hero.detail}</Text>}
                  </View>
                </EliteCard>
              </Pressable>
            )}
            {glory.length > 0 && <AwardGrid label="GLORY" color={Elite.green} awards={glory} />}
            {shame.length > 0 && <AwardGrid label="SHAME" color={Elite.orange} awards={shame} />}
          </View>
        </ShareableCard>
      )}
    </View>
  );
}

function TrophyCell() {
  return (
    <Hex width={74} color={Elite.peach} fill={Elite.orange} glow>
      <Text style={styles.trophy}>🏆</Text>
    </Hex>
  );
}

function AwardGrid({ label, color, awards }: { label: string; color: string; awards: Award[] }) {
  return (
    <View style={styles.gapSm}>
      <EliteLabel color={color === Elite.orange ? '#ff9a4a' : color}>{label}</EliteLabel>
      <View style={styles.grid}>
        {awards.map((a, i) => (
          <Pressable
            key={`${a.award_type}-${i}`}
            onPress={() => openOwner(a.owner_id)}
            style={({ pressed }) => [styles.tile, pressed && { opacity: 0.75 }]}
            accessibilityRole="button"
            accessibilityLabel={`${a.award_type}: ${a.owner_name}${a.detail ? `, ${a.detail}` : ''}`}>
            <Hex width={56} color={color}>
              <Text style={[styles.tileValue, { color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                {cellValue(a)}
              </Text>
            </Hex>
            <Text style={styles.tileTitle}>{a.award_type}</Text>
            <Text style={styles.tileWinner}>{a.owner_name}</Text>
            {a.detail && <Text style={styles.tileDetail}>{a.detail}</Text>}
          </Pressable>
        ))}
      </View>
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

// The web's RecordBook + AwardLeaderboards, as podiums.
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
            <EliteLabel color={Elite.green}>ALL-TIME RECORDS</EliteLabel>
            <Text style={eliteText.small}>The league&apos;s history, updated the moment a record is broken.</Text>
          </View>
          {categories.map((c) => (
            <PodiumBoard
              key={c.key}
              title={c.label}
              description={AWARD_DESCRIPTIONS[c.key]}
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
            <EliteLabel color={Elite.green}>ALL-TIME AWARDS</EliteLabel>
            <Text style={eliteText.small}>Every yearly award the league hands out, and who&apos;s won it the most.</Text>
          </View>
          {awards.map((c) => (
            <PodiumBoard
              key={c.key}
              title={c.label}
              description={AWARD_DESCRIPTIONS[c.key]}
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
  gapSm: { gap: Spacing.sm },
  gapLg: { gap: Spacing.xl },
  flex: { flex: 1 },
  plate: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 },
  plateName: { fontFamily: ANTON, fontSize: 24, lineHeight: 30, color: Elite.cream },
  trophy: { fontSize: 30 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  heroValue: { fontFamily: ANTON, fontSize: 20, lineHeight: 24, color: Elite.green, maxWidth: 58, textAlign: 'center' },
  heroName: { color: Elite.cream, fontSize: 20, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48%', flexGrow: 1, alignItems: 'center', gap: 4, paddingTop: 14, paddingBottom: 12, paddingHorizontal: 10, borderRadius: 18, backgroundColor: Elite.card, borderWidth: 1, borderColor: Elite.line },
  tileValue: { fontFamily: ANTON, fontSize: 18, lineHeight: 22, maxWidth: 48, textAlign: 'center' },
  tileTitle: { color: Elite.cream, fontSize: 13, fontWeight: '800', textAlign: 'center', marginTop: 4 },
  tileWinner: { color: Elite.cream, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  tileDetail: { color: Elite.soft, fontSize: 11.5, textAlign: 'center' },
});
