import { StyleSheet, View } from 'react-native';

import { GameCard } from '@/components/bracket/GameCard';
import { Text } from '@/components/Text';
import { Fonts } from '@/constants/theme';
import type { BracketGame, PlayoffWorld, World, WorldTeam } from '@/lib/bracketEngine';

// The whole bracket at once on a phone: the winners' bracket on top and
// the ladder below, two games a row, each round labelled. Flat, like the
// web's board.

export function FullBracket({
  world,
  w,
  teams,
  records,
  me,
}: {
  world: PlayoffWorld;
  w: World;
  teams: Record<number, WorldTeam>;
  records: Record<number, string>;
  me: number | null;
}) {
  const rounds = (bracket: 'winners' | 'consolation') => {
    const games = w.games.filter((g) => g.bracket === bracket);
    return [...new Set(games.map((g) => g.round))].sort().map((r) => games.filter((g) => g.round === r));
  };
  const roundTitle = (games: BracketGame[]) =>
    games.some((g) => g.code === 'F') ? 'TITLE GAME · 3RD PLACE' : games[0].bracket === 'winners' ? 'SEMIFINALS' : games.some((g) => g.places) ? 'PLACEMENT GAMES' : 'ROUND 1';

  return (
    <View style={styles.wrap}>
      <Text style={styles.sub}>Every game, top to bottom</Text>
      <View>
        {(['winners', 'consolation'] as const).map((bracket) =>
          rounds(bracket).length === 0 ? null : (
            <View key={bracket} style={styles.section}>
              <Text style={[styles.sectionTitle, bracket === 'winners' ? styles.goldText : styles.greyText]}>
                {bracket === 'winners' ? "WINNERS' BRACKET" : 'CONSOLATION LADDER'}
              </Text>
              {bracket === 'consolation' && <View style={styles.line} />}
              {rounds(bracket)
                .reverse()
                .map((games) => (
                  <View key={games[0].code} style={styles.round}>
                    <Text style={styles.roundTitle}>{roundTitle(games)}</Text>
                    <View style={styles.grid}>
                      {games.map((g) => (
                        <View key={g.code} style={styles.cell}>
                          <GameCard game={g} all={w.games} teams={teams} records={records} punishment={world.toilet_bowl_punishment} me={me} compact />
                        </View>
                      ))}
                    </View>
                  </View>
                ))}
            </View>
          ),
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, gap: 10 },
  sub: { fontSize: 12, color: '#9aa3b2' },
  section: { gap: 10, marginBottom: 14 },
  sectionTitle: { fontFamily: Fonts.displayBold, fontSize: 20, letterSpacing: 1 },
  goldText: { color: '#f5c542' },
  greyText: { color: '#eceef1' },
  line: { height: 2, backgroundColor: '#39ff14', shadowColor: '#39ff14', shadowOpacity: 1, shadowRadius: 8 },
  round: { gap: 8 },
  roundTitle: { fontFamily: Fonts.mono, fontSize: 11, letterSpacing: 2, color: '#9aa3b2' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { width: '48.5%' },
});
