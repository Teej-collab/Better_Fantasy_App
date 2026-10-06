import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { TONES, toneFor, weeksLabel } from '@/components/bracket/GameCard';
import { Text } from '@/components/Text';
import { Fonts } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { ordinal, pathFor, type BracketGame, type PlayoffWorld, type World, type WorldTeam } from '@/lib/bracketEngine';

// Your Path — the Tower (the web's components/bracket/PathView.tsx):
// the title game in the penthouse, the Toilet Bowl in the basement, and
// an elevator that rides to the floor where the chosen team finishes.

type Floor = { code: string; name: string; color: string; bg: [string, string]; edge: string; games: BracketGame[]; lobby?: boolean };

function floorsFor(games: BracketGame[], playoffCount: number): Floor[] {
  const winners = games.filter((g) => g.bracket === 'winners');
  const maxRound = Math.max(...winners.map((g) => g.round));
  const floors: Floor[] = [];
  for (let r = maxRound; r >= 1; r--) {
    const top = r === maxRound;
    floors.push({
      code: top ? 'PH' : String(r + 1),
      name: top ? 'PENTHOUSE' : 'SEMIFINALS',
      color: top ? '#f5c542' : '#39ff14',
      bg: top ? ['#2b2510', '#17140b'] : ['#16231b', '#10161a'],
      edge: top ? '#f5c542' : '#39ff14',
      games: winners.filter((g) => g.round === r),
    });
  }
  floors.push({ code: 'G', name: `LOBBY · TOP ${playoffCount} GO UP`, color: '#eceef1', bg: ['#151a20', '#111419'], edge: '#2b3340', games: [], lobby: true });
  const cons = games.filter((g) => g.bracket === 'consolation');
  [...new Set(cons.map((g) => g.round))].sort().forEach((r, i) => {
    const here = cons.filter((g) => g.round === r && !g.toilet_bowl);
    if (here.length) floors.push({ code: `B${i + 1}`, name: i === 0 ? 'CONSOLATION' : 'PLACEMENT', color: '#9aa3b2', bg: ['#181d25', '#12161c'], edge: '#2b3340', games: here });
  });
  const bowl = cons.filter((g) => g.toilet_bowl);
  if (bowl.length) floors.push({ code: `B${floors.filter((f) => f.code.startsWith('B')).length + 1}`, name: 'THE BOWL', color: '#d9a066', bg: ['#2b1e12', '#150f0a'], edge: '#a8743c', games: bowl });
  return floors;
}

export function PathView({
  world,
  w,
  teams,
  records,
  team,
  onTeam,
}: {
  world: PlayoffWorld;
  w: World;
  teams: Record<number, WorldTeam>;
  records: Record<number, string>;
  team: number;
  onTeam: (teamId: number) => void;
}) {
  const floors = floorsFor(w.games, world.playoff_team_count);
  const path = pathFor(w, team);
  const finalGame = path.games[path.games.length - 1];
  const carIndex = Math.max(0, floors.findIndex((f) => finalGame && f.games.some((g) => g.code === finalGame.code)));
  const seed = w.standings.find((r) => r.team_id === team)?.seed;
  const place = path.place;
  const headColor = place === 1 ? '#f5c542' : finalGame?.toilet_bowl ? '#d9a066' : seed && seed <= world.playoff_team_count ? '#39ff14' : '#eceef1';

  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {w.standings.map((r) => (
          <Pressable
            key={r.team_id}
            onPress={() => {
              haptics.tap();
              onTeam(r.team_id);
            }}
            style={[styles.chip, r.team_id === team && styles.chipOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: r.team_id === team }}>
            <Text style={[styles.chipText, r.team_id === team && styles.chipTextOn]}>
              {r.seed}. {teams[r.team_id].name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.result}>
        <Text style={[styles.resultHead, { color: headColor }]}>
          #{seed} {teams[team].name}: {place === 1 ? 'Champion' : place ? ordinal(place) : 'TBD'}
        </Text>
        <Text style={styles.resultSub}>{records[team]} in this world</Text>
      </View>

      <View style={styles.tower}>
        <View style={styles.shaft}>
          <LinearGradient colors={['#f5c542', '#39ff14', '#2b3340', '#a8743c']} style={styles.shaftLine} />
          {floors.map((f, i) => (
            <View key={f.code} style={[styles.stop, i === carIndex && styles.car]}>
              <Text style={[styles.stopText, i === carIndex && styles.carText]}>{f.code}</Text>
            </View>
          ))}
        </View>
        <View style={styles.floors}>
          {floors.map((f) => (
            <View key={f.code} style={[styles.slab, { borderColor: f.edge }]}>
              <LinearGradient colors={f.bg} style={StyleSheet.absoluteFill} />
              <View style={styles.slabHead}>
                <Text style={[styles.slabName, { color: f.color }]}>{f.name}</Text>
                {f.games[0] && <Text style={styles.slabWeeks}>{weeksLabel(f.games[0].weeks)}</Text>}
              </View>
              {f.lobby ? (
                <Text style={styles.lobby}>▲ SEEDS 1–{world.playoff_team_count} RIDE UP · EVERYONE ELSE GOES DOWN ▼</Text>
              ) : (
                <View style={styles.slabGames}>
                  {f.games.map((g) => {
                    const mine = g.a === team || g.b === team;
                    return (
                      <View key={g.code} style={[styles.mini, mine && styles.miniMine]}>
                        <Text style={[styles.miniLabel, { color: TONES[toneFor(g)].kicker }]} numberOfLines={1}>
                          {g.toilet_bowl ? 'TOILET BOWL' : g.label.toUpperCase()}
                        </Text>
                        {[g.a, g.b].map((t, i) => (
                          <Text key={i} style={[styles.miniTeam, { opacity: t !== null && g.loser === t ? 0.45 : 1 }, t === team && styles.miniTeamMine]} numberOfLines={1}>
                            {t !== null ? teams[t].name : 'TBD'}
                          </Text>
                        ))}
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          ))}
        </View>
      </View>

      <View style={styles.stops}>
        {path.games.map((g) => {
          const opp = g.a === team ? g.b : g.a;
          const f = floors.find((fl) => fl.games.some((x) => x.code === g.code));
          const result = g.winner === null ? 'TBD' : g.winner === team ? (g.decided === 'real' ? 'won' : 'favored to win') : g.decided === 'real' ? 'lost' : 'underdog';
          return (
            <View key={g.code} style={styles.stopRow}>
              <Text style={[styles.stopCode, { color: f?.color }]}>{f?.code}</Text>
              <Text style={styles.stopLine}>
                {g.toilet_bowl ? 'Toilet Bowl' : g.label} vs {opp !== null ? teams[opp].name : 'TBD'} — {result}
              </Text>
            </View>
          );
        })}
        {finalGame?.toilet_bowl && finalGame.loser === team && <Text style={styles.punish}>Toilet Bowl punishment: {world.toilet_bowl_punishment}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  chips: { paddingHorizontal: 16, gap: 8 },
  chip: { height: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#2b3340', justifyContent: 'center', backgroundColor: '#12161c' },
  chipOn: { backgroundColor: '#eceef1', borderColor: '#ffffff' },
  chipText: { fontFamily: Fonts.display, fontSize: 14, color: '#eceef1' },
  chipTextOn: { color: '#0d1016' },
  result: { paddingHorizontal: 16, gap: 2 },
  resultHead: { fontFamily: Fonts.displayBold, fontSize: 28 },
  resultSub: { fontSize: 12, color: '#9aa3b2' },
  tower: { flexDirection: 'row', paddingHorizontal: 12, gap: 8 },
  shaft: { width: 40, justifyContent: 'space-around', alignItems: 'center' },
  shaftLine: { position: 'absolute', top: 0, bottom: 0, width: 6, borderRadius: 3, left: 17 },
  stop: { width: 30, height: 30, borderRadius: 9, backgroundColor: '#12161c', alignItems: 'center', justifyContent: 'center' },
  stopText: { fontFamily: Fonts.monoBold, fontSize: 10, color: '#7f8a99' },
  car: { width: 38, height: 38, borderRadius: 11, backgroundColor: '#eceef1', shadowColor: '#ffffff', shadowOpacity: 0.6, shadowRadius: 12 },
  carText: { color: '#0d1016', fontSize: 12 },
  floors: { flex: 1, gap: 10 },
  slab: { borderRadius: 16, borderWidth: 1, padding: 10, gap: 8, overflow: 'hidden' },
  slabHead: { flexDirection: 'row', justifyContent: 'space-between' },
  slabName: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 1.5 },
  slabWeeks: { fontFamily: Fonts.mono, fontSize: 10, color: '#7f8a99' },
  lobby: { fontFamily: Fonts.mono, fontSize: 9, letterSpacing: 1, color: '#39ff14' },
  slabGames: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  mini: { flexGrow: 1, flexBasis: '45%', borderRadius: 10, padding: 7, gap: 2, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  miniMine: { backgroundColor: 'rgba(255,255,255,0.1)', borderColor: '#ffffff', borderWidth: 2 },
  miniLabel: { fontFamily: Fonts.mono, fontSize: 9, letterSpacing: 1 },
  miniTeam: { fontFamily: Fonts.display, fontSize: 14, color: '#eceef1' },
  miniTeamMine: { color: '#ffffff' },
  stops: { marginHorizontal: 16, padding: 14, borderRadius: 16, backgroundColor: '#12161c', borderWidth: 1, borderColor: '#1c2027', gap: 8 },
  stopRow: { flexDirection: 'row', gap: 10 },
  stopCode: { width: 28, fontFamily: Fonts.mono, fontSize: 12 },
  stopLine: { flex: 1, fontSize: 14, color: '#c9cfd8' },
  punish: { fontSize: 13, color: '#d9a066' },
});
