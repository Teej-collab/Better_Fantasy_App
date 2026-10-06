import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { LoungeTickers } from '@/components/lounge/LoungeTickers';
import { Text } from '@/components/Text';
import { Fonts } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { haptics } from '@/lib/haptics';
import { enterPartyRoom } from '@/lib/loungeSession';
import { lastName } from '@/lib/loungeSweat';
import { queryClient, useLoungeLobby, useWatchPartyRooms } from '@/lib/queries';
import type { LoungeLobbyGame, WatchPartyRoom } from '@/lib/types';

const FACE_COLORS = ['#7c2d12', '#4c1d95', '#1e3a8a', '#065f46', '#831843', '#3f3f46'];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();
}

function scoreLine(g: LoungeLobbyGame): string {
  if (g.state === 'pre') return `${g.away_team} @ ${g.home_team}`;
  return `${g.away_team} ${g.away_score ?? 0} · ${g.home_team} ${g.home_score ?? 0}`;
}

/** "2 of yours · Gibbs in the red zone", "1 of yours · 3 of Mile High's". */
function stakesLine(g: LoungeLobbyGame): { text: string; tone: 'mine' | 'theirs' | 'none' } {
  if (g.state === 'post') return { text: 'Final', tone: 'none' };
  const parts: string[] = [];
  if (g.my_players.length) parts.push(`${g.my_players.length} of yours`);
  if (g.is_redzone && g.my_players.length) parts.push(`${lastName(g.my_players[0])}'s team in the red zone`);
  else if (g.opponent_players.length) parts.push(`${g.opponent_players.length} of ${g.opponent_team_name ?? 'your opponent'}'s`);
  if (g.open_bet_legs) parts.push(`${g.open_bet_legs} bet${g.open_bet_legs === 1 ? '' : 's'} riding`);
  if (parts.length === 0) return { text: 'No stakes — just a good game', tone: 'none' };
  return { text: parts.join(' · '), tone: g.my_players.length ? 'mine' : 'theirs' };
}

// The Lounge lobby (mockup 4) — the Lounge tab: who's watching what, the
// games that matter to you right now, and one tap to start a room for one.
export function LoungeLobby() {
  const accent = useAppearance().accent;
  const rooms = useWatchPartyRooms().data;
  const lobby = useLoungeLobby().data;
  const [joining, setJoining] = useState<number | null>(null);
  const games = lobby?.games ?? [];
  const gameById = new Map(games.map((g) => [g.game_id, g]));
  const open = rooms?.open_room ?? null;
  const privateRooms = rooms?.private_rooms ?? [];
  const parties = rooms?.party_rooms ?? [];
  const anyLive = !!open?.is_live || parties.some((r) => r.is_live) || privateRooms.some((r) => r.is_live);
  const [starting, setStarting] = useState(false);

  /** A new open room for the whole league, optionally on this game. */
  async function startParty(gameId?: string) {
    if (starting) return;
    haptics.tap();
    setStarting(true);
    try {
      const { id } = await api.createWatchParty(gameId);
      await enterPartyRoom({ id, kind: 'party', name: 'Watch party' });
    } catch (e) {
      Alert.alert("Couldn't start the party", e instanceof Error ? e.message : 'Try again in a moment.');
    } finally {
      setStarting(false);
      void queryClient.invalidateQueries({ queryKey: ['watch-party-rooms'] });
    }
  }
  const mattering = games.filter((g) => g.state !== 'post').slice(0, 4);

  async function enter(room: WatchPartyRoom, gameId?: string) {
    if (joining !== null) return;
    setJoining(room.id);
    try {
      await enterPartyRoom(room, gameId);
    } catch (e) {
      Alert.alert("Couldn't join the room", e instanceof Error ? e.message : 'Try again in a moment.');
    } finally {
      setJoining(null);
      void queryClient.invalidateQueries({ queryKey: ['watch-party-rooms'] });
    }
  }

  function startRoom(g: LoungeLobbyGame) {
    if (!open) return;
    // The League Lounge takes the game unless it's already watching
    // a different one with people in it — then it gets its own party.
    if (!open.is_live || !open.tv_game_id || open.tv_game_id === g.game_id) {
      void enter(open, g.game_id);
      return;
    }
    void startParty(g.game_id);
  }

  return (
    <View style={styles.screen}>
      <LoungeTickers tvGame={null} delaySeconds={0} />
      {/* automatic insets keep the end of the list clear of iOS's
          floating tab bar, which was covering the button below. */}
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 24 }]} contentInsetAdjustmentBehavior="automatic">
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            THE LOUNGE
          </Text>
          <Text style={styles.tagline}>Watch it together. Sweat it together.</Text>
        </View>

        <Text style={styles.section}>{anyLive ? 'LIVE NOW' : 'ROOMS'}</Text>
        {open && <LoungeCard room={open} game={open.tv_game_id ? gameById.get(open.tv_game_id) : undefined} accent={accent} busy={joining === open.id} onPress={() => void enter(open)} />}
        {parties.length > 0 && <Text style={[styles.section, { marginTop: 8 }]}>WATCH PARTIES — OPEN TO THE LEAGUE</Text>}
        {parties.map((r) => {
          const g = r.tv_game_id ? gameById.get(r.tv_game_id) : undefined;
          return (
            <View key={r.id} style={[styles.privateRow, r.is_live && styles.partyLive]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.privateName} numberOfLines={1}>
                  {r.is_live ? '● ' : ''}
                  {r.name}
                </Text>
                <Text style={styles.privateSub} numberOfLines={1}>
                  {g ? `${scoreLine(g)} on the TV` : 'Nothing on the TV yet'}
                  {r.is_live ? ` · ${r.watchers?.length ?? 0} watching` : ''}
                </Text>
              </View>
              <Pressable onPress={() => void enter(r)} style={[styles.joinOutline, { backgroundColor: accent, borderColor: accent }]} accessibilityRole="button" accessibilityLabel={`Join ${r.name}`}>
                <Text style={[styles.joinOutlineText, { color: '#06110a' }]}>{joining === r.id ? '…' : 'Join'}</Text>
              </Pressable>
            </View>
          );
        })}

        {privateRooms.map((r) => {
          const g = r.tv_game_id ? gameById.get(r.tv_game_id) : undefined;
          const watching = r.watchers?.length ?? 0;
          return (
            <View key={r.id} style={styles.privateRow}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#9aa3b2" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <Rect x={5} y={11} width={14} height={10} rx={2} />
                <Path d="M8 11V7a4 4 0 018 0v4" />
              </Svg>
              <View style={{ flex: 1 }}>
                <Text style={styles.privateName} numberOfLines={1}>
                  {r.name}
                </Text>
                <Text style={styles.privateSub} numberOfLines={1}>
                  {r.is_live ? `${watching} watching` : `${r.member_count} invited`}
                  {g ? ` · ${g.away_team} @ ${g.home_team}` : ''}
                </Text>
              </View>
              <Pressable onPress={() => void enter(r)} style={styles.joinOutline} accessibilityRole="button" accessibilityLabel={`Join ${r.name}`}>
                <Text style={styles.joinOutlineText}>{joining === r.id ? '…' : 'Join'}</Text>
              </Pressable>
            </View>
          );
        })}

        {mattering.length > 0 && <Text style={[styles.section, { marginTop: 16 }]}>GAMES THAT MATTER TO YOU</Text>}
        {mattering.map((g) => {
          const stakes = stakesLine(g);
          return (
            <View key={g.game_id} style={styles.gameRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.gameScore} numberOfLines={1}>
                  <Text style={styles.bold}>{scoreLine(g)}</Text> <Text style={styles.gameClock}>{g.status_detail ?? ''}</Text>
                </Text>
                <Text style={[styles.stakes, { color: stakes.tone === 'mine' ? accent : stakes.tone === 'theirs' ? '#fde68a' : '#9aa3b2' }]} numberOfLines={1}>
                  {stakes.text}
                </Text>
              </View>
              <Pressable onPress={() => startRoom(g)} style={styles.joinOutline} accessibilityRole="button" accessibilityLabel={`Start a room for ${g.away_team} at ${g.home_team}`}>
                <Text style={styles.joinOutlineText}>Start a room</Text>
              </Pressable>
            </View>
          );
        })}
        <Pressable onPress={() => void startParty()} disabled={starting} style={[styles.cta, { backgroundColor: accent }, starting && { opacity: 0.6 }]} accessibilityRole="button">
          <Text style={styles.ctaText}>{starting ? 'Starting…' : 'Start a watch party'}</Text>
        </Pressable>
        <Text style={styles.ctaHint}>Opens a new room the whole league can join, with its own TV. It closes itself once everyone’s gone.</Text>
      </ScrollView>
    </View>
  );
}

function LoungeCard({ room, game, accent, busy, onPress }: { room: WatchPartyRoom; game: LoungeLobbyGame | undefined; accent: string; busy: boolean; onPress: () => void }) {
  const watchers = room.watchers ?? [];
  const live = room.is_live;
  return (
    <Pressable onPress={onPress} style={[styles.card, live ? styles.cardLive : styles.cardIdle]} accessibilityRole="button" accessibilityLabel={`League Lounge${live ? `, ${watchers.length} watching` : ''}. Jump in`}>
      <View style={styles.cardHead}>
        {live && <Text style={styles.liveBadge}>LIVE</Text>}
        <Text style={styles.cardTitle}>LEAGUE LOUNGE</Text>
        <Text style={[styles.cardCount, !live && { color: '#9aa3b2' }]}>{live ? `${watchers.length} watching` : 'always open'}</Text>
      </View>
      {game ? (
        <Text style={styles.cardGame}>
          <Text style={styles.bold}>{scoreLine(game)}</Text> <Text style={styles.gameClock}>{game.status_detail ?? ''}</Text>
          <Text style={styles.onTv}> on the TV</Text>
        </Text>
      ) : (
        <Text style={styles.onTv}>{live ? 'Hanging out — nothing on the TV yet' : `${room.member_count} in your league`}</Text>
      )}
      <View style={styles.cardFoot}>
        {watchers.slice(0, 5).map((w, i) => (
          <View key={w.owner_id} style={[styles.face, { backgroundColor: FACE_COLORS[i % FACE_COLORS.length], marginLeft: i === 0 ? 0 : -6 }]}>
            <Text style={styles.faceText}>{initials(w.display_name)}</Text>
          </View>
        ))}
        <View style={[styles.jump, { backgroundColor: accent }]}>
          <Text style={styles.jumpText}>{busy ? 'Joining…' : 'Jump in'}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 16 },
  header: { paddingTop: 12, paddingBottom: 8, gap: 4 },
  title: { color: '#f3f4f6', fontFamily: Fonts.displayBold, fontSize: 30, letterSpacing: 0.5 },
  tagline: { color: '#9aa3b2', fontSize: 13 },
  section: { color: '#9aa3b2', fontFamily: Fonts.display, fontSize: 11, letterSpacing: 1.2, marginTop: 8, marginBottom: 10 },
  card: { borderRadius: 16, padding: 14, gap: 10, borderWidth: 1, marginBottom: 10 },
  cardLive: { backgroundColor: 'rgba(220,20,60,0.10)', borderColor: 'rgba(220,20,60,0.45)' },
  cardIdle: { backgroundColor: '#12151d', borderColor: 'rgba(255,255,255,0.08)' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveBadge: { backgroundColor: '#dc143c', color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 1, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, overflow: 'hidden' },
  cardTitle: { color: '#f3f4f6', fontFamily: Fonts.displayBold, fontSize: 18, letterSpacing: 0.4 },
  cardCount: { marginLeft: 'auto', color: '#fecdd3', fontSize: 12 },
  cardGame: { color: '#f3f4f6', fontFamily: Fonts.mono, fontSize: 13 },
  onTv: { color: '#9aa3b2', fontSize: 13, fontFamily: Fonts.body },
  cardFoot: { flexDirection: 'row', alignItems: 'center' },
  face: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#0b0d14' },
  faceText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  jump: { marginLeft: 'auto', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  jumpText: { color: '#06110a', fontSize: 13, fontWeight: '800' },
  privateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, backgroundColor: '#12151d', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginBottom: 10 },
  privateName: { color: '#f3f4f6', fontSize: 14, fontWeight: '700' },
  partyLive: { backgroundColor: 'rgba(220,20,60,0.08)', borderColor: 'rgba(220,20,60,0.4)' },
  ctaHint: { color: '#9aa3b2', fontSize: 12, textAlign: 'center', marginTop: 8 },
  privateSub: { color: '#9aa3b2', fontSize: 12 },
  joinOutline: { height: 36, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  joinOutlineText: { color: '#f3f4f6', fontSize: 12, fontWeight: '700' },
  gameRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, backgroundColor: '#12151d', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginBottom: 10 },
  gameScore: { color: '#f3f4f6', fontFamily: Fonts.mono, fontSize: 14 },
  gameClock: { color: '#9aa3b2', fontSize: 12 },
  bold: { fontFamily: Fonts.monoBold },
  stakes: { fontSize: 12, marginTop: 2 },
  cta: { height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  ctaText: { color: '#06110a', fontSize: 15, fontWeight: '800' },
});
