import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useGamecastIdFinder, useNflScoreboard } from '@/lib/queries';
import type { NflGame } from '@/lib/types';

// Live games first, then upcoming, then finals — what you want to see
// at a glance on a Sunday.
const STATE_ORDER: Record<string, number> = { in: 0, pre: 1, post: 2 };

function kickoff(game: NflGame): string {
  if (!game.date) return game.status_detail ?? '';
  const date = new Date(game.date);
  return `${date.toLocaleDateString(undefined, { weekday: 'short' })} ${date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

// The web app's NFL ticker, as a sideways-scrolling row of score chips.
// Each chip opens that game's Gamecast.
export function NflScoreStrip() {
  const games = useNflScoreboard().data ?? [];
  const findGamecastId = useGamecastIdFinder();
  if (games.length === 0) return null;
  const sorted = [...games].sort((a, b) => (STATE_ORDER[a.state ?? 'pre'] ?? 1) - (STATE_ORDER[b.state ?? 'pre'] ?? 1));

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {sorted.map((game) => {
        const live = game.state === 'in';
        const started = game.state !== 'pre';
        const gamecastId = findGamecastId(game.home_team, game.away_team);
        return (
          <Pressable
            key={game.id}
            disabled={!gamecastId}
            onPress={() => gamecastId && router.push({ pathname: '/gamecast/[id]', params: { id: gamecastId } })}
            style={({ pressed }) => [styles.chip, live && styles.chipLive, pressed && styles.pressed]}>
            <TeamLine team={game.away_team} score={started ? game.away_score : null} />
            <TeamLine team={game.home_team} score={started ? game.home_score : null} />
            <View style={styles.statusLine}>
              {live && <View style={styles.liveDot} />}
              <Text style={[styles.status, live && styles.statusLive]} numberOfLines={1}>
                {game.state === 'pre' ? kickoff(game) : (game.status_detail ?? '')}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function TeamLine({ team, score }: { team: string | null; score: string | null }) {
  return (
    <View style={styles.teamLine}>
      <Text style={styles.team}>{team ?? 'TBD'}</Text>
      {score !== null && <Text style={styles.score}>{score}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { gap: Spacing.sm, paddingBottom: Spacing.lg },
  chip: {
    width: 104,
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    gap: 2,
  },
  chipLive: { borderColor: Colors.live },
  pressed: { opacity: 0.6 },
  teamLine: { flexDirection: 'row', justifyContent: 'space-between' },
  team: { color: Colors.text, fontSize: 13, fontWeight: '700' },
  score: { color: Colors.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.live },
  status: { flex: 1, color: Colors.textSecondary, fontSize: 11 },
  statusLive: { color: Colors.live, fontWeight: '700' },
});
