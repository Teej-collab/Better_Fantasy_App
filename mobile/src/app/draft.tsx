import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppRefreshControl } from '@/components/AppRefreshControl';
import { Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api, draftSocketUrl } from '@/lib/api';
import { formatPoints } from '@/lib/format';
import { openPlayer, queryClient, useDraftPool, useDraftQueue, useDraftState, useMe } from '@/lib/queries';
import type { DraftChatMessage, DraftPick, DraftPoolPlayer, DraftState } from '@/lib/types';

const RECONNECT_DELAY_MS = 2000;
const POSITIONS: { label: string; value: string | undefined }[] = [
  { label: 'All', value: undefined },
  { label: 'QB', value: 'QB' },
  { label: 'RB', value: 'RB' },
  { label: 'WR', value: 'WR' },
  { label: 'TE', value: 'TE' },
  { label: 'D/ST', value: 'DEF' },
  { label: 'K', value: 'K' },
];
type Tab = 'players' | 'queue' | 'board' | 'chat';

function positionLabel(position: string | null): string {
  return position === 'DEF' ? 'D/ST' : (position ?? '');
}

function refreshDraft() {
  void queryClient.invalidateQueries({ queryKey: ['draft-state'] });
  void queryClient.invalidateQueries({ queryKey: ['draft-pool'] });
  void queryClient.invalidateQueries({ queryKey: ['draft-queue'] });
}

// The draft room's WebSocket (backend/app/routers/draft.py's draft_ws),
// open only while this screen is. Presence and chat are applied
// directly; every other event (pick_made, draft_status, pick_undone, …)
// just means "something changed", so refetch — a pick lands about once
// every 90 s, same reasoning as the web's DraftRoom.tsx.
function useDraftSocket(season: number | null) {
  const socketRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (season === null) return;
    let cancelled = false;
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
      const socket = new WebSocket(draftSocketUrl(ticket, season!));
      socketRef.current = socket;
      socket.onopen = () => setConnected(true);
      socket.onclose = (e) => {
        if (socketRef.current === socket) socketRef.current = null;
        setConnected(false);
        // 4401: not signed in. 4404: no draft configured.
        if (!cancelled && e.code !== 4401 && e.code !== 4404) retry = setTimeout(connect, RECONNECT_DELAY_MS);
      };
      socket.onmessage = (e) => {
        let msg: { type?: string; owner_id?: number; online?: boolean; message?: DraftChatMessage };
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.type === 'presence' && typeof msg.owner_id === 'number') {
          const ownerId = msg.owner_id;
          queryClient.setQueryData<DraftState>(['draft-state'], (prev) => {
            if (!prev) return prev;
            const ids = new Set(prev.connected_owner_ids);
            if (msg.online) ids.add(ownerId);
            else ids.delete(ownerId);
            return { ...prev, connected_owner_ids: [...ids] };
          });
        } else if (msg.type === 'chat' && msg.message) {
          const message = msg.message;
          queryClient.setQueryData<DraftState>(['draft-state'], (prev) =>
            prev && !prev.chat_messages.some((m) => m.id === message.id)
              ? { ...prev, chat_messages: [...prev.chat_messages, message] }
              : prev,
          );
        } else if (msg.type !== 'draft_state' && msg.type !== 'error') {
          refreshDraft();
        }
      };
    }

    void connect();
    return () => {
      cancelled = true;
      clearTimeout(retry);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [season]);

  const sendChat = (text: string) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type: 'chat', text }));
    return true;
  };

  return { connected, sendChat };
}

// Seconds until the pick deadline, ticking once a second.
function secondsUntil(deadline: string): number {
  return Math.max(0, Math.round((new Date(deadline).getTime() - Date.now()) / 1000));
}

function useCountdown(deadline: string | null): number | null {
  const [seconds, setSeconds] = useState(() => (deadline ? secondsUntil(deadline) : null));
  useEffect(() => {
    if (!deadline) return;
    const tick = () => setSeconds(secondsUntil(deadline));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline]);
  return deadline ? seconds : null;
}

function formatClock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function DraftScreen() {
  const draft = useDraftState();
  const me = useMe();
  const season = draft.data?.config.season ?? null;
  const { connected, sendChat } = useDraftSocket(season);
  const [tab, setTab] = useState<Tab>('players');

  const config = draft.data?.config;
  const picks = draft.data?.picks ?? [];
  const myOwnerId = me.data?.owner_id ?? null;
  const currentPick = picks.find((p) => p.pick_number === config?.current_pick_number);
  const isMyTurn = config?.status === 'in_progress' && currentPick?.owner_id === myOwnerId;
  const myNextPick = picks.find((p) => p.owner_id === myOwnerId && !p.sleeper_player_id && p.pick_number >= (config?.current_pick_number ?? 0));

  // A buzz the moment it becomes your pick.
  const wasMyTurn = useRef(false);
  useEffect(() => {
    if (isMyTurn && !wasMyTurn.current) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    wasMyTurn.current = isMyTurn;
  }, [isMyTurn]);

  async function draftPlayer(player: { sleeper_player_id: string; full_name: string }) {
    Alert.alert(`Draft ${player.full_name}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Draft',
        onPress: async () => {
          try {
            await api.draftPick(player.sleeper_player_id);
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            refreshDraft();
          } catch (e) {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            Alert.alert("Couldn't make that pick", e instanceof Error ? e.message : 'Try again.');
          }
        },
      },
    ]);
  }

  if (draft.isPending) return <LoadingState />;
  if (draft.isError || !draft.data || !config) return <MessageState message="Your league doesn't have a draft set up yet." />;

  return (
    <View style={styles.screen}>
      <DraftHeader
        state={draft.data}
        currentPick={currentPick}
        isMyTurn={isMyTurn}
        myNextPick={myNextPick}
        connected={connected}
        isCommissioner={me.data?.is_commissioner ?? false}
      />

      <View style={styles.tabs}>
        {(['players', 'queue', 'board', 'chat'] as Tab[]).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t[0].toUpperCase() + t.slice(1)}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'players' && <PlayersView canDraft={isMyTurn} onDraft={draftPlayer} />}
      {tab === 'queue' && <QueueView canDraft={isMyTurn} onDraft={draftPlayer} />}
      {tab === 'board' && <BoardView picks={picks} currentPickNumber={config.current_pick_number} myOwnerId={myOwnerId} />}
      {tab === 'chat' && <ChatView messages={draft.data.chat_messages} myOwnerId={myOwnerId} onSend={sendChat} />}
    </View>
  );
}

function DraftHeader(props: {
  state: DraftState;
  currentPick: DraftPick | undefined;
  isMyTurn: boolean;
  myNextPick: DraftPick | undefined;
  connected: boolean;
  isCommissioner: boolean;
}) {
  const { config } = props.state;
  const seconds = useCountdown(config.status === 'in_progress' ? config.current_pick_deadline : null);
  const online = new Set(props.state.connected_owner_ids);

  let title: string;
  if (config.status === 'not_started') {
    title = config.scheduled_start
      ? `Starts ${new Date(config.scheduled_start).toLocaleString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })}`
      : 'Not started yet';
  } else if (config.status === 'complete') {
    title = 'Draft complete';
  } else {
    title = `Round ${props.currentPick?.round ?? '–'} · Pick ${config.current_pick_number}${config.status === 'paused' ? ' · Paused' : ''}`;
  }

  async function control(action: 'start' | 'pause' | 'resume' | 'undo-last-pick') {
    try {
      await api.draftControl(action);
      refreshDraft();
    } catch (e) {
      Alert.alert("Couldn't do that", e instanceof Error ? e.message : 'Try again.');
    }
  }

  return (
    <View style={[styles.header, props.isMyTurn && styles.headerMyTurn]}>
      <View style={styles.headerTop}>
        <Text style={styles.headerTitle}>{title}</Text>
        {seconds !== null && (
          <Text style={[styles.clock, seconds <= 10 && styles.clockUrgent]}>{formatClock(seconds)}</Text>
        )}
      </View>
      {props.isMyTurn ? (
        <Text style={styles.yourPick}>You&apos;re on the clock</Text>
      ) : (
        config.status === 'in_progress' &&
        props.currentPick && (
          <View style={styles.onClock}>
            <View style={[styles.dot, online.has(props.currentPick.owner_id) && styles.dotOnline]} />
            <Text style={styles.muted}>On the clock: {props.currentPick.owner_name}</Text>
          </View>
        )
      )}
      <Text style={styles.muted}>
        {props.myNextPick && config.status !== 'complete' ? `Your next pick: #${props.myNextPick.pick_number}` : ''}
        {props.connected ? '' : `${props.myNextPick ? '  ·  ' : ''}Reconnecting…`}
      </Text>
      {props.isCommissioner && config.status !== 'complete' && (
        <View style={styles.controls}>
          {config.status === 'not_started' && <ControlButton label="Start draft" onPress={() => control('start')} />}
          {config.status === 'in_progress' && <ControlButton label="Pause" onPress={() => control('pause')} />}
          {config.status === 'paused' && <ControlButton label="Resume" onPress={() => control('resume')} />}
          {config.status !== 'not_started' && (
            <ControlButton
              label="Undo last pick"
              onPress={() =>
                Alert.alert('Undo the last pick?', undefined, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Undo', style: 'destructive', onPress: () => control('undo-last-pick') },
                ])
              }
            />
          )}
        </View>
      )}
    </View>
  );
}

function ControlButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.control, pressed && styles.pressed]}>
      <Text style={styles.controlText}>{label}</Text>
    </Pressable>
  );
}

function PlayersView({ canDraft, onDraft }: { canDraft: boolean; onDraft: (p: DraftPoolPlayer) => void }) {
  const [position, setPosition] = useState<string | undefined>(undefined);
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const pool = useDraftPool(position, search);
  const queue = useDraftQueue();
  const queued = useMemo(() => new Set(queue.data ?? []), [queue.data]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchText.trim()), 300);
    return () => clearTimeout(t);
  }, [searchText]);

  const available = (pool.data ?? []).filter((p) => !p.drafted);

  async function toggleQueue(player: DraftPoolPlayer) {
    void Haptics.selectionAsync();
    try {
      const { queue: next } = queued.has(player.sleeper_player_id)
        ? await api.removeFromDraftQueue(player.sleeper_player_id)
        : await api.addToDraftQueue(player.sleeper_player_id);
      queryClient.setQueryData(['draft-queue'], next);
    } catch (e) {
      Alert.alert("Couldn't update your queue", e instanceof Error ? e.message : 'Try again.');
    }
  }

  return (
    <FlatList
      data={available}
      keyExtractor={(p) => p.sleeper_player_id}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      initialNumToRender={20}
      ListHeaderComponent={
        <View style={styles.filters}>
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Search players"
            placeholderTextColor={Colors.textSecondary}
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={styles.search}
          />
          <View style={styles.chips}>
            {POSITIONS.map((p) => (
              <Pressable
                key={p.label}
                onPress={() => setPosition(p.value)}
                style={[styles.chip, p.value === position && styles.chipActive]}>
                <Text style={[styles.chipText, p.value === position && styles.chipTextActive]}>{p.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      }
      ListEmptyComponent={pool.isPending ? <LoadingState /> : <MessageState message="No players match." />}
      renderItem={({ item }) => (
        <PlayerRow
          name={item.full_name}
          detail={`${positionLabel(item.position)}${item.pro_team ? ` · ${item.pro_team}` : ''}${item.bye_week ? ` · Bye ${item.bye_week}` : ''}`}
          value={formatPoints(item.projected_points)}
          onOpen={() => openPlayer(item.sleeper_player_id)}
          actions={
            <>
              <Pressable onPress={() => toggleQueue(item)} hitSlop={8} style={styles.iconButton}>
                <Text style={[styles.star, queued.has(item.sleeper_player_id) && styles.starOn]}>
                  {queued.has(item.sleeper_player_id) ? '★' : '☆'}
                </Text>
              </Pressable>
              {canDraft && <DraftButton onPress={() => onDraft(item)} />}
            </>
          }
        />
      )}
    />
  );
}

function QueueView({ canDraft, onDraft }: { canDraft: boolean; onDraft: (p: DraftPoolPlayer) => void }) {
  const queue = useDraftQueue();
  // Names come from the full pool; the queue itself is just ids.
  const pool = useDraftPool(undefined, '');
  const byId = useMemo(() => new Map((pool.data ?? []).map((p) => [p.sleeper_player_id, p])), [pool.data]);
  const ids = queue.data ?? [];

  async function save(next: string[]) {
    queryClient.setQueryData(['draft-queue'], next);
    try {
      const { queue: saved } = await api.reorderDraftQueue(next);
      queryClient.setQueryData(['draft-queue'], saved);
    } catch (e) {
      void queue.refetch();
      Alert.alert("Couldn't reorder", e instanceof Error ? e.message : 'Try again.');
    }
  }

  function move(index: number, by: number) {
    const target = index + by;
    if (target < 0 || target >= ids.length) return;
    void Haptics.selectionAsync();
    const next = [...ids];
    [next[index], next[target]] = [next[target], next[index]];
    void save(next);
  }

  async function remove(id: string) {
    try {
      const { queue: next } = await api.removeFromDraftQueue(id);
      queryClient.setQueryData(['draft-queue'], next);
    } catch (e) {
      Alert.alert("Couldn't remove", e instanceof Error ? e.message : 'Try again.');
    }
  }

  if (queue.isPending) return <LoadingState />;
  if (ids.length === 0) return <MessageState message="Star players on the Players tab to line them up here." />;

  return (
    <FlatList
      data={ids}
      keyExtractor={(id) => id}
      renderItem={({ item: id, index }) => {
        const player = byId.get(id);
        return (
          <PlayerRow
            rank={index + 1}
            name={player?.full_name ?? 'Loading…'}
            detail={player ? `${positionLabel(player.position)}${player.pro_team ? ` · ${player.pro_team}` : ''}` : ''}
            value={player?.drafted ? 'Taken' : formatPoints(player?.projected_points)}
            onOpen={() => openPlayer(id)}
            actions={
              <>
                <Pressable onPress={() => move(index, -1)} hitSlop={6} style={styles.iconButton}>
                  <Text style={styles.arrow}>▲</Text>
                </Pressable>
                <Pressable onPress={() => move(index, 1)} hitSlop={6} style={styles.iconButton}>
                  <Text style={styles.arrow}>▼</Text>
                </Pressable>
                <Pressable onPress={() => remove(id)} hitSlop={6} style={styles.iconButton}>
                  <Text style={styles.removeX}>✕</Text>
                </Pressable>
                {canDraft && player && !player.drafted && <DraftButton onPress={() => onDraft(player)} />}
              </>
            }
          />
        );
      }}
    />
  );
}

function BoardView({ picks, currentPickNumber, myOwnerId }: { picks: DraftPick[]; currentPickNumber: number; myOwnerId: number | null }) {
  const rounds = useMemo(() => {
    const byRound = new Map<number, DraftPick[]>();
    for (const p of picks) byRound.set(p.round, [...(byRound.get(p.round) ?? []), p]);
    return [...byRound.entries()].sort((a, b) => a[0] - b[0]);
  }, [picks]);

  return (
    <ScrollView contentContainerStyle={styles.board} refreshControl={<AppRefreshControl />}>
      {rounds.map(([round, roundPicks]) => (
        <View key={round}>
          <Text style={styles.roundTitle}>Round {round}</Text>
          {roundPicks
            .sort((a, b) => a.pick_number - b.pick_number)
            .map((p) => (
              <Pressable
                key={p.pick_number}
                disabled={!p.sleeper_player_id}
                onPress={() => openPlayer(p.sleeper_player_id)}
                style={[
                  styles.boardRow,
                  p.pick_number === currentPickNumber && styles.boardCurrent,
                  p.owner_id === myOwnerId && styles.boardMine,
                ]}>
                <Text style={styles.boardNumber}>
                  {p.round}.{String(p.round_pick).padStart(2, '0')}
                </Text>
                <View style={styles.boardText}>
                  <Text style={styles.boardPlayer} numberOfLines={1}>
                    {p.player_name ?? (p.pick_number === currentPickNumber ? 'On the clock' : '—')}
                    {p.player_position ? `  ${positionLabel(p.player_position)}` : ''}
                    {p.is_keeper ? '  (K)' : p.is_autopick ? '  (auto)' : ''}
                  </Text>
                  <Text style={styles.muted} numberOfLines={1}>
                    {p.owner_name}
                  </Text>
                </View>
              </Pressable>
            ))}
        </View>
      ))}
    </ScrollView>
  );
}

function ChatView(props: { messages: DraftChatMessage[]; myOwnerId: number | null; onSend: (text: string) => boolean }) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const newestFirst = [...props.messages].reverse();

  function send() {
    const body = text.trim();
    if (body && props.onSend(body)) setText('');
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top + 44}>
      <FlatList
        inverted
        data={newestFirst}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={styles.chatList}
        ListEmptyComponent={<Text style={[styles.muted, styles.chatEmpty]}>No messages yet. Talk some trash.</Text>}
        renderItem={({ item }) => (
          <View style={[styles.chatLine, item.owner_id === props.myOwnerId && styles.chatMine]}>
            <Text style={styles.chatName}>{item.owner_name}</Text>
            <Text style={styles.chatText}>{item.text}</Text>
          </View>
        )}
      />
      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Message the draft room"
          placeholderTextColor={Colors.textSecondary}
          style={styles.chatInput}
          onSubmitEditing={send}
          returnKeyType="send"
        />
        <Pressable onPress={send} disabled={!text.trim()} style={[styles.sendButton, !text.trim() && styles.disabled]}>
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function PlayerRow(props: {
  rank?: number;
  name: string;
  detail: string;
  value: string;
  onOpen: () => void;
  actions: ReactNode;
}) {
  return (
    <View style={styles.row}>
      {props.rank !== undefined && <Text style={styles.rank}>{props.rank}</Text>}
      <Pressable onPress={props.onOpen} style={({ pressed }) => [styles.rowText, pressed && styles.pressed]}>
        <Text style={styles.rowName} numberOfLines={1}>
          {props.name}
        </Text>
        <Text style={styles.muted} numberOfLines={1}>
          {props.detail}
        </Text>
      </Pressable>
      <Text style={styles.rowValue}>{props.value}</Text>
      {props.actions}
    </View>
  );
}

function DraftButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.draftButton, pressed && styles.pressed]}>
      <Text style={styles.draftText}>Draft</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  header: {
    margin: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.xs,
  },
  headerMyTurn: { borderColor: Colors.accent },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { color: Colors.text, fontSize: 18, fontWeight: '800', flex: 1 },
  clock: { color: Colors.text, fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  clockUrgent: { color: Colors.live },
  yourPick: { color: Colors.accent, fontSize: 15, fontWeight: '800' },
  onClock: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.border },
  dotOnline: { backgroundColor: Colors.win },
  muted: { color: Colors.textSecondary, fontSize: 13 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.sm },
  control: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.pill, paddingHorizontal: Spacing.md, paddingVertical: 6 },
  controlText: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.6 },
  tabs: { flexDirection: 'row', marginHorizontal: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.surface, padding: 3 },
  tab: { flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.md - 2, alignItems: 'center' },
  tabActive: { backgroundColor: Colors.border },
  tabText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: Colors.text },
  filters: { padding: Spacing.md, gap: Spacing.sm },
  search: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.md,
    color: Colors.text,
    fontSize: 16,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { backgroundColor: Colors.surface, borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md, paddingVertical: 6 },
  chipActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  chipText: { color: Colors.text, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: Colors.bg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  rank: { width: 22, color: Colors.textSecondary, fontSize: 13, fontVariant: ['tabular-nums'] },
  rowText: { flex: 1, gap: 2 },
  rowName: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  rowValue: { width: 48, textAlign: 'right', color: Colors.text, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  iconButton: { paddingHorizontal: 4 },
  star: { color: Colors.textSecondary, fontSize: 22 },
  starOn: { color: Colors.accent },
  arrow: { color: Colors.textSecondary, fontSize: 14 },
  removeX: { color: Colors.loss, fontSize: 14 },
  draftButton: { backgroundColor: Colors.accent, borderRadius: Radius.pill, paddingHorizontal: Spacing.md, paddingVertical: 6 },
  draftText: { color: Colors.bg, fontSize: 13, fontWeight: '800' },
  board: { padding: Spacing.md, paddingBottom: Spacing.xl * 2 },
  roundTitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  boardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  boardCurrent: { borderColor: Colors.accent },
  boardMine: { backgroundColor: Colors.border },
  boardNumber: { width: 40, color: Colors.textSecondary, fontSize: 13, fontVariant: ['tabular-nums'] },
  boardText: { flex: 1, gap: 2 },
  boardPlayer: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  chatList: { padding: Spacing.md },
  chatEmpty: { textAlign: 'center', marginTop: Spacing.xl, transform: [{ scaleY: -1 }] },
  chatLine: { marginVertical: 4, padding: Spacing.sm, borderRadius: Radius.md, backgroundColor: Colors.surface, maxWidth: '85%', alignSelf: 'flex-start' },
  chatMine: { alignSelf: 'flex-end', backgroundColor: Colors.border },
  chatName: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700' },
  chatText: { color: Colors.text, fontSize: 15 },
  composer: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  chatInput: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.lg,
    color: Colors.text,
    fontSize: 16,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  sendButton: { backgroundColor: Colors.accent, borderRadius: Radius.pill, paddingHorizontal: Spacing.lg, justifyContent: 'center' },
  sendText: { color: Colors.bg, fontWeight: '800' },
  disabled: { opacity: 0.4 },
});
