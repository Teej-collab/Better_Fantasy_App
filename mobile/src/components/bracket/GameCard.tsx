import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/Text';
import { Fonts } from '@/constants/theme';
import type { BracketGame, WorldTeam } from '@/lib/bracketEngine';

// One playoff game — the web's GameTile (frontend/src/components/
// bracket/GameTile.tsx): both teams, the winner bright and the loser
// faded, where each goes next. In the What-If view each team is its own
// button that picks them to win (onPick).

export type Tone = 'gold' | 'win' | 'cons' | 'bowl';

export function toneFor(g: BracketGame): Tone {
  if (g.code === 'F') return 'gold';
  if (g.toilet_bowl) return 'bowl';
  return g.bracket === 'winners' ? 'win' : 'cons';
}

export const TONES: Record<Tone, { border: string; glow: string; bg: [string, string]; kicker: string; foot: string }> = {
  gold: { border: '#f5c542', glow: 'rgba(245,197,66,0.45)', bg: ['#2c2510', '#15130c'], kicker: '#f5c542', foot: '#f5c542' },
  win: { border: '#39ff14', glow: 'rgba(57,255,20,0.25)', bg: ['#15231b', '#10161a'], kicker: '#39ff14', foot: '#9aa3b2' },
  cons: { border: '#2b3340', glow: 'rgba(0,0,0,0.5)', bg: ['#181d25', '#12161c'], kicker: '#9aa3b2', foot: '#9aa3b2' },
  bowl: { border: '#a8743c', glow: 'rgba(168,116,60,0.5)', bg: ['#2b1e12', '#150f0a'], kicker: '#d9a066', foot: '#d9a066' },
};

export function weeksLabel(weeks: number[]): string {
  return weeks.length > 1 ? `WK ${weeks[0]}–${weeks[weeks.length - 1]}` : `WK ${weeks[0]}`;
}

function nth(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

function shortName(g: BracketGame): string {
  if (g.code === 'F') return 'Title game';
  if (g.code === '3RD') return '3rd place';
  if (g.toilet_bowl) return 'Toilet Bowl';
  return g.label.split(' · ')[0];
}

/** Where this game's winner and loser go, in plain words. */
export function routeLabel(g: BracketGame, all: BracketGame[], punishment: string): string {
  if (g.places) {
    const [w, l] = g.places;
    if (g.code === 'F') return 'Winner: league champion · Loser: 2nd';
    if (g.toilet_bowl) return `Loser: ${nth(l)} (last) + ${punishment === 'TBD' ? 'punishment TBD' : punishment}`;
    return `Winner ${nth(w)} · Loser ${nth(l)}`;
  }
  const next = (kind: 'winner' | 'loser') => all.find((x) => x.sources.some((s) => s.kind === kind && s.code === g.code));
  const w = next('winner');
  const l = next('loser');
  return [w && `W → ${shortName(w)}`, l && `L → ${shortName(l)}`].filter(Boolean).join(' · ');
}

function sourceLabel(src: BracketGame['sources'][number], all: BracketGame[]): string {
  if (src.kind === 'seed') return `#${src.seed} seed`;
  const g = all.find((x) => x.code === src.code);
  return `${src.kind === 'winner' ? 'Winner' : 'Loser'} ${g ? shortName(g) : src.code}`;
}

const TAG: Record<BracketGame['decided'], string> = { real: 'FINAL', pick: 'YOUR PICK', favorite: 'FAVORED', pending: '' };

export function GameCard({
  game,
  all,
  teams,
  records,
  punishment,
  me,
  compact,
  onPick,
  style,
}: {
  game: BracketGame;
  all: BracketGame[];
  teams: Record<number, WorldTeam>;
  records: Record<number, string>;
  punishment: string;
  me: number | null;
  compact?: boolean;
  onPick?: (teamId: number) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const tone = TONES[toneFor(game)];
  const mine = me !== null && (game.a === me || game.b === me);
  const sides = [
    { team: game.a, seed: game.seedA, score: game.score_a, from: game.sources[0] },
    { team: game.b, seed: game.seedB, score: game.score_b, from: game.sources[1] },
  ];
  return (
    <View
      style={[
        styles.card,
        compact && styles.cardCompact,
        { borderColor: mine ? 'rgba(255,255,255,0.8)' : tone.border, borderWidth: mine ? 2 : 1, shadowColor: tone.glow },
        style,
      ]}>
      <LinearGradient colors={tone.bg} style={StyleSheet.absoluteFill} />
      <View style={styles.kickerRow}>
        <Text style={[styles.kicker, { color: tone.kicker }]} numberOfLines={1}>
          {game.toilet_bowl ? 'TOILET BOWL' : game.label.toUpperCase()}
        </Text>
        <Text style={[styles.kicker, { color: tone.kicker }]}>{weeksLabel(game.weeks)}</Text>
      </View>
      {sides.map((side, i) => {
        const won = game.winner !== null && game.winner === side.team;
        const lost = game.winner !== null && side.team !== null && game.winner !== side.team;
        const team = side.team !== null ? teams[side.team] : null;
        const body = (
          <>
            <Text style={styles.seed}>{side.seed ? `#${side.seed}` : ''}</Text>
            <View style={styles.names}>
              <Text style={[styles.name, compact && styles.nameCompact, side.team === me && styles.nameMine]} numberOfLines={1}>
                {team ? team.name : sourceLabel(side.from, all)}
              </Text>
              {!compact && (
                <Text style={styles.sub} numberOfLines={1}>
                  {team ? `${team.team_name}${records[team.team_id] ? ` · ${records[team.team_id]}` : ''}` : 'to be decided'}
                </Text>
              )}
            </View>
            {side.score !== null && game.decided === 'real' ? (
              <Text style={styles.score}>{side.score.toFixed(2)}</Text>
            ) : (
              won && <Text style={styles.tag}>{TAG[game.decided]}</Text>
            )}
          </>
        );
        return onPick && side.team !== null ? (
          <Pressable
            key={i}
            onPress={() => onPick(side.team!)}
            accessibilityRole="button"
            accessibilityLabel={`Pick ${team?.name} to win ${game.label}`}
            style={({ pressed }) => [styles.row, styles.rowPick, { opacity: lost ? 0.42 : 1 }, pressed && styles.pressed]}>
            {body}
          </Pressable>
        ) : (
          <View key={i} style={[styles.row, { opacity: lost ? 0.42 : 1 }]}>
            {body}
          </View>
        );
      })}
      {!compact && <Text style={[styles.foot, { color: tone.foot }]}>{routeLabel(game, all, punishment)}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, padding: 16, gap: 10, overflow: 'hidden', shadowOpacity: 1, shadowRadius: 18, shadowOffset: { width: 0, height: 10 } },
  cardCompact: { borderRadius: 14, padding: 10, gap: 4 },
  kickerRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  kicker: { fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 1.5, flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowPick: { minHeight: 44, borderRadius: 10, paddingHorizontal: 4 },
  pressed: { backgroundColor: 'rgba(255,255,255,0.06)' },
  seed: { width: 28, fontFamily: Fonts.mono, fontSize: 12, color: '#9aa3b2' },
  names: { flex: 1, minWidth: 0 },
  name: { fontFamily: Fonts.display, fontSize: 22, color: '#eceef1' },
  nameCompact: { fontSize: 16 },
  nameMine: { color: '#ffffff' },
  sub: { fontSize: 11, color: '#9aa3b2' },
  score: { fontFamily: Fonts.monoBold, fontSize: 16, color: '#eceef1' },
  tag: { fontFamily: Fonts.mono, fontSize: 10, color: '#39ff14' },
  foot: { fontSize: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)', paddingTop: 8 },
});
