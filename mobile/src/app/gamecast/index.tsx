import { Stack } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { PreviewLink } from '@/components/PreviewLink';
import { NeonPanel } from '@/components/NeonPanel';
import { Display, Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Colors, Fonts, Radius, SectionColors, Spacing } from '@/constants/theme';
import { formatGameTime } from '@/lib/format';
import { queryClient, useGamecastIdFinder, useNflScoreboard } from '@/lib/queries';
import type { NflGame } from '@/lib/types';

// "12:34 - 3rd" → "Q3 12:34", same as the web's NflGameRow.
function formatLiveStatus(detail: string | null): string {
  if (!detail) return 'Live';
  const match = detail.match(/^(\d{1,2}:\d{2}) - (\d)(?:st|nd|rd|th)$/);
  return match ? `Q${match[2]} ${match[1]}` : detail;
}

// Port of the web's /gamecast hub: this week's NFL slate (live,
// upcoming, final), each game opening its live Gamecast when one exists.
export default function GamecastHubScreen() {
  const scoreboard = useNflScoreboard();
  const findGamecastId = useGamecastIdFinder();
  const [refreshing, setRefreshing] = useState(false);
  const games = (scoreboard.data ?? []).filter((g) => g.home_team && g.away_team);
  const groups = [
    { title: 'Live', games: games.filter((g) => g.state === 'in') },
    { title: 'Upcoming', games: games.filter((g) => g.state === 'pre') },
    { title: 'Final', games: games.filter((g) => g.state === 'post') },
  ].filter((group) => group.games.length > 0);
  const week = games.find((g) => g.week !== null)?.week ?? null;

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['nfl-scoreboard'] }),
      queryClient.invalidateQueries({ queryKey: ['gamecast-games'] }),
    ]);
    setRefreshing(false);
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.live} />}>
      <Stack.Screen options={{ title: 'Gamecast' }} />
      <View style={styles.head}>
        <Text style={styles.kicker}>Gamecast</Text>
        <Display style={styles.title}>NFL Games</Display>
        <Text style={styles.sub}>Live scores{week !== null ? ` · Week ${week}` : ''}</Text>
      </View>

      {scoreboard.isPending ? (
        <LoadingState />
      ) : groups.length === 0 ? (
        <NeonPanel color={SectionColors.gamecast} contentStyle={styles.empty}>
          <Text style={styles.emptyTitle}>No games scheduled right now</Text>
          <Text style={styles.sub}>Gamecast lights up once real NFL games are on the slate — check back closer to kickoff.</Text>
        </NeonPanel>
      ) : (
        groups.map((group) => (
          <View key={group.title} style={styles.group}>
            <Display style={styles.groupTitle}>{group.title}</Display>
            {group.games.map((game) => (
              <GameRow key={game.id} game={game} gamecastId={findGamecastId(game.home_team, game.away_team)} />
            ))}
          </View>
        ))
      )}
    </ScrollView>
  );
}

function GameRow({ game, gamecastId }: { game: NflGame; gamecastId: string | null }) {
  const live = game.state === 'in';
  const final = game.state === 'post';
  const away = Number(game.away_score ?? 0);
  const home = Number(game.home_score ?? 0);
  const content = (
      <NeonPanel color={live ? SectionColors.gamecast : undefined} radius={Radius.md} contentStyle={styles.row}>
        <View style={styles.teams}>
          <TeamLine abbr={game.away_team ?? '—'} score={game.away_score} showScore={game.state !== 'pre'} dim={final && away < home} />
          <TeamLine abbr={game.home_team ?? '—'} score={game.home_score} showScore={game.state !== 'pre'} dim={final && home < away} />
        </View>
        <View style={styles.status}>
          {live ? (
            <View style={styles.liveRow}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>{formatLiveStatus(game.status_detail)}</Text>
            </View>
          ) : (
            <Text style={styles.statusText}>
              {final ? (game.status_detail ?? 'Final') : game.date ? formatGameTime(game.date) : (game.status_detail ?? 'Upcoming')}
            </Text>
          )}
          {game.broadcast && <Text style={styles.broadcast}>{game.broadcast}</Text>}
        </View>
      </NeonPanel>
  );
  if (!gamecastId) return <View style={styles.dim}>{content}</View>;
  return (
    <PreviewLink href={{ pathname: '/gamecast/[id]', params: { id: gamecastId } }} pressedStyle={styles.pressed}>
      {content}
    </PreviewLink>
  );
}

function TeamLine({ abbr, score, showScore, dim }: { abbr: string; score: string | null; showScore: boolean; dim: boolean }) {
  return (
    <View style={styles.teamLine}>
      <Text style={[styles.abbr, dim && styles.dimText]}>{abbr}</Text>
      {showScore && <Text style={[styles.score, dim && styles.dimText]}>{score ?? '0'}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.xl },
  head: { gap: 2 },
  kicker: { color: Colors.live, fontSize: 11, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase' },
  title: { fontSize: 30 },
  sub: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
  empty: { alignItems: 'center', gap: Spacing.sm, padding: Spacing.xl },
  emptyTitle: { color: Colors.text, fontSize: 17, fontWeight: '600' },
  group: { gap: 10 },
  groupTitle: { fontSize: 20 },
  dim: { opacity: 0.7 },
  pressed: { opacity: 0.7 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  teams: { gap: 4 },
  teamLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  abbr: { width: 44, color: Colors.text, fontSize: 15, fontWeight: '600' },
  score: { color: Colors.text, fontSize: 15, fontFamily: Fonts.mono, fontVariant: ['tabular-nums'] },
  dimText: { color: 'rgba(255,255,255,0.45)' },
  status: { alignItems: 'flex-end', gap: 4 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.live },
  liveText: { color: Colors.live, fontSize: 12, fontWeight: '600' },
  statusText: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  broadcast: { color: 'rgba(255,255,255,0.45)', fontSize: 12 },
});
