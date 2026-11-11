import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { columnsFor } from '@/components/gamecast/BoxScore';
import { ShareButton } from '@/components/ShareSheet';
import { Text } from '@/components/Text';
import { Colors, Radius, Spacing, withAlpha } from '@/constants/theme';
import { sleeperHeadshotUrl } from '@/lib/nflTeams';
import { openPlayer } from '@/lib/queries';
import type { FantasyImpact, GamecastBoxScore, LiveGame } from '@/lib/types';

const RECENT_PLAYS = 5;

// "J. Love", "J.Love" and "Jordan Love" all → "jlove".
function shorthand(name: string | null | undefined): string | null {
  const parts = (name ?? '').replace(/[^A-Za-z.\s'-]/g, '').split(/[\s.]+/).filter(Boolean);
  if (parts.length < 2) return null;
  return (parts[0][0] + parts[parts.length - 1]).toLowerCase().replace(/[^a-z]/g, '');
}

// The player Gamecast was opened for from the matchup (2026-11-10): their
// fantasy points, their line in every box score category they show up in
// (targets, catches, carries…), and their own plays, newest first. All
// of it is the screen's live data, so it moves with the game.
export function FocusPlayer(props: {
  playerId: string;
  game: LiveGame;
  box: GamecastBoxScore | undefined;
  impact: FantasyImpact | undefined;
  accent: string;
}) {
  const { playerId, game, box, impact, accent } = props;
  const lines = (box?.teams ?? []).flatMap((team) =>
    team.categories.flatMap((category) =>
      category.athletes.filter((a) => a.player_id === playerId).map((athlete) => ({ category, athlete, team })),
    ),
  );
  const impactPlayer = [
    ...(impact?.your_players ?? []),
    ...(impact?.opponent_players ?? []),
    ...(impact?.game_leaders.home.leaders ?? []),
    ...(impact?.game_leaders.away.leaders ?? []),
  ].find((p) => p.player_id === playerId);
  const athlete = lines[0]?.athlete;
  const name = athlete?.name ?? impactPlayer?.player_name ?? 'Your player';
  const position = athlete?.position ?? impactPlayer?.position ?? null;
  const team = lines[0]?.team.abbr ?? impactPlayer?.pro_team ?? null;
  const owner = impact?.your_players.some((p) => p.player_id === playerId)
    ? 'Your player'
    : impact?.opponent_players.some((p) => p.player_id === playerId)
      ? "Opponent's player"
      : null;

  // Plays only name players in ESPN's "J.Love" shorthand (backend
  // gamecast/providers/espn.py), so match on initial + surname, the way
  // Fantasy Impact does. game.plays is newest first.
  const key = shorthand(name);
  const plays = key ? game.plays.filter((p) => p.players_involved.some((r) => shorthand(r.name) === key)).slice(0, RECENT_PLAYS) : [];
  const headshot = sleeperHeadshotUrl(playerId);

  return (
    <View style={[styles.card, { borderColor: withAlpha(accent, 0.45) }]}>
      <View style={styles.top}>
        {headshot ? <Image source={{ uri: headshot }} style={styles.headshot} contentFit="cover" accessible={false} /> : null}
        <View style={styles.flex}>
          {owner && <Text style={[styles.kicker, { color: accent }]}>{owner.toUpperCase()}</Text>}
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.muted}>{[position, team].filter(Boolean).join(' · ')}</Text>
        </View>
        {impactPlayer && (
          <View style={styles.points}>
            <Text style={[styles.pointsValue, { color: accent }]} maxFontSizeMultiplier={1.2}>
              {impactPlayer.points_scored.toFixed(1)}
            </Text>
            <Text style={styles.muted}>pts</Text>
          </View>
        )}
      </View>

      {lines.length === 0 ? (
        <Text style={styles.muted}>{game.status === 'scheduled' ? 'Hasn’t kicked off yet.' : 'No stats yet.'}</Text>
      ) : (
        lines.map(({ category, athlete: a }) => (
          <View key={category.key} style={styles.line}>
            <Text style={styles.category}>{category.title}</Text>
            <View style={styles.stats}>
              {columnsFor(category).map((i) => (
                <View key={i} style={styles.stat}>
                  <Text style={styles.statValue}>{a.stats[i] ?? '–'}</Text>
                  <Text style={styles.statLabel}>{category.labels[i]}</Text>
                </View>
              ))}
            </View>
          </View>
        ))
      )}

      {plays.length > 0 && (
        <View style={styles.plays}>
          <Text style={styles.category}>Recent plays</Text>
          {plays.map((p) => (
            <View key={p.play_id} style={styles.play}>
              <Text style={styles.playWhen}>
                Q{p.period} {p.clock}
              </Text>
              <Text style={[styles.playText, p.is_scoring_play && { color: accent, fontWeight: '700' }]}>{p.description}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.links}>
        <Pressable
          onPress={() => openPlayer(playerId)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.cardLink, pressed && styles.pressed]}>
          <Text style={[styles.cardLinkText, { color: accent }]}>Player card ›</Text>
        </Pressable>
        {lines.length > 0 && <ShareButton shareRef={{ kind: 'player', game_id: game.game_id, player_id: playerId }} title={`${name} · ${team ?? ''}`.trim()} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.lg, gap: Spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  flex: { flex: 1, minWidth: 0 },
  headshot: { width: 52, height: 52, borderRadius: 26, backgroundColor: Colors.tileRaised },
  kicker: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  name: { color: Colors.text, fontSize: 18, fontWeight: '800' },
  muted: { color: Colors.textSecondary, fontSize: 13 },
  points: { alignItems: 'flex-end' },
  pointsValue: { fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  line: { gap: 6 },
  category: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  stat: { minWidth: 64, paddingVertical: 8, paddingHorizontal: 10, borderRadius: Radius.md, backgroundColor: Colors.tileRaised, alignItems: 'center' },
  statValue: { color: Colors.text, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  statLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700' },
  plays: { gap: 8 },
  play: { flexDirection: 'row', gap: Spacing.sm },
  playWhen: { color: Colors.textSecondary, fontSize: 12, width: 64, fontVariant: ['tabular-nums'] },
  playText: { color: Colors.text, fontSize: 13, lineHeight: 18, flex: 1 },
  links: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardLink: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' },
  cardLinkText: { fontSize: 14, fontWeight: '700' },
  pressed: { opacity: 0.6 },
});
