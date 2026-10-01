import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { LiveBadge } from '@/components/LiveBadge';
import { Card, LoadingState, MessageState, SectionTitle } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { trackGamecastGameSelected } from '@/lib/analytics';
import { api, gamecastSocketUrl } from '@/lib/api';
import { formatPoints } from '@/lib/format';
import { openPlayer, queryClient, useFantasyImpact, useGamecastGame, usePlayFantasy } from '@/lib/queries';
import type { GamecastPlay, ImpactPlayer, LiveGame } from '@/lib/types';

const RECONNECT_DELAY_MS = 2000;
const RECENT_PLAYS = 25;

// The Gamecast WebSocket pushes the whole game state on every scheduler
// poll (backend/app/scheduler.py's _run_gamecast_poll_job); anything
// else it sends is a fantasy-points event, so refresh that panel.
function useGamecastSocket(gameId: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

    async function connect() {
      let ticket: string;
      try {
        ({ ticket } = await api.chatSocketTicket());
      } catch {
        if (!cancelled) retry = setTimeout(connect, RECONNECT_DELAY_MS);
        return;
      }
      if (cancelled) return;
      socket = new WebSocket(gamecastSocketUrl(ticket, gameId));
      socket.onmessage = (e) => {
        let msg: { type?: string; game?: LiveGame };
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.type === 'game_state' && msg.game) {
          queryClient.setQueryData(['gamecast', gameId], msg.game);
        } else if (msg.type !== 'error') {
          void queryClient.invalidateQueries({ queryKey: ['fantasy-impact', gameId] });
        }
      };
      socket.onclose = (e) => {
        // 4401: not signed in. 4404: unknown game.
        if (!cancelled && e.code !== 4401 && e.code !== 4404) retry = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    }

    void connect();
    return () => {
      cancelled = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, [gameId, enabled]);
}

function isLive(game: LiveGame): boolean {
  return game.status === 'in_progress' || game.status === 'halftime';
}

function ordinal(n: number): string {
  return ['1st', '2nd', '3rd', '4th'][n - 1] ?? `${n}th`;
}

export default function GamecastScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // The web's gamecast_game_selected feature event.
  useEffect(() => trackGamecastGameSelected(id), [id]);
  const game = useGamecastGame(id);
  const live = game.data ? isLive(game.data) : false;
  // Finished games never change, so only a live or upcoming game
  // holds a socket open.
  useGamecastSocket(id, !!game.data && game.data.status !== 'final');
  const impact = useFantasyImpact(id, live);
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([game.refetch(), impact.refetch()]);
    setRefreshing(false);
  }

  if (game.isPending) return <LoadingState />;
  if (game.isError || !game.data) return <MessageState message="Couldn't load this game." />;
  const g = game.data;
  const lastPlay = g.plays[0] ?? null;

  return (
    <>
      <Stack.Screen options={{ title: `${g.away_team.abbr} @ ${g.home_team.abbr}` }} />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}>
        <Scoreboard game={g} />
        {live && <FieldCard game={g} />}
        {lastPlay && <LastPlayCard gameId={g.game_id} play={lastPlay} />}

        {impact.data && (
          <>
            <SectionTitle>Fantasy impact</SectionTitle>
            <Card style={styles.listCard}>
              {impact.data.your_team && (
                <ImpactGroup title={`Your players · ${impact.data.your_team.team_name}`} players={impact.data.your_players} />
              )}
              {impact.data.opponent_team && (
                <ImpactGroup
                  title={`Opponent · ${impact.data.opponent_team.team_name}`}
                  players={impact.data.opponent_players}
                />
              )}
              <ImpactGroup title={`${impact.data.game_leaders.away.abbr} leaders`} players={impact.data.game_leaders.away.leaders} />
              <ImpactGroup title={`${impact.data.game_leaders.home.abbr} leaders`} players={impact.data.game_leaders.home.leaders} />
            </Card>
          </>
        )}

        {g.scoring_plays.length > 0 && (
          <>
            <SectionTitle>Scoring</SectionTitle>
            <Card style={styles.listCard}>
              {g.scoring_plays.map((s, i) => (
                <View key={s.play_id} style={[styles.playRow, i > 0 && styles.divided]}>
                  <View style={styles.playMeta}>
                    <Text style={styles.scoreType}>
                      {s.team_abbr} {s.score_type}
                    </Text>
                    <Text style={styles.muted}>
                      {ordinal(s.period)} {s.clock}
                    </Text>
                  </View>
                  <Text style={styles.playText}>{s.description}</Text>
                  <Text style={styles.muted}>
                    {g.away_team.abbr} {s.away_score_after} – {g.home_team.abbr} {s.home_score_after}
                  </Text>
                </View>
              ))}
            </Card>
          </>
        )}

        {g.plays.length > 0 && (
          <>
            <SectionTitle>Play by play</SectionTitle>
            <Card style={styles.listCard}>
              {g.plays.slice(0, RECENT_PLAYS).map((p, i) => (
                <PlayRow key={p.play_id} play={p} divided={i > 0} />
              ))}
            </Card>
          </>
        )}
      </ScrollView>
    </>
  );
}

function Scoreboard({ game }: { game: LiveGame }) {
  const started = game.status !== 'scheduled';
  let status: string;
  if (game.status === 'scheduled') {
    const start = new Date(game.scheduled_start);
    status = `${start.toLocaleDateString(undefined, { weekday: 'short' })} ${start.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })}`;
  } else if (game.status === 'final') status = 'Final';
  else if (game.status === 'halftime') status = 'Halftime';
  else status = [game.period_label, game.clock].filter(Boolean).join(' · ');

  return (
    <Card style={isLive(game) ? styles.liveCard : undefined}>
      {isLive(game) && (
        <View style={styles.center}>
          <LiveBadge />
        </View>
      )}
      <View style={styles.scoreboard}>
        <TeamScore team={game.away_team} started={started} possession={game.possession_team_abbr === game.away_team.abbr} />
        <Text style={styles.status}>{status}</Text>
        <TeamScore team={game.home_team} started={started} possession={game.possession_team_abbr === game.home_team.abbr} />
      </View>
    </Card>
  );
}

function TeamScore(props: { team: LiveGame['home_team']; started: boolean; possession: boolean }) {
  return (
    <View style={styles.teamScore}>
      <Text style={styles.abbr}>
        {props.team.abbr}
        {props.possession ? ' •' : ''}
      </Text>
      <Text style={styles.teamName} numberOfLines={1}>
        {props.team.name}
      </Text>
      {props.started && <Text style={styles.bigScore}>{props.team.score}</Text>}
    </View>
  );
}

// Down, distance and a simple field bar showing how far the offense has
// to go (yards_to_goal: 100 = own goal line, 0 = end zone).
function FieldCard({ game }: { game: LiveGame }) {
  if (game.yards_to_goal === null || !game.possession_team_abbr) return null;
  const progress = Math.min(100, Math.max(0, 100 - game.yards_to_goal));
  const downText = game.down ? `${ordinal(game.down)} & ${game.distance ?? '?'}` : null;
  return (
    <Card style={game.is_redzone ? styles.redzoneCard : undefined}>
      <View style={styles.fieldTop}>
        <Text style={styles.fieldText}>
          {game.possession_team_abbr} ball{game.field_position_label ? ` at ${game.field_position_label}` : ''}
        </Text>
        {downText && <Text style={styles.fieldText}>{downText}</Text>}
      </View>
      <View style={styles.field}>
        <View style={[styles.fieldFill, { width: `${progress}%` }, game.is_redzone && styles.fieldFillRedzone]} />
        <View style={styles.endzone} />
      </View>
      {game.current_drive && (
        <Text style={styles.muted}>
          Drive: {game.current_drive.play_count} plays, {game.current_drive.yards} yds, {game.current_drive.duration}
        </Text>
      )}
    </Card>
  );
}

function LastPlayCard({ gameId, play }: { gameId: string; play: GamecastPlay }) {
  const involved = usePlayFantasy(gameId, play.play_id);
  const leaguePlayers = involved.data ?? [];
  return (
    <>
      <SectionTitle>Last play</SectionTitle>
      <Card style={play.is_scoring_play ? styles.scoringCard : play.is_turnover ? styles.turnoverCard : undefined}>
        <Text style={styles.muted}>
          {ordinal(play.period)} {play.clock}
          {play.down ? ` · ${ordinal(play.down)} & ${play.distance ?? '?'}` : ''}
        </Text>
        <Text style={styles.lastPlay}>{play.description}</Text>
        {leaguePlayers.map((p) => (
          <Text
            key={p.player_id}
            onPress={() => openPlayer(p.player_id)}
            style={[styles.involved, p.is_mine && styles.involvedMine, p.is_opponent && styles.involvedOpponent]}>
            {p.player_name} ({p.is_mine ? 'yours' : p.owner_name}) {p.points >= 0 ? '+' : ''}
            {p.points.toFixed(1)}
          </Text>
        ))}
      </Card>
    </>
  );
}

function ImpactGroup({ title, players }: { title: string; players: ImpactPlayer[] }) {
  if (players.length === 0) return null;
  return (
    <View style={styles.impactGroup}>
      <Text style={styles.impactTitle}>{title}</Text>
      {players.map((p) => (
        <View key={`${p.player_name}-${p.position}`} style={styles.impactRow}>
          <Text style={styles.impactName} onPress={() => openPlayer(p.player_id)} numberOfLines={1}>
            {p.player_name} <Text style={styles.muted}>{p.position === 'DEF' ? 'D/ST' : p.position}</Text>
          </Text>
          <Text style={styles.impactPoints}>{formatPoints(p.points_scored)}</Text>
        </View>
      ))}
    </View>
  );
}

function PlayRow({ play, divided }: { play: GamecastPlay; divided: boolean }) {
  return (
    <View style={[styles.playRow, divided && styles.divided]}>
      <View style={styles.playMeta}>
        <Text style={[styles.muted, play.is_scoring_play && styles.scoreType, play.is_turnover && styles.turnover]}>
          {play.team_abbr ? `${play.team_abbr} · ` : ''}
          {ordinal(play.period)} {play.clock}
        </Text>
        {play.down && (
          <Text style={styles.muted}>
            {ordinal(play.down)} & {play.distance ?? '?'}
          </Text>
        )}
      </View>
      <Text style={styles.playText}>{play.description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.md },
  center: { alignItems: 'center', marginBottom: Spacing.md },
  liveCard: { borderColor: Colors.live },
  scoreboard: { flexDirection: 'row', alignItems: 'center' },
  teamScore: { flex: 1, alignItems: 'center', gap: 2 },
  abbr: { color: Colors.text, fontSize: 20, fontWeight: '800' },
  teamName: { color: Colors.textSecondary, fontSize: 12 },
  bigScore: { color: Colors.text, fontSize: 40, fontWeight: '800', fontVariant: ['tabular-nums'] },
  status: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600', textAlign: 'center', width: 96 },
  muted: { color: Colors.textSecondary, fontSize: 12 },
  redzoneCard: { borderColor: Colors.live },
  fieldTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing.sm },
  fieldText: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  field: {
    height: 18,
    borderRadius: 4,
    backgroundColor: '#14321b',
    overflow: 'hidden',
    flexDirection: 'row',
    marginBottom: Spacing.sm,
  },
  fieldFill: { backgroundColor: Colors.accent, opacity: 0.6 },
  fieldFillRedzone: { backgroundColor: Colors.live },
  endzone: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '8%', backgroundColor: 'rgba(255,255,255,0.15)' },
  scoringCard: { borderColor: Colors.accent },
  turnoverCard: { borderColor: Colors.loss },
  lastPlay: { color: Colors.text, fontSize: 16, lineHeight: 22, marginTop: Spacing.xs },
  involved: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600', marginTop: Spacing.sm },
  involvedMine: { color: Colors.accent },
  involvedOpponent: { color: Colors.loss },
  listCard: { padding: 0, overflow: 'hidden' },
  impactGroup: { padding: Spacing.lg, gap: Spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  impactTitle: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  impactRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  impactName: { flex: 1, color: Colors.text, fontSize: 15 },
  impactPoints: { color: Colors.text, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  playRow: { padding: Spacing.lg, gap: 4 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  playMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  playText: { color: Colors.text, fontSize: 14, lineHeight: 20 },
  scoreType: { color: Colors.accent, fontWeight: '800', fontSize: 12 },
  turnover: { color: Colors.loss, fontWeight: '700' },
});
