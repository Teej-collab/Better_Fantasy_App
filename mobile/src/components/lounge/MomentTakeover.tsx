import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { Modal, Pressable, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Polyline } from 'react-native-svg';

import { Text } from '@/components/Text';
import { Fonts } from '@/constants/theme';
import { useAppearance } from '@/lib/appearance';
import { clockLabel, scoringHeadline, shade } from '@/lib/loungeLive';
import { nflTeamColor, nflTeamName } from '@/lib/nflTeams';
import type { Bet, GamecastPlay, LiveGame, PlayFantasyPlayer } from '@/lib/types';

export type Moment = { play: GamecastPlay; game: LiveGame; players: PlayFantasyPlayer[] };
export type ReactionCounts = { letsgo: number; robbed: number; chug: number; flag: number };

const AUTO_CLOSE_MS = 15000;

/** A touchdown, as the TV shows it (on the room's delay). */
export function isTouchdown(play: GamecastPlay): boolean {
  return play.is_scoring_play && (/touchdown/i.test(play.description) || play.event_type === 'TOUCHDOWN');
}

function city(abbr: string | null): string {
  const name = nflTeamName(abbr) ?? abbr ?? '';
  const parts = name.split(' ');
  return (parts.length > 1 ? parts.slice(0, -1).join(' ') : name).toUpperCase();
}

// Mockup 2: the room's touchdown moment.
export function MomentTakeover({
  moment,
  watching,
  winBefore,
  winNow,
  winHistory,
  myBets,
  reactions,
  lastMessages,
  onClose,
}: {
  moment: Moment | null;
  watching: number;
  winBefore: number | null;
  winNow: number | null;
  winHistory: number[];
  myBets: Bet[];
  reactions: ReactionCounts;
  lastMessages: { name: string; color: string; body: string }[];
  onClose: () => void;
}) {
  const accent = useAppearance().accent;
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!moment) return;
    const id = setTimeout(onClose, AUTO_CLOSE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moment?.play.play_id]);

  if (!moment) return null;
  const { play, game } = moment;
  const scorer = play.team_abbr;
  const teamColor = nflTeamColor(scorer) ?? '#e31837';
  const players = [...moment.players].sort((a, b) => Number(b.is_mine) - Number(a.is_mine) || Math.abs(b.points) - Math.abs(a.points)).slice(0, 4);
  const involved = new Set(play.players_involved.map((p) => p.name.toLowerCase()));
  const hitLeg = myBets
    .flatMap((b) => b.legs.map((leg) => ({ b, leg })))
    .find(({ leg }) => leg.status === 'won' && leg.player_name && involved.has(leg.player_name.toLowerCase()));

  function share() {
    const pts = players.filter((p) => p.is_mine).map((p) => `${p.player_name} ${p.points >= 0 ? '+' : ''}${p.points.toFixed(1)}`);
    void Share.share({ message: `${city(scorer)} TOUCHDOWN — ${scoringHeadline(play, game)}${pts.length ? `\n${pts.join(' · ')}` : ''}\nWatching in The Weekend Lounge` });
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top + 6, paddingBottom: insets.bottom }]} accessibilityViewIsModal>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>LEAGUE LOUNGE</Text>
            <Text style={styles.sub}>
              {watching} watching · {game.away_team.abbr} @ {game.home_team.abbr}
            </Text>
          </View>
          <Text style={styles.clock}>{clockLabel(game)}</Text>
        </View>

        <View style={[styles.tv, { borderColor: `${teamColor}99`, shadowColor: teamColor }]}>
          {/* The scoring team's colors. */}
          <LinearGradient colors={[shade(teamColor, 0.35), shade(teamColor, 0.7), shade(teamColor, 0.9)]} style={StyleSheet.absoluteFill} />
          <View style={styles.tvCenter}>
            <Text style={styles.city}>{city(scorer)}</Text>
            <Text style={[styles.td, { textShadowColor: teamColor }]}>TOUCHDOWN</Text>
            <Text style={styles.tdSub}>{scoringHeadline(play, game)}</Text>
          </View>
          <Text style={styles.live}>LIVE</Text>
          <View style={styles.bug}>
            <View style={[styles.team, { backgroundColor: nflTeamColor(game.away_team.abbr) ?? '#2b2d31' }]}>
              <Text style={styles.teamAbbr}>{game.away_team.abbr}</Text>
              <Text style={styles.teamScore}>{game.away_team.score}</Text>
            </View>
            <View style={[styles.team, { backgroundColor: nflTeamColor(game.home_team.abbr) ?? '#2b2d31' }]}>
              <Text style={styles.teamAbbr}>{game.home_team.abbr}</Text>
              <Text style={styles.teamScore}>{game.home_team.score}</Text>
            </View>
            <Text style={styles.pat}>PAT attempt</Text>
          </View>
        </View>

        {players.length > 0 && (
          <View style={styles.meant}>
            <Text style={styles.section}>WHAT THAT PLAY MEANT</Text>
            {players.map((p, i) => (
              <View key={p.player_id} style={[styles.impact, p.is_mine && i === 0 ? { backgroundColor: `${accent}14`, borderColor: `${accent}59` } : p.is_mine ? { backgroundColor: `${accent}0d` } : null]}>
                <View style={[styles.avatar, { backgroundColor: nflTeamColor(scorer) ?? '#2b2d31' }]}>
                  <Text style={styles.avatarText}>{initials(p.player_name)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.impactName}>{p.player_name}</Text>
                  <Text style={styles.impactSub} numberOfLines={1}>
                    {p.is_mine ? `Your ${p.position === 'DEF' ? 'D/ST' : p.position}` : `${p.owner_name}'s`} · {p.team_name}
                  </Text>
                </View>
                <Text style={[styles.impactPts, { color: p.points >= 0 ? accent : '#f87171' }]}>
                  {p.points >= 0 ? '+' : '−'}
                  {Math.abs(p.points).toFixed(1)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {winNow !== null && (
          <View style={styles.odds}>
            <View>
              <Text style={styles.oddsLabel}>Your win odds</Text>
              <Text style={styles.oddsValue}>
                {winBefore !== null && winBefore !== winNow ? `${Math.round(winBefore)}% ` : ''}
                {winBefore !== null && winBefore !== winNow ? <Text style={styles.arrow}>→ </Text> : null}
                <Text style={{ color: accent }}>{Math.round(winNow)}%</Text>
              </Text>
            </View>
            <Spark values={winHistory} color={accent} />
          </View>
        )}

        {hitLeg && (
          <View style={styles.bet}>
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#93c5fd" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M20 6L9 17l-5-5" />
            </Svg>
            <Text style={styles.betText}>
              <Text style={styles.bold}>{hitLeg.leg.description}</Text> hit ·{' '}
              {hitLeg.b.legs.filter((l) => l.status === 'won').length} of {hitLeg.b.legs.length} legs in
            </Text>
          </View>
        )}

        <View style={styles.reactions}>
          <View style={styles.reactionRow}>
            {reactions.letsgo > 0 && <Text style={[styles.reaction, { backgroundColor: `${accent}26` }]}>{`LET'S GO ×${reactions.letsgo}`}</Text>}
            {reactions.robbed > 0 && <Text style={[styles.reaction, styles.robbed]}>ROBBED ×{reactions.robbed}</Text>}
            {reactions.chug > 0 && <Text style={[styles.reaction, styles.chug]}>CHUG! ×{reactions.chug}</Text>}
          </View>
          {lastMessages.slice(-2).map((m, i) => (
            <Text key={i} style={styles.message} numberOfLines={1}>
              <Text style={[styles.bold, { color: m.color }]}>{m.name}</Text> {m.body}
            </Text>
          ))}
        </View>

        <View style={styles.footer}>
          <Pressable onPress={share} style={[styles.primary, { backgroundColor: accent }]} accessibilityRole="button">
            <Text style={styles.primaryText}>Share the moment</Text>
          </Pressable>
          <Pressable onPress={onClose} style={styles.secondary} accessibilityRole="button" accessibilityHint="Closes on its own in a few seconds">
            <Text style={styles.secondaryText}>Back to the game</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

function Spark({ values, color }: { values: number[]; color: string }) {
  const pts = values.slice(-12);
  if (pts.length < 2) return null;
  const w = 150;
  const h = 44;
  const coords = pts.map((v, i) => [(i / (pts.length - 1)) * w, h - 4 - (v / 100) * (h - 8)] as const);
  const last = coords[coords.length - 1];
  return (
    <Svg width={w} height={h} style={{ marginLeft: 'auto' }}>
      <Polyline points={coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" />
      <Circle cx={last[0]} cy={last[1]} r={3.5} fill={color} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b0d14' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 8 },
  title: { color: '#f3f4f6', fontFamily: Fonts.displayBold, fontSize: 18, letterSpacing: 0.5 },
  sub: { color: '#9aa3b2', fontSize: 11 },
  clock: { color: '#fda4af', fontFamily: Fonts.mono, fontSize: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(220,20,60,0.18)', overflow: 'hidden' },
  tv: { height: 250, marginHorizontal: 10, borderRadius: 14, overflow: 'hidden', borderWidth: 1, shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: { width: 0, height: 0 } },
  tvCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingBottom: 30 },
  city: { color: 'rgba(255,255,255,0.8)', fontFamily: Fonts.display, fontSize: 13, letterSpacing: 4 },
  td: { color: '#fff', fontFamily: Fonts.displayBold, fontSize: 52, lineHeight: 56, letterSpacing: 2, textShadowRadius: 18, textShadowOffset: { width: 0, height: 0 } },
  tdSub: { color: 'rgba(255,255,255,0.92)', fontSize: 14, textAlign: 'center', paddingHorizontal: 16 },
  live: { position: 'absolute', top: 10, left: 10, backgroundColor: '#dc143c', color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 1, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, overflow: 'hidden' },
  bug: { position: 'absolute', left: 10, right: 10, bottom: 10, height: 36, flexDirection: 'row', alignItems: 'stretch', borderRadius: 8, overflow: 'hidden', backgroundColor: 'rgba(8,10,16,0.88)' },
  team: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10 },
  teamAbbr: { color: '#fff', fontFamily: Fonts.displayBold, fontSize: 14 },
  teamScore: { color: '#fff', fontFamily: Fonts.monoBold, fontSize: 17 },
  pat: { alignSelf: 'center', paddingHorizontal: 10, color: '#facc15', fontFamily: Fonts.mono, fontSize: 11 },
  meant: { marginHorizontal: 10, marginTop: 12, gap: 8 },
  section: { color: '#9aa3b2', fontFamily: Fonts.display, fontSize: 11, letterSpacing: 1.2 },
  impact: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: '#12151d', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontFamily: Fonts.displayBold, fontSize: 13 },
  impactName: { color: '#f3f4f6', fontSize: 14, fontWeight: '700' },
  impactSub: { color: '#9aa3b2', fontSize: 11.5 },
  impactPts: { fontFamily: Fonts.monoBold, fontSize: 20 },
  odds: { marginHorizontal: 10, marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: '#12151d', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', flexDirection: 'row', alignItems: 'center', gap: 12 },
  oddsLabel: { color: '#9aa3b2', fontSize: 11 },
  oddsValue: { color: '#f3f4f6', fontFamily: Fonts.monoBold, fontSize: 22 },
  arrow: { color: '#9aa3b2', fontSize: 14 },
  bet: { marginHorizontal: 10, marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(96,165,250,0.10)', borderWidth: 1, borderColor: 'rgba(96,165,250,0.35)' },
  betText: { color: '#f3f4f6', fontSize: 13, flex: 1 },
  bold: { fontWeight: '700' },
  reactions: { flex: 1, justifyContent: 'flex-end', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  reactionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reaction: { color: '#f3f4f6', fontSize: 12, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, overflow: 'hidden' },
  robbed: { backgroundColor: 'rgba(248,113,113,0.15)' },
  chug: { backgroundColor: 'rgba(250,204,21,0.15)' },
  message: { color: '#d1d5db', fontSize: 13 },
  footer: { flexDirection: 'row', gap: 8, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', backgroundColor: '#0e1018' },
  primary: { flex: 1, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#06110a', fontSize: 14, fontWeight: '700' },
  secondary: { flex: 1, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: '#12151d' },
  secondaryText: { color: '#f3f4f6', fontSize: 14, fontWeight: '600' },
});
