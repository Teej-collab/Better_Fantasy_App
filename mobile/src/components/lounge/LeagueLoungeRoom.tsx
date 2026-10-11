import {
  LiveKitRoom,
  registerGlobals,
  useChat,
  useDataChannel,
  useIsSpeaking,
  useLocalParticipant,
  useParticipants,
  useRemoteParticipants,
  useTracks,
  VideoTrack,
  type TrackReference,
} from '@livekit/react-native';
import Slider from '@react-native-community/slider';
import { useKeepAwake } from 'expo-keep-awake';
import { Track, type Participant, type RemoteParticipant } from 'livekit-client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';

import { ChatNameText } from '@/components/ChatNameText';
import { LoungeField } from '@/components/lounge/LoungeField';
import { SweatCard, SweatSheet } from '@/components/lounge/LoungeSweat';
import { LoungeTickers } from '@/components/lounge/LoungeTickers';
import { LoungeTv } from '@/components/lounge/LoungeTv';
import { isTouchdown, MomentTakeover, type Moment, type ReactionCounts } from '@/components/lounge/MomentTakeover';
import { Text } from '@/components/Text';
import { Fonts } from '@/constants/theme';
import { cleanChat } from '@/lib/chatFilter';
import { isHexColor } from '@/lib/colorChoice';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { useChatSocket } from '@/lib/chatSocket';
import { haptics } from '@/lib/haptics';
import { useDelayedGame } from '@/lib/loungeLive';
import { lastName, useLoungeSweat } from '@/lib/loungeSweat';
import { useChatMembers, useChatMessages, useMe } from '@/lib/queries';
import { useRosterMoments, type RosterMoment } from '@/lib/rosterMoments';
import type { GamecastPlay, LiveGame } from '@/lib/types';

// LiveKit's WebRTC globals. This module is only loaded once
// nativeLoungeAvailable() (lib/loungeSession.ts) has confirmed the
// native module is in this build, so Expo Go never reaches it.
registerGlobals();

// The League Lounge on a phone (mockup 1): watch the game together and
// sweat it together. One TV for whoever is sharing the game, a live
// gamecast of it (scorebug, field, plays) and your fantasy and bet
// stakes, the league's scores, and the room's chat with fantasy moments
// dropped in as they happen.
//
// Everything about the TV's game runs on the room's delay
// (lib/loungeLive.ts), so a touchdown card never beats the touchdown.
// The delay and the game come from the room (whoever's sharing sets
// them, from the web, where screen sharing happens).

export type LoungeRoomProps = {
  token: string;
  url: string;
  roomName: string;
  // A Watch Party room (League Lounge included): its chat is the league
  // conversation, and the TV game and delay are the room's own.
  party: { roomId: number; conversationId: number } | null;
  tvGameId: string | null;
  delaySeconds: number;
  onLeave: () => void;
  // Set for an open watch party's host: ends it for everyone.
  onEndParty?: () => void;
};

const REACTIONS = [
  { key: 'letsgo', label: "Let's go" },
  { key: 'robbed', label: 'Robbed' },
  { key: 'chug', label: 'Chug!' },
  { key: 'flag', label: 'Flag' },
] as const;
type ReactionKey = (typeof REACTIONS)[number]['key'];
const REACTION_WINDOW_MS = 60_000;

const PERSON_COLORS = ['#7c2d12', '#4c1d95', '#1e3a8a', '#065f46', '#831843', '#3f3f46', '#713f12', '#134e4a'];
const NAME_COLORS = ['#fcd34d', '#f9a8d4', '#93c5fd', '#86efac', '#fca5a5', '#c4b5fd', '#fdba74', '#67e8f9'];
function hashIndex(s: string, n: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % n;
}
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();
}

export function LeagueLoungeRoom(props: LoungeRoomProps) {
  useKeepAwake();
  const [error, setError] = useState<string | null>(null);
  const leaving = useRef(false);
  return (
    <View style={styles.screen}>
      <LiveKitRoom
        serverUrl={props.url}
        token={props.token}
        connect
        audio
        video={false}
        options={{ adaptiveStream: true, dynacast: true }}
        onDisconnected={() => {
          if (leaving.current) props.onLeave();
          else setError('Disconnected from the lounge.');
        }}
        onError={(e) => setError(e.message || "Couldn't connect to the lounge.")}>
        <Room
          {...props}
          error={error}
          onLeave={() => {
            leaving.current = true;
            props.onLeave();
          }}
        />
      </LiveKitRoom>
    </View>
  );
}

type FeedItem =
  | { kind: 'message'; id: string; name: string; color: string; chatColor: string | null; body: string; plus: number }
  | { kind: 'moment'; id: string; text: string; points: string; team: string; odds: string | null };

function Room({ roomName, party, tvGameId, delaySeconds, error, onLeave, onEndParty }: LoungeRoomProps & { error: string | null }) {
  const accent = useAppearance().accent;
  const insets = useSafeAreaInsets();
  const participants = useParticipants();
  const shares = useTracks([Track.Source.ScreenShare]) as TrackReference[];
  const share = shares[0];
  const sweat = useLoungeSweat(delaySeconds);
  const [sweatOpen, setSweatOpen] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [moment, setMoment] = useState<Moment | null>(null);
  const [moments, setMoments] = useState<FeedItem[]>([]);
  const [winBefore, setWinBefore] = useState<number | null>(null);
  const winHistory = useRef<number[]>([]);
  const [reactions, setReactions] = useState<{ key: ReactionKey; at: number; name: string }[]>([]);
  const [burst, setBurst] = useState<{ text: string; id: number } | null>(null);

  // Win odds history for the moment's swing chart.
  useEffect(() => {
    if (sweat.winPct === null) return;
    const h = winHistory.current;
    if (h[h.length - 1] !== sweat.winPct) h.push(sweat.winPct);
    if (h.length > 30) h.shift();
  }, [sweat.winPct]);

  const latestWin = useRef(sweat.winPct);
  latestWin.current = sweat.winPct;

  async function onPlay(play: GamecastPlay, game: LiveGame) {
    let players: Awaited<ReturnType<typeof api.playFantasy>>['players'] = [];
    try {
      players = (await api.playFantasy(game.game_id, play.play_id)).players;
    } catch {
      players = [];
    }
    if (isTouchdown(play)) {
      setWinBefore(latestWin.current);
      setMoment({ play, game, players });
      haptics.success();
    }
    const top = [...players].sort((a, b) => Number(b.is_mine) - Number(a.is_mine) || Math.abs(b.points) - Math.abs(a.points))[0];
    if (!top || Math.abs(top.points) < 0.05) return;
    const yards = play.yards_gained ? `${Math.abs(play.yards_gained)}-yd ${play.play_type === 'pass' ? 'catch' : play.play_type === 'rush' ? 'run' : 'play'}` : 'big play';
    const what = isTouchdown(play) ? 'touchdown' : play.is_turnover ? 'turnover' : yards;
    // Once per play, even if it comes around again.
    setMoments((m) =>
      m.some((x) => x.id === `moment-${play.play_id}`)
        ? m
        : [
            ...m.slice(-20),
            {
              kind: 'moment',
              id: `moment-${play.play_id}`,
              text: `${lastName(top.player_name)} ${what}`,
              points: `${top.points >= 0 ? '+' : '−'}${Math.abs(top.points).toFixed(1)}`,
              team: top.team_name,
              odds: null,
            },
          ],
    );
  }

  const delayed = useDelayedGame(tvGameId, delaySeconds, (p, g) => void onPlay(p, g));

  // Reactions ride LiveKit's data channel — instant, and nothing stored.
  const me = useMe().data;
  const myName = me?.display_name ?? 'You';
  const { send: sendData } = useDataChannel('lounge-reaction', (msg) => {
    try {
      const data = JSON.parse(new TextDecoder().decode(msg.payload));
      const key = data.key as ReactionKey;
      const name = msg.from?.name || 'Someone';
      addReaction(key, name);
    } catch {
      // ignore
    }
  });
  function addReaction(key: ReactionKey, name: string) {
    const now = Date.now();
    setReactions((r) => [...r.filter((x) => now - x.at < REACTION_WINDOW_MS), { key, at: now, name }]);
    const label = REACTIONS.find((x) => x.key === key)?.label.toUpperCase() ?? '';
    setBurst({ text: `${name}: ${label}`, id: now });
  }
  useEffect(() => {
    if (!burst) return;
    const id = setTimeout(() => setBurst(null), 2500);
    return () => clearTimeout(id);
  }, [burst]);
  function react(key: ReactionKey) {
    haptics.tap();
    addReaction(key, myName);
    void sendData(new TextEncoder().encode(JSON.stringify({ key })), { reliable: true });
  }
  const counts: ReactionCounts = useMemo(() => {
    const c = { letsgo: 0, robbed: 0, chug: 0, flag: 0 };
    for (const r of reactions) c[r.key] += 1;
    return c;
  }, [reactions]);

  // No game on the TV: your own starters' touchdowns and 5+ point plays
  // from every game instead (lib/rosterMoments.ts).
  const rosterMoments = useRosterMoments(sweat.matchupId, sweat.ready ? sweat.myStarters : null, !tvGameId);
  const latestRosterMoment = rosterMoments[rosterMoments.length - 1] ?? null;
  const [rosterBanner, setRosterBanner] = useState<RosterMoment | null>(null);
  const [bannerShownFor, setBannerShownFor] = useState<string | null>(null);
  if (latestRosterMoment && latestRosterMoment.id !== bannerShownFor) {
    setBannerShownFor(latestRosterMoment.id);
    setRosterBanner(latestRosterMoment);
  }
  useEffect(() => {
    if (!rosterBanner) return;
    if (rosterBanner.touchdown) haptics.success();
    const id = setTimeout(() => setRosterBanner(null), 15_000);
    return () => clearTimeout(id);
  }, [rosterBanner]);
  const rosterFeed: FeedItem[] = rosterMoments.map((m) => ({
    kind: 'moment',
    id: `roster-${m.id}`,
    text: `${lastName(m.playerName)} ${m.touchdown ? 'touchdown' : 'big play'}`,
    points: `+${m.points.toFixed(1)}`,
    team: m.proTeam ?? '',
    odds: null,
  }));

  const feed = useFeed(party, [...moments, ...rosterFeed]);
  const game = delayed.game;
  const keyboardOpen = useKeyboardOpen();
  const watching = participants.length;

  return (
    // The whole room rides up with the keyboard; while typing, everything
    // but the TV, the chat and the message box steps aside so what you're
    // writing stays in view.
    <KeyboardAvoidingView style={[styles.body, { paddingTop: insets.top }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Pressable onPress={onLeave} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#f3f4f6" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M15 18l-6-6 6-6" />
          </Svg>
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={1}>
            {roomName.toUpperCase()}
          </Text>
          <View style={styles.subRow}>
            <View style={styles.liveDot} />
            <Text style={styles.sub} numberOfLines={1}>
              {watching} watching{game ? ` · ${game.away_team.abbr} @ ${game.home_team.abbr} on the TV` : ''}
            </Text>
          </View>
        </View>
        {onEndParty && (
          <Pressable onPress={onEndParty} style={styles.endParty} accessibilityRole="button">
            <Text style={styles.endPartyText}>End</Text>
          </Pressable>
        )}
        <Pressable onPress={onLeave} style={styles.leave} accessibilityRole="button">
          <Text style={styles.leaveText}>Leave</Text>
        </Pressable>
      </View>
      {error && <Text style={styles.error}>{error}</Text>}

      {!keyboardOpen && <LoungeTickers tvGame={game} delaySeconds={delaySeconds} />}

      <View onTouchStart={Keyboard.dismiss}>
        <LoungeTv share={share} game={game} catchingUp={delayed.catchingUp} />
        {burst && (
          <View style={styles.burst} pointerEvents="none">
            <Text style={styles.burstText}>{burst.text}</Text>
          </View>
        )}
      </View>
      {!keyboardOpen && (
        <>
          {game ? <LoungeField game={game} /> : rosterBanner && <RosterBanner moment={rosterBanner} accent={accent} />}
          <SweatCard sweat={sweat} game={game} onOpen={() => setSweatOpen(true)} />

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.peopleScroll} contentContainerStyle={styles.people}>
            {participants.map((p) => (
              <Person key={p.identity} participant={p} accent={accent} onPress={() => setVolumeOpen(true)} />
            ))}
          </ScrollView>
        </>
      )}

      <FlatList
        style={styles.feed}
        contentContainerStyle={styles.feedContent}
        data={feed}
        inverted
        // Scroll or tap the chat to put the keyboard away.
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onTouchStart={Keyboard.dismiss}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) =>
          item.kind === 'moment' ? (
            <View style={[styles.moment, { backgroundColor: `${accent}14`, borderColor: `${accent}33` }]}>
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M3 17l6-6 4 4 8-8" />
                <Path d="M14 7h7v7" />
              </Svg>
              <Text style={styles.momentText}>
                <Text style={styles.bold}>{item.text}</Text> · <Text style={[styles.bold, { color: accent }]}>{item.points}</Text> {item.team}
                {item.odds ? ` · ${item.odds}` : ''}
              </Text>
            </View>
          ) : (
            <View style={styles.message}>
              <Text style={styles.messageText}>
                <ChatNameText name={`${item.name} `} chatColor={item.chatColor} fallback={item.color} style={styles.bold} />
                <Text style={styles.messageBody}>{item.body}</Text>
              </Text>
              {item.plus > 0 && <Text style={styles.plus}>+{item.plus}</Text>}
            </View>
          )
        }
      />

      <Footer party={party} onReact={react} bottomInset={insets.bottom} keyboardOpen={keyboardOpen} />

      <SweatSheet visible={sweatOpen} onClose={() => setSweatOpen(false)} sweat={sweat} game={game} share={share} catchingUp={delayed.catchingUp} />
      <VolumeSheet visible={volumeOpen} onClose={() => setVolumeOpen(false)} />
      <MomentTakeover
        moment={moment}
        watching={watching}
        winBefore={winBefore}
        winNow={sweat.winPct}
        winHistory={winHistory.current}
        myBets={sweat.openBets}
        reactions={counts}
        lastMessages={feed
          .filter((f): f is Extract<FeedItem, { kind: 'message' }> => f.kind === 'message')
          .slice(0, 2)
          .reverse()
          .map((m) => ({ name: m.name, color: m.color, body: m.body }))}
        onClose={() => setMoment(null)}
      />
    </KeyboardAvoidingView>
  );
}

/** Room chat newest-first (the list is inverted): the league
 *  conversation for a Watch Party, LiveKit's chat for a password Lounge,
 *  with fantasy moments merged in. */
function useFeed(party: LoungeRoomProps['party'], moments: FeedItem[]): FeedItem[] {
  const conversation = useChatMessages(party?.conversationId ?? 0);
  const lk = useChat();
  const messages: FeedItem[] = party
    ? (conversation.data ?? [])
        .filter((m) => !m.deleted && m.body)
        .slice(-40)
        .map((m) => ({
          kind: 'message' as const,
          id: `m-${m.id}`,
          name: m.owner_name.split(' ')[0],
          color: isHexColor(m.owner_chat_color) ? m.owner_chat_color : NAME_COLORS[hashIndex(m.owner_name, NAME_COLORS.length)],
          chatColor: m.owner_chat_color,
          body: m.body,
          plus: m.reactions.reduce((n, r) => n + r.count, 0),
        }))
    : lk.chatMessages.slice(-40).map((m) => {
        const name = m.from?.name || m.from?.identity || 'Someone';
        return { kind: 'message' as const, id: `lk-${m.id}`, name: name.split(' ')[0], color: NAME_COLORS[hashIndex(name, NAME_COLORS.length)], chatColor: null, body: cleanChat(m.message), plus: 0 };
      });
  // Moments sit after the messages that came before them.
  return [...messages, ...moments].reverse();
}

/** A camera tile — their video when their camera's on, else initials.
 *  Tap for everyone's volume. */
function Person({ participant, accent, onPress }: { participant: Participant; accent: string; onPress: () => void }) {
  const speaking = useIsSpeaking(participant);
  const camera = (useTracks([Track.Source.Camera]) as TrackReference[]).find((t) => t.participant.identity === participant.identity);
  const name = participant.isLocal ? 'You' : participant.name || participant.identity;
  const showVideo = !!camera && !camera.publication?.isMuted;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.person, { backgroundColor: PERSON_COLORS[hashIndex(name, PERSON_COLORS.length)] }, speaking && { borderColor: accent }]}
      accessibilityRole="button"
      accessibilityLabel={`${name}${speaking ? ', talking' : ''} — adjust volume`}>
      {showVideo ? (
        <VideoTrack trackRef={camera} style={StyleSheet.absoluteFill} objectFit="cover" mirror={participant.isLocal} />
      ) : (
        <Text style={styles.personInitials}>{initialsOf(name)}</Text>
      )}
      <Text style={styles.personName} numberOfLines={1}>
        {name}
      </Text>
    </Pressable>
  );
}

/** Under the TV for a few seconds when one of your starters scores or
 *  breaks a big play in any game — only while no game is on the TV. */
function RosterBanner({ moment, accent }: { moment: RosterMoment; accent: string }) {
  return (
    <View style={[styles.rosterBanner, { borderColor: `${accent}66`, backgroundColor: `${accent}14` }]}>
      <Text style={[styles.rosterBannerKind, { color: accent }]}>{moment.touchdown ? 'TOUCHDOWN' : 'BIG PLAY'}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rosterBannerName} numberOfLines={1}>
          {moment.playerName}
        </Text>
        <Text style={styles.rosterBannerSub} numberOfLines={1}>
          Your {moment.position ?? 'player'}
          {moment.proTeam ? ` · ${moment.proTeam}` : ''}
        </Text>
      </View>
      <Text style={[styles.rosterBannerPoints, { color: accent }]}>+{moment.points.toFixed(1)}</Text>
    </View>
  );
}

function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setOpen(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return open;
}

// @everyone in the picker: tags every league member at once.
const EVERYONE = 'everyone';

function Footer({
  party,
  onReact,
  bottomInset,
  keyboardOpen,
}: {
  party: LoungeRoomProps['party'];
  onReact: (k: ReactionKey) => void;
  bottomInset: number;
  keyboardOpen: boolean;
}) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const { send: chatSocketSend } = useChatSocket();
  const [front, setFront] = useState(true);
  async function flip() {
    const track = localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack;
    if (!track) return;
    await track.restartTrack({ facingMode: front ? 'environment' : 'user' });
    setFront(!front);
  }
  const lk = useChat();
  const [draft, setDraft] = useState('');
  // @mentions (Watch Party chats only — a password Lounge's chat is
  // LiveKit's): "@Jo" before the cursor lists league members, and a tag
  // pings them with a link straight into this room, even if they
  // haven't opened it (backend chat_ws).
  const members = useChatMembers().data ?? [];
  const [cursor, setCursor] = useState(0);
  // Display name (or "everyone") → the owner ids it tags.
  const [pendingMentions, setPendingMentions] = useState<Map<string, number[]>>(new Map());
  const mentionQuery = party ? (draft.slice(0, cursor).match(/(?:^|\s)@(\w*)$/)?.[1] ?? null) : null;
  const q = mentionQuery?.toLowerCase() ?? '';
  const everyoneMatches = mentionQuery !== null && members.length > 1 && EVERYONE.startsWith(q);
  const matches =
    mentionQuery === null ? [] : members.filter((m) => m.display_name.toLowerCase().startsWith(q)).slice(0, everyoneMatches ? 3 : 4);
  function pick(name: string, ownerIds: number[]) {
    haptics.tap();
    const before = draft.slice(0, cursor).replace(/@(\w*)$/, `@${name} `);
    setDraft(before + draft.slice(cursor));
    setCursor(before.length);
    setPendingMentions((prev) => new Map(prev).set(name, ownerIds));
  }

  function submit() {
    const body = draft.trim();
    if (!body) return;
    const mentions = [...new Set([...pendingMentions].filter(([name]) => body.includes(`@${name}`)).flatMap(([, ids]) => ids))];
    setDraft('');
    setCursor(0);
    setPendingMentions(new Map());
    if (party) chatSocketSend({ type: 'message', conversation_id: party.conversationId, body, ...(mentions.length ? { mentions } : {}) });
    else void lk.send(body);
  }

  return (
    <View style={[styles.footer, { paddingBottom: keyboardOpen ? 8 : Math.max(14, bottomInset) }]}>
        {(everyoneMatches || matches.length > 0) && (
          <View style={styles.mentionList}>
            {everyoneMatches && (
              <Pressable
                onPress={() => pick(EVERYONE, members.map((m) => m.owner_id))}
                style={({ pressed }) => [styles.mentionRow, pressed && { opacity: 0.6 }]}
                accessibilityRole="button"
                accessibilityLabel="Tag everyone in the league">
                <Text style={styles.mentionName}>@everyone</Text>
                <Text style={styles.mentionTeam}>Tag the whole league</Text>
              </Pressable>
            )}
            {matches.map((m, i) => (
              <Pressable
                key={m.owner_id}
                onPress={() => pick(m.display_name, [m.owner_id])}
                style={({ pressed }) => [styles.mentionRow, (i > 0 || everyoneMatches) && styles.mentionDivider, pressed && { opacity: 0.6 }]}
                accessibilityRole="button"
                accessibilityLabel={`Tag ${m.display_name}`}>
                <Text style={styles.mentionName}>{m.display_name}</Text>
                <Text style={styles.mentionTeam} numberOfLines={1}>
                  {m.team_name}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        {!keyboardOpen && (
          <View style={styles.reactRow}>
            {REACTIONS.map((r) => (
              <Pressable key={r.key} onPress={() => onReact(r.key)} style={styles.reactBtn} accessibilityRole="button">
                <Text style={styles.reactText}>{r.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <View style={styles.inputRow}>
          <TextInput
            value={draft}
            onChangeText={(text) => {
              // Typing at the end moves the cursor with it;
              // onSelectionChange corrects this for edits mid-text.
              setCursor((prev) => (prev >= draft.length ? text.length : prev));
              setDraft(text);
            }}
            onSelectionChange={(e) => setCursor(e.nativeEvent.selection.end)}
            placeholder={party ? 'Talk your talk… @ to tag' : 'Talk your talk…'}
            placeholderTextColor="rgba(255,255,255,0.4)"
            style={styles.input}
            returnKeyType="send"
            onSubmitEditing={submit}
            // Stays open after sending so you can keep talking; ↓ closes it.
            submitBehavior="submit"
            accessibilityLabel="Message the room"
          />
          {keyboardOpen ? (
            <>
              <Pressable
                onPress={submit}
                disabled={!draft.trim()}
                style={[styles.roundBtn, styles.sendBtn, !draft.trim() && { opacity: 0.4 }]}
                accessibilityRole="button"
                accessibilityLabel="Send">
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#06110a" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
                  <Path d="M12 19V5M5 12l7-7 7 7" />
                </Svg>
              </Pressable>
              <Pressable onPress={Keyboard.dismiss} style={styles.roundBtn} accessibilityRole="button" accessibilityLabel="Hide keyboard">
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#f3f4f6" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                  <Path d="M6 9l6 6 6-6" />
                </Svg>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                onPress={() => {
                  haptics.tap();
                  void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
                }}
                style={[styles.roundBtn, !isMicrophoneEnabled && styles.roundBtnOff]}
                accessibilityRole="button"
                accessibilityLabel={isMicrophoneEnabled ? 'Microphone on' : 'Microphone off'}>
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#f3f4f6" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <Rect x={9} y={3} width={6} height={11} rx={3} />
                  <Path d="M5 11a7 7 0 0014 0M12 18v3" />
                  {!isMicrophoneEnabled && <Path d="M3 3l18 18" />}
                </Svg>
              </Pressable>
              <Pressable
                onPress={() => {
                  haptics.tap();
                  void localParticipant.setCameraEnabled(!isCameraEnabled);
                }}
                style={[styles.roundBtn, !isCameraEnabled && styles.roundBtnOff]}
                accessibilityRole="button"
                accessibilityLabel={isCameraEnabled ? 'Camera on' : 'Camera off'}>
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <Path d="M16 10l5-3v10l-5-3M3 7h13v10H3z" />
                  {!isCameraEnabled && <Path d="M2 2l20 20" />}
                </Svg>
              </Pressable>
              {isCameraEnabled && (
                <Pressable
                  onPress={() => {
                    haptics.tap();
                    void flip();
                  }}
                  style={styles.roundBtn}
                  accessibilityRole="button"
                  accessibilityLabel={front ? 'Switch to the back camera' : 'Switch to the front camera'}>
                  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <Path d="M3 7h3l2-3h8l2 3h3v12H3z" />
                    <Path d="M9 13a3 3 0 015.2-2M15 13a3 3 0 01-5.2 2" />
                  </Svg>
                </Pressable>
              )}
            </>
          )}
        </View>
      </View>
  );
}

// Per-person volume: one slider per mic, and one for a shared game's sound.
function VolumeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const participants = useRemoteParticipants();
  const shareAudio = useTracks([Track.Source.ScreenShareAudio]);
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Volume</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={styles.sheetDone}>Done</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>Only changes what you hear.</Text>
          <ScrollView>
            {participants.length === 0 && <Text style={styles.hint}>No one else is in the room yet.</Text>}
            {participants.map((p) => (
              <View key={p.sid} style={styles.volumeGroup}>
                <VolumeRow participant={p} source={Track.Source.Microphone} label={p.name || p.identity} />
                {shareAudio.some((t) => t.participant.sid === p.sid) && (
                  <VolumeRow participant={p} source={Track.Source.ScreenShareAudio} label={`${p.name || p.identity}'s game`} />
                )}
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function VolumeRow({ participant, source, label }: { participant: RemoteParticipant; source: Track.Source.Microphone | Track.Source.ScreenShareAudio; label: string }) {
  const accent = useAppearance().accent;
  const [volume, setVolume] = useState(() => participant.getVolume(source) ?? 1);
  return (
    <View style={styles.volumeRow}>
      <Text style={styles.volumeLabel} numberOfLines={2}>
        {label}
      </Text>
      <Slider
        style={{ flex: 1, height: 32 }}
        minimumValue={0}
        maximumValue={2}
        value={volume}
        onValueChange={(v) => {
          setVolume(v);
          participant.setVolume(v, source);
        }}
        minimumTrackTintColor={accent}
        maximumTrackTintColor="rgba(255,255,255,0.2)"
        accessibilityLabel={`${label} volume, only for you`}
      />
      <Text style={styles.volumePct}>{Math.round(volume * 100)}%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b0d14' },
  body: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 6, paddingBottom: 8 },
  back: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: '#12151d', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#f3f4f6', fontFamily: Fonts.displayBold, fontSize: 18, letterSpacing: 0.5 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#dc143c' },
  sub: { color: '#9aa3b2', fontSize: 11, flexShrink: 1 },
  leave: { borderRadius: 999, backgroundColor: '#b91c3c', paddingHorizontal: 14, paddingVertical: 8 },
  endParty: { borderRadius: 999, borderWidth: 1, borderColor: '#b91c3c', paddingHorizontal: 12, paddingVertical: 7, marginRight: 6 },
  endPartyText: { color: '#fca5a5', fontSize: 13, fontWeight: '700' },
  leaveText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  error: { color: '#f87171', fontSize: 12, paddingHorizontal: 14 },
  burst: { position: 'absolute', top: 18, right: 18, backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  burstText: { color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  peopleScroll: { flexGrow: 0 },
  people: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 },
  person: { width: 132, height: 99, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  personInitials: { color: 'rgba(255,255,255,0.75)', fontSize: 26, fontFamily: Fonts.displayBold },
  personName: { position: 'absolute', left: 6, bottom: 6, maxWidth: 116, color: '#fff', fontSize: 11, fontWeight: '700', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 6, overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 2 },
  rosterBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 12, marginTop: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, borderWidth: 1 },
  rosterBannerKind: { fontFamily: Fonts.displayBold, fontSize: 16, letterSpacing: 1 },
  rosterBannerName: { color: '#f3f4f6', fontSize: 14, fontWeight: '700' },
  rosterBannerSub: { color: '#9aa3b2', fontSize: 11 },
  rosterBannerPoints: { fontFamily: Fonts.mono, fontSize: 18, fontWeight: '800' },
  feed: { flex: 1 },
  feedContent: { gap: 6, paddingHorizontal: 12, paddingBottom: 6 },
  moment: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, borderWidth: 1 },
  momentText: { color: '#f3f4f6', fontSize: 12, flex: 1 },
  bold: { fontWeight: '700' },
  message: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  messageText: { fontSize: 13, flexShrink: 1 },
  messageBody: { color: '#d1d5db' },
  plus: { color: '#f3f4f6', fontSize: 11, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  footer: { gap: 8, paddingHorizontal: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', backgroundColor: '#0e1018' },
  reactRow: { flexDirection: 'row', gap: 6 },
  mentionList: { borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: '#12151d', overflow: 'hidden' },
  mentionRow: { paddingHorizontal: 12, paddingVertical: 8 },
  mentionDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.1)' },
  mentionName: { color: '#f3f4f6', fontSize: 14, fontWeight: '700' },
  mentionTeam: { color: '#9aa3b2', fontSize: 11 },
  reactBtn: { flex: 1, height: 30, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: '#12151d', alignItems: 'center', justifyContent: 'center' },
  reactText: { color: '#f3f4f6', fontSize: 12, fontWeight: '600' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, height: 40, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: '#12151d', color: '#f3f4f6', paddingHorizontal: 14, fontSize: 14 },
  roundBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  roundBtnOff: { backgroundColor: '#b91c3c' },
  sendBtn: { backgroundColor: '#39ff14' },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { maxHeight: '65%', backgroundColor: '#0f121a', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16 },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 },
  sheetTitle: { color: '#f3f4f6', fontSize: 16, fontWeight: '700' },
  sheetDone: { color: '#9aa3b2', fontSize: 15, fontWeight: '600' },
  hint: { color: '#9aa3b2', fontSize: 12, marginBottom: 8 },
  volumeGroup: { gap: 6, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)' },
  volumeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  volumeLabel: { width: 100, color: '#f3f4f6', fontSize: 13 },
  volumePct: { width: 42, textAlign: 'right', color: '#9aa3b2', fontSize: 12, fontFamily: Fonts.mono },
});
