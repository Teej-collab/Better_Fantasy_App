import type { TrackReference } from '@livekit/react-native';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LoungeTv } from '@/components/lounge/LoungeTv';
import { Text } from '@/components/Text';
import { Fonts } from '@/constants/theme';
import { useAppearance } from '@/lib/appearance';
import { formatStatLine } from '@/lib/matchups';
import { lastName, onField, startersInGame, type LoungeSweat } from '@/lib/loungeSweat';
import type { Bet, BetLeg, LiveGame, RosterPlayer } from '@/lib/types';

const fmt = (n: number | null | undefined) => (n ?? 0).toFixed(1);

/** A bet leg in the TV's game, if any — for the card's bet chip. */
function legInGame(bets: Bet[], game: LiveGame | null): BetLeg | null {
  if (!game) return null;
  const teams = new Set([game.home_team.abbr, game.away_team.abbr]);
  for (const b of bets) {
    for (const leg of b.legs) {
      if (leg.status === 'open' && (leg.espn_event_id === game.game_id || (leg.team_abbr && teams.has(leg.team_abbr)))) return leg;
    }
  }
  return null;
}

function legShort(leg: BetLeg): string {
  const who = leg.player_name ? lastName(leg.player_name) : (leg.team_abbr ?? '');
  const line = leg.line !== null ? ` ${leg.direction === 'under' ? 'u' : 'o'}${leg.line}` : '';
  const now = leg.current !== null ? ` · ${leg.current}` : '';
  return `Bet: ${who}${line}${now}`;
}

// Mockup 1's "YOUR SWEAT" card under the field.
export function SweatCard({ sweat, game, onOpen }: { sweat: LoungeSweat; game: LiveGame | null; onOpen: () => void }) {
  const accent = useAppearance().accent;
  if (!sweat.ready) return null;
  const total = sweat.myScore + sweat.opponentScore;
  const share = sweat.winPct ?? (total > 0 ? (sweat.myScore / total) * 100 : 50);
  const mine = startersInGame(sweat.myStarters, game);
  const leg = legInGame(sweat.openBets, game);
  return (
    <Pressable onPress={onOpen} style={[styles.card, { borderColor: `${accent}40` }]} accessibilityRole="button" accessibilityLabel="Open your sweat">
      <View style={styles.cardHead}>
        <Text style={[styles.kicker, { color: accent }]}>YOUR SWEAT</Text>
        <Text style={styles.open}>Open ›</Text>
      </View>
      <View style={styles.scoreRow}>
        <Text style={styles.teamName} numberOfLines={1}>
          {sweat.myTeamName}
        </Text>
        <Text style={styles.score}>{fmt(sweat.myScore)}</Text>
        <View style={styles.bar}>
          <View style={[styles.barFill, { width: `${Math.max(2, Math.min(98, share))}%`, backgroundColor: accent }]} />
        </View>
        <Text style={styles.score}>{fmt(sweat.opponentScore)}</Text>
        <Text style={styles.oppName} numberOfLines={1}>
          {sweat.opponentName}
        </Text>
      </View>
      <View style={styles.chips}>
        {sweat.winPct !== null && <Text style={[styles.chip, styles.chipGold]}>{Math.round(sweat.winPct)}% to win</Text>}
        {mine.slice(0, 2).map((p) => (
          <Text key={String(p.player_id)} style={styles.chip}>
            {lastName(p.player_name)} {fmt(p.points_scored)}
            {onField(p, game) ? ' · on field' : ''}
          </Text>
        ))}
        {leg && <Text style={[styles.chip, styles.chipBlue]}>{legShort(leg)}</Text>}
      </View>
    </Pressable>
  );
}

// Mockup 3: the sheet that slides up over the game.
export function SweatSheet({
  visible,
  onClose,
  sweat,
  game,
  share,
  catchingUp,
}: {
  visible: boolean;
  onClose: () => void;
  sweat: LoungeSweat;
  game: LiveGame | null;
  share: TrackReference | undefined;
  catchingUp: boolean;
}) {
  const accent = useAppearance().accent;
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'matchup' | 'bets' | 'league'>('matchup');
  const playing = sweat.myStarters.filter((p) => p.game_status === 'in_progress');
  const toPlay = sweat.myStarters.filter((p) => p.game_status === 'scheduled' || p.game_status === null);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="overFullScreen" transparent>
      <View style={[styles.sheetScreen, { paddingTop: insets.top }]}>
        <LoungeTv share={share} game={game} catchingUp={catchingUp} height={150} compact />
        <View style={styles.sheet}>
          <View style={styles.grabberRow}>
            <View style={styles.grabber} />
          </View>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>MY SWEAT</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
              <Text style={styles.done}>Done</Text>
            </Pressable>
          </View>
          <View style={styles.tabs} accessibilityRole="tablist">
            {(['matchup', 'bets', 'league'] as const).map((id) => {
              const on = tab === id;
              return (
                <Pressable
                  key={id}
                  onPress={() => setTab(id)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  style={[styles.tab, on && { backgroundColor: accent, borderColor: accent }]}>
                  <Text style={[styles.tabText, on && styles.tabTextOn]}>{id === 'matchup' ? 'Matchup' : id === 'bets' ? 'Bets' : 'League'}</Text>
                </Pressable>
              );
            })}
          </View>
          <ScrollView contentContainerStyle={[styles.sheetBody, { paddingBottom: insets.bottom + 16 }]}>
            {tab === 'matchup' && (
              <>
                <View style={styles.versus}>
                  <View style={styles.versusSide}>
                    <Text style={styles.versusName}>{sweat.myTeamName} · you</Text>
                    <Text style={styles.versusScore}>{fmt(sweat.myScore)}</Text>
                    <Text style={styles.versusProj}>proj {fmt(sweat.myProjected)}</Text>
                  </View>
                  <View style={styles.versusMid}>
                    <Text style={[styles.versusPct, { color: accent }]}>{sweat.winPct !== null ? `${Math.round(sweat.winPct)}%` : '—'}</Text>
                    <Text style={styles.toWin}>TO WIN</Text>
                  </View>
                  <View style={[styles.versusSide, styles.right]}>
                    <Text style={styles.versusName}>{sweat.opponentName}</Text>
                    <Text style={styles.versusScore}>{fmt(sweat.opponentScore)}</Text>
                    <Text style={styles.versusProj}>proj {fmt(sweat.opponentProjected)}</Text>
                  </View>
                </View>
                {playing.length > 0 && <Text style={styles.section}>PLAYING NOW</Text>}
                {playing.map((p) => (
                  <PlayerRow key={String(p.player_id)} p={p} dot={p.is_redzone ? '#f87171' : accent} status={statusFor(p, game)} value={fmt(p.points_scored)} />
                ))}
                {toPlay.length > 0 && <Text style={styles.section}>STILL TO PLAY</Text>}
                {toPlay.map((p) => (
                  <PlayerRow key={String(p.player_id)} p={p} dot="#4b5263" status={`${p.pro_team ?? ''} · ${p.game_time ?? 'Upcoming'}`} value={`proj ${fmt(p.points_projected)}`} muted />
                ))}
              </>
            )}
            {tab === 'bets' &&
              (sweat.openBets.length === 0 ? (
                <Text style={styles.empty}>No open bets. Add one from Bets.</Text>
              ) : (
                sweat.openBets.map((b) => (
                  <View key={b.id} style={styles.betCard}>
                    <View style={styles.betHead}>
                      <Text style={styles.betTitle}>{b.legs.length > 1 ? `${b.legs.length}-leg parlay` : 'Straight bet'}</Text>
                      {b.payout ? <Text style={styles.betWin}>to win ${b.payout.toFixed(0)}</Text> : null}
                    </View>
                    {b.legs.map((leg) => {
                      const pct = leg.status === 'won' ? 100 : leg.current !== null && leg.target ? Math.min(100, (leg.current / leg.target) * 100) : 0;
                      const color = leg.status === 'won' ? accent : leg.status === 'lost' ? '#f87171' : '#93c5fd';
                      return (
                        <View key={leg.id} style={styles.leg}>
                          <View style={styles.legHead}>
                            <Text style={styles.legText} numberOfLines={1}>
                              {leg.description}
                            </Text>
                            <Text style={[styles.legProgress, { color }]}>
                              {leg.status === 'won' ? 'Hit' : leg.status === 'lost' ? 'Missed' : leg.current !== null ? `${leg.current} / ${leg.target ?? leg.line ?? ''}` : 'Live'}
                            </Text>
                          </View>
                          <View style={styles.legBar}>
                            <View style={[styles.legFill, { width: `${pct}%`, backgroundColor: color }]} />
                          </View>
                        </View>
                      );
                    })}
                  </View>
                ))
              ))}
            {tab === 'league' &&
              sweat.league.map((m) => (
                <View key={m.matchup_id} style={styles.leagueRow}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.leagueLine} numberOfLines={1}>
                      <Text style={styles.bold}>{m.home.team_name}</Text> {fmt(m.home.score)}
                    </Text>
                    <Text style={styles.leagueLine} numberOfLines={1}>
                      <Text style={styles.bold}>{m.away.team_name}</Text> {fmt(m.away.score)}
                    </Text>
                  </View>
                  {m.home.win_probability !== null && (
                    <Text style={styles.odds}>
                      {Math.round(m.home.win_probability)}% / {Math.round(100 - m.home.win_probability)}%
                    </Text>
                  )}
                </View>
              ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function statusFor(p: RosterPlayer, game: LiveGame | null): string {
  const pos = p.position === 'DEF' ? 'D/ST' : (p.position ?? '');
  const line = formatStatLine(p.raw_stats);
  if (line) return `${pos} · ${line}`;
  if (onField(p, game) || p.on_offense) return `${pos} · ${p.pro_team} ball, on the field`;
  if (p.is_redzone) return `${pos} · ${p.pro_team} in the red zone`;
  return `${pos} · ${p.pro_team ?? ''}`;
}

function PlayerRow({ p, dot, status, value, muted }: { p: RosterPlayer; dot: string; status: string; value: string; muted?: boolean }) {
  return (
    <View style={styles.playerRow}>
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.playerName}>{p.player_name}</Text>
        <Text style={styles.playerStatus} numberOfLines={1}>
          {status}
        </Text>
      </View>
      <Text style={[styles.playerPts, muted && styles.playerPtsMuted]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 10, marginTop: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: '#12151d', borderWidth: 1, gap: 7 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kicker: { fontFamily: Fonts.display, fontSize: 11, letterSpacing: 1.2 },
  open: { color: '#9aa3b2', fontSize: 11 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  teamName: { color: '#f3f4f6', fontSize: 13, fontWeight: '700', maxWidth: 90 },
  oppName: { color: '#9aa3b2', fontSize: 13, maxWidth: 80 },
  score: { color: '#f3f4f6', fontFamily: Fonts.monoBold, fontSize: 13 },
  bar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: '#2b2f3a', overflow: 'hidden' },
  barFill: { height: '100%' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { color: '#f3f4f6', fontSize: 11.5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
  chipGold: { backgroundColor: 'rgba(250,204,21,0.12)', color: '#fde68a' },
  chipBlue: { backgroundColor: 'rgba(96,165,250,0.12)', color: '#bfdbfe' },
  sheetScreen: { flex: 1, backgroundColor: '#05060a' },
  sheet: { flex: 1, marginTop: 10, borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: '#0f121a', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  grabberRow: { alignItems: 'center', paddingTop: 8 },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)' },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  sheetTitle: { color: '#f3f4f6', fontFamily: Fonts.displayBold, fontSize: 20, letterSpacing: 0.5 },
  done: { color: '#9aa3b2', fontSize: 14 },
  tabs: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingBottom: 10 },
  tab: { flex: 1, height: 34, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: '#161a24', alignItems: 'center', justifyContent: 'center' },
  tabText: { color: '#f3f4f6', fontSize: 13, fontWeight: '700' },
  tabTextOn: { color: '#06110a' },
  sheetBody: { paddingHorizontal: 16, gap: 10 },
  versus: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderRadius: 14, backgroundColor: '#161a24', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  versusSide: { gap: 2, flex: 1 },
  right: { alignItems: 'flex-end' },
  versusName: { color: '#9aa3b2', fontSize: 12 },
  versusScore: { color: '#f3f4f6', fontFamily: Fonts.monoBold, fontSize: 26 },
  versusProj: { color: '#9aa3b2', fontSize: 11 },
  versusMid: { alignItems: 'center', gap: 2, paddingHorizontal: 6 },
  versusPct: { fontFamily: Fonts.monoBold, fontSize: 22 },
  toWin: { color: '#9aa3b2', fontSize: 10, letterSpacing: 1 },
  section: { color: '#9aa3b2', fontFamily: Fonts.display, fontSize: 11, letterSpacing: 1.2 },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, backgroundColor: '#161a24' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  playerName: { color: '#f3f4f6', fontSize: 14, fontWeight: '700' },
  playerStatus: { color: '#9aa3b2', fontSize: 11.5 },
  playerPts: { color: '#f3f4f6', fontFamily: Fonts.monoBold, fontSize: 16 },
  playerPtsMuted: { color: '#9aa3b2', fontFamily: Fonts.mono, fontSize: 13 },
  empty: { color: '#9aa3b2', fontSize: 14, textAlign: 'center', paddingVertical: 24 },
  betCard: { padding: 12, borderRadius: 14, backgroundColor: '#161a24', borderWidth: 1, borderColor: 'rgba(96,165,250,0.35)', gap: 10 },
  betHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  betTitle: { color: '#f3f4f6', fontSize: 14, fontWeight: '700' },
  betWin: { color: '#93c5fd', fontFamily: Fonts.mono, fontSize: 13 },
  leg: { gap: 5 },
  legHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  legText: { color: '#f3f4f6', fontSize: 13, flex: 1 },
  legProgress: { fontFamily: Fonts.mono, fontSize: 13 },
  legBar: { height: 6, borderRadius: 3, backgroundColor: '#2b2f3a', overflow: 'hidden' },
  legFill: { height: '100%' },
  leagueRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: '#161a24' },
  leagueLine: { color: '#f3f4f6', fontSize: 13 },
  bold: { fontWeight: '700' },
  odds: { color: '#f3f4f6', fontFamily: Fonts.mono, fontSize: 12, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
});
