import { requireOptionalNativeModule } from 'expo';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { GamecastBets } from '@/components/bets/GamecastBets';
import { BoxScore } from '@/components/gamecast/BoxScore';
import { GamecastField } from '@/components/gamecast/GamecastField';
import { DriveChart, LastPlayCard, PlayByPlay, Scoreboard, ScoringCard, StakeCard } from '@/components/gamecast/GamecastSections';
import { MomentBanner, useGameMoments } from '@/components/gamecast/MomentBanner';
import { LoadingState, MessageState } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { trackGamecastGameSelected } from '@/lib/analytics';
import { useAppearance } from '@/lib/appearance';
import { api, gamecastSocketUrl } from '@/lib/api';
import { isLive, lastSnap } from '@/lib/gamecast';
import { queryClient, useFantasyImpact, useGamecastBoxScore, useGamecastGame, usePlayFantasy } from '@/lib/queries';
import type { LiveGame } from '@/lib/types';

const RECONNECT_DELAY_MS = 2000;

// The Gamecast WebSocket pushes the whole game state on every scheduler
// poll (backend/app/scheduler.py's _run_gamecast_poll_job); anything
// else it sends is a fantasy-points event, so refresh that panel.
function useGamecastSocket(gameId: string, enabled: boolean): boolean {
  const [connected, setConnected] = useState(false);
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
      socket.onopen = () => setConnected(true);
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
        setConnected(false);
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
  return connected;
}

// Keeps the phone from dimming while a game is live — you're watching.
// expo-keep-awake ships with expo, but check anyway before loading it.
const canKeepAwake = requireOptionalNativeModule('ExpoKeepAwake') !== null;
const KEEP_AWAKE_TAG = 'gamecast';

function useKeepAwakeWhile(active: boolean) {
  useEffect(() => {
    if (!active || !canKeepAwake) return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const KeepAwake = require('expo-keep-awake') as typeof import('expo-keep-awake');
    void KeepAwake.activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      void KeepAwake.deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [active]);
}

export default function GamecastScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // The web's gamecast_game_selected feature event.
  useEffect(() => trackGamecastGameSelected(id), [id]);
  const game = useGamecastGame(id);
  const live = game.data ? isLive(game.data) : false;
  // Finished games never change, so only a live or upcoming game
  // holds a socket open.
  const connected = useGamecastSocket(id, !!game.data && game.data.status !== 'final');
  const impact = useFantasyImpact(id, live);
  const box = useGamecastBoxScore(id, live);
  const accent = useAppearance().accent;
  const lastPlay = game.data ? lastSnap(game.data) : null;
  const playFantasy = usePlayFantasy(id, lastPlay?.play_id ?? null, live);
  const { moment, dismiss } = useGameMoments(game.data, lastPlay, playFantasy.data);
  useKeepAwakeWhile(live);
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([game.refetch(), impact.refetch(), playFantasy.refetch(), box.refetch()]);
    setRefreshing(false);
  }

  if (game.isPending) return <LoadingState />;
  if (game.isError || !game.data) return <MessageState message="Couldn't load this game." />;
  const g = game.data;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: `${g.away_team.abbr} @ ${g.home_team.abbr}` }} />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}>
        <Scoreboard game={g} connected={connected} />
        <GamecastField game={g} />
        {g.status !== 'scheduled' && <LastPlayCard play={lastPlay} fantasy={playFantasy.data ?? []} />}
        <GamecastBets gameId={g.game_id} live={live} />
        {impact.data && <StakeCard impact={impact.data} />}
        {box.data && <BoxScore box={box.data} impact={impact.data} accent={accent} />}
        <ScoringCard game={g} />
        <DriveChart game={g} />
        <PlayByPlay game={g} />
      </ScrollView>
      <MomentBanner moment={moment} onDismiss={dismiss} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.md },
});
