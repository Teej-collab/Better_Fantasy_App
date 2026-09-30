import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { PlayerActionSheet } from '@/components/PlayerActionSheet';
import { Card, LoadingState, MessageState, SectionTitle } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatPoints } from '@/lib/format';
import { usePlayerCard } from '@/lib/queries';
import type { FreeAgent, PlayerCard } from '@/lib/types';

const CHART_HEIGHT = 96;

function positionLabel(position: string): string {
  return position === 'DEF' ? 'D/ST' : position;
}

function formatNewsDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// The add/claim sheet takes a free-agent row. Waiver status isn't on
// the card, so the sheet starts as an add; if the player turns out to
// be on waivers, the add comes back on_waivers and it becomes a claim.
function asFreeAgent(card: PlayerCard): FreeAgent {
  return {
    sleeper_player_id: card.sleeper_player_id,
    full_name: card.full_name,
    position: card.position,
    pro_team: card.pro_team,
    injury_status: card.injury_status,
    projected_points: card.projection?.season_avg_projected_points ?? null,
    score: null,
    last_week_score: card.latest_week?.fantasy_points ?? null,
    next_opponent: card.projection?.next_opponent ?? null,
    game_time: null,
    waiver_clears_at: null,
    game_locked: false,
  };
}

export default function PlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const card = usePlayerCard(id);
  const [adding, setAdding] = useState(false);

  if (card.isPending) return <LoadingState />;
  if (card.isError || !card.data) return <MessageState message="Couldn't load this player." />;
  const p = card.data;

  const bio = [
    p.jersey_number && `#${p.jersey_number}`,
    p.age !== null && `Age ${p.age}`,
    p.height,
    p.weight && `${p.weight} lb`,
    p.years_exp !== null && (p.years_exp === 0 ? 'Rookie' : `${p.years_exp} yr exp`),
  ]
    .filter(Boolean)
    .join(' · ');
  const seasonTotal = p.weekly_scores.reduce((sum, w) => sum + w.fantasy_points, 0);
  const seasonAverage = p.weekly_scores.length > 0 ? seasonTotal / p.weekly_scores.length : null;

  return (
    <>
      <Stack.Screen options={{ title: p.full_name }} />
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <View style={styles.hero}>
          {p.headshot_url ? (
            <Image source={{ uri: p.headshot_url }} style={styles.headshot} contentFit="cover" transition={150} />
          ) : (
            <View style={[styles.headshot, styles.headshotEmpty]} />
          )}
          <View style={styles.heroText}>
            <Text style={styles.name}>{p.full_name}</Text>
            <Text style={styles.muted}>
              {positionLabel(p.position)}
              {p.pro_team ? ` · ${p.pro_team}` : ''}
            </Text>
            {!!bio && <Text style={styles.muted}>{bio}</Text>}
            {p.injury_status && <Text style={styles.injury}>{p.injury_status}</Text>}
          </View>
        </View>

        <Card style={styles.ownerCard}>
          <Text style={styles.ownerText}>
            {p.is_on_my_team ? 'On your team' : p.rostered_team_name ? `On ${p.rostered_team_name}` : 'Free agent'}
          </Text>
          {p.rostered_team_id === null && (
            <Pressable onPress={() => setAdding(true)} style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}>
              <Text style={styles.addText}>Add</Text>
            </Pressable>
          )}
        </Card>

        <View style={styles.stats}>
          <Stat label="Season pts" value={formatPoints(seasonTotal)} />
          <Stat label="Avg" value={formatPoints(seasonAverage)} />
          <Stat label="Proj avg" value={formatPoints(p.projection?.season_avg_projected_points)} />
        </View>
        {p.projection && (
          <View style={styles.stats}>
            <Stat label="Owned" value={`${p.projection.percent_owned.toFixed(0)}%`} />
            <Stat label="Started" value={`${p.projection.percent_started.toFixed(0)}%`} />
            <Stat
              label={p.overview?.position_rank ? `${positionLabel(p.position)} rank` : 'Bye'}
              value={
                p.overview?.position_rank
                  ? `#${p.overview.position_rank}`
                  : p.projection.bye_week !== null
                    ? `Wk ${p.projection.bye_week}`
                    : '–'
              }
            />
          </View>
        )}

        {p.weekly_scores.length > 0 && (
          <>
            <SectionTitle>Game log</SectionTitle>
            <Card>
              <WeeklyChart scores={p.weekly_scores} />
            </Card>
          </>
        )}

        {p.overview?.latest_note?.story && (
          <>
            <SectionTitle>Latest</SectionTitle>
            <Card>
              {p.overview.latest_note.headline && <Text style={styles.headline}>{p.overview.latest_note.headline}</Text>}
              <Text style={styles.body}>{p.overview.latest_note.story}</Text>
            </Card>
          </>
        )}

        {(p.overview?.news.length ?? 0) > 0 && (
          <>
            <SectionTitle>News</SectionTitle>
            <Card style={styles.listCard}>
              {p.overview!.news.map((item, i) => (
                <Pressable
                  key={`${item.link ?? item.headline}-${i}`}
                  disabled={!item.link}
                  onPress={() => item.link && WebBrowser.openBrowserAsync(item.link)}
                  style={({ pressed }) => [styles.newsRow, i > 0 && styles.divided, pressed && styles.rowPressed]}>
                  <Text style={styles.headline}>{item.headline}</Text>
                  {item.description && (
                    <Text style={styles.muted} numberOfLines={2}>
                      {item.description}
                    </Text>
                  )}
                  {formatNewsDate(item.published) && <Text style={styles.date}>{formatNewsDate(item.published)}</Text>}
                </Pressable>
              ))}
            </Card>
          </>
        )}

        {p.overview?.season_outlook && (
          <>
            <SectionTitle>Season outlook</SectionTitle>
            <Card>
              <Text style={styles.body}>{p.overview.season_outlook}</Text>
            </Card>
          </>
        )}
      </ScrollView>
      {adding && <PlayerActionSheet player={asFreeAgent(p)} onClose={() => setAdding(false)} />}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// One bar per week played, labeled with points above and opponent
// below. Scrolls sideways once a season has more weeks than fit.
function WeeklyChart({ scores }: { scores: PlayerCard['weekly_scores'] }) {
  const max = Math.max(1, ...scores.map((s) => s.fantasy_points));
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chart}>
      {scores.map((s) => (
        <View key={s.week} style={styles.barColumn}>
          <Text style={styles.barValue}>{s.fantasy_points.toFixed(1)}</Text>
          <View style={styles.barTrack}>
            <View style={[styles.bar, { height: Math.max(2, (Math.max(0, s.fantasy_points) / max) * CHART_HEIGHT) }]} />
          </View>
          <Text style={styles.barLabel}>W{s.week}</Text>
          {s.opponent && <Text style={styles.barOpponent}>{s.opponent}</Text>}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.md },
  hero: { flexDirection: 'row', gap: Spacing.lg, alignItems: 'center' },
  headshot: { width: 88, height: 88, borderRadius: 44, backgroundColor: Colors.surface },
  headshotEmpty: { borderWidth: 1, borderColor: Colors.border },
  heroText: { flex: 1, gap: 2 },
  name: { color: Colors.text, fontSize: 24, fontWeight: '800' },
  muted: { color: Colors.textSecondary, fontSize: 13 },
  injury: { color: Colors.loss, fontSize: 13, fontWeight: '700' },
  ownerCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.md },
  ownerText: { flex: 1, color: Colors.text, fontSize: 15, fontWeight: '600' },
  addButton: { backgroundColor: Colors.accent, borderRadius: Radius.pill, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  addText: { color: Colors.bg, fontWeight: '800' },
  pressed: { opacity: 0.7 },
  stats: { flexDirection: 'row', gap: Spacing.md },
  stat: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    padding: Spacing.md,
    alignItems: 'center',
  },
  statValue: { color: Colors.text, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  statLabel: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm },
  barColumn: { width: 40, alignItems: 'center', gap: 2 },
  barValue: { color: Colors.textSecondary, fontSize: 10, fontVariant: ['tabular-nums'] },
  barTrack: { height: CHART_HEIGHT, justifyContent: 'flex-end', alignSelf: 'stretch', alignItems: 'center' },
  bar: { width: 24, backgroundColor: Colors.accent, borderRadius: 4 },
  barLabel: { color: Colors.text, fontSize: 11, fontWeight: '700' },
  barOpponent: { color: Colors.textSecondary, fontSize: 9 },
  headline: { color: Colors.text, fontSize: 15, fontWeight: '700', marginBottom: 2 },
  body: { color: Colors.text, fontSize: 14, lineHeight: 20 },
  listCard: { padding: 0, overflow: 'hidden' },
  newsRow: { padding: Spacing.lg, gap: 2 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  rowPressed: { backgroundColor: Colors.border },
  date: { color: Colors.textSecondary, fontSize: 11, marginTop: 2 },
});
