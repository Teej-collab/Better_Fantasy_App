import {
  LiveKitRoom,
  registerGlobals,
  useChat,
  useDataChannel,
  useIsSpeaking,
  useLocalParticipant,
  useRemoteParticipants,
  useTracks,
  VideoTrack,
  type TrackReference,
} from '@livekit/react-native';
import Slider from '@react-native-community/slider';
import { useKeepAwake } from 'expo-keep-awake';
import { mediaDevices } from '@livekit/react-native-webrtc';
import { Track, type Participant, type RemoteParticipant } from 'livekit-client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';

import { ChatNameText } from '@/components/ChatNameText';
import { HexFrame } from '@/components/lounge/HexFrame';
import { LoungeField } from '@/components/lounge/LoungeField';
import { SweatCard, SweatSheet } from '@/components/lounge/LoungeSweat';
import { LoungeTickers } from '@/components/lounge/LoungeTickers';
import { LoungeTv } from '@/components/lounge/LoungeTv';
import { ChugAlertCard, isTouchdown, MomentRibbon, MomentsSheet, MomentToasts, SwingStrip, useRoomMoments } from '@/components/lounge/RoomMoments';
import { Text } from '@/components/Text';
import { Fonts } from '@/constants/theme';
import { cleanChat } from '@/lib/chatFilter';
import { isHexColor } from '@/lib/colorChoice';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { useChatSocket } from '@/lib/chatSocket';
import { haptics } from '@/lib/haptics';
import { useDelayedGame } from '@/lib/loungeLive';
import { personOf, useOwnDevices, useRoomPeople } from '@/lib/loungePeople';
import { lastName, useLoungeSweat } from '@/lib/loungeSweat';
import { useActiveLeague, useChatMembers, useChatMessages, useMe } from '@/lib/queries';
import { useRosterMoments } from '@/lib/rosterMoments';
import { useScoringHighlights, type ScoringHit } from '@/lib/scoringHighlights';
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
  // One per person, though they may be here from a PC and a phone.
  const participants = useRoomPeople();
  useOwnDevices();
  const shares = useTracks([Track.Source.ScreenShare]) as TrackReference[];
  const share = shares[0];
  const sweat = useLoungeSweat(delaySeconds);
  // Whose score just moved, for everyone's tiles (lib/scoringHighlights.ts).
  const hits = useScoringHighlights(sweat.league, sweat.matchupId !== null ? String(sweat.matchupId) : null);
  const [sweatOpen, setSweatOpen] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [moments, setMoments] = useState<FeedItem[]>([]);
  const [momentsOpen, setMomentsOpen] = useState(false);
  const [reactions, setReactions] = useState<{ key: ReactionKey; at: number; name: string }[]>([]);
  const [burst, setBurst] = useState<{ text: string; id: number } | null>(null);
  // The last minute's reactions, as counts on each reaction button.
  const counts = useMemo(() => {
    const c: Record<ReactionKey, number> = { letsgo: 0, robbed: 0, chug: 0, flag: 0 };
    for (const r of reactions) c[r.key] += 1;
    return c;
  }, [reactions]);
  const me = useMe().data;
  const activeLeague = useActiveLeague().data;
  // The room's pop-ups: big moments, fantasy plays and league moments
  // (components/lounge/RoomMoments.tsx).
  const rm = useRoomMoments({
    sweat,
    myOwnerId: me?.owner_id ?? null,
    roomOwnerIds: participants.map((p) => personOf(p.identity)),
    chugEnabled: !!activeLeague?.chug_enabled,
    chugRuleName: activeLeague?.chug_rule_name ?? null,
  });

  async function onPlay(play: GamecastPlay, game: LiveGame) {
    let players: Awaited<ReturnType<typeof api.playFantasy>>['players'] = [];
    try {
      players = (await api.playFantasy(game.game_id, play.play_id)).players;
    } catch {
      players = [];
    }
    rm.onPlay(play, game, players);
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

  // No game on the TV: your own starters' touchdowns and 5+ point plays
  // from every game instead (lib/rosterMoments.ts).
  const rosterMoments = useRosterMoments(sweat.matchupId, sweat.ready ? sweat.myStarters : null, !tvGameId);
  const latestRosterMoment = rosterMoments[rosterMoments.length - 1] ?? null;
  // Each one pops up once, as a fantasy-play notification.
  const rosterShown = useRef<string | null>(null);
  useEffect(() => {
    if (!latestRosterMoment || latestRosterMoment.id === rosterShown.current) return;
    rosterShown.current = latestRosterMoment.id;
    const m = latestRosterMoment;
    rm.onRosterPlay(m.id, m.playerName, m.touchdown, m.points, m.proTeam ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestRosterMoment?.id]);
  const rosterFeed: FeedItem[] = rosterMoments.map((m) => ({
    kind: 'moment',
    id: `roster-${m.id}`,
    text: `${lastName(m.playerName)} ${m.touchdown ? 'touchdown' : 'big play'}`,
    points: `+${m.points.toFixed(1)}`,
    team: m.proTeam ?? '',
    odds: null,
  }));

  // League moments (chug alerts, rivalry lead changes, your bets) land in
  // the room's chat too, so they're there after the pop-up is gone.
  const leagueFeed: FeedItem[] = rm.history
    .filter((m) => m.tier === 3)
    .map((m) => ({ kind: 'moment' as const, id: `league-${m.id}`, text: m.kind === 'chug' ? `Chug alert · ${m.detail}` : m.title, points: '', team: m.kind === 'chug' ? '' : m.detail, odds: null }))
    .reverse();
  const feed = useFeed(party, [...moments, ...rosterFeed, ...leagueFeed]);
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
        <Pressable onPress={() => setMomentsOpen(true)} style={styles.leave} accessibilityRole="button" accessibilityLabel={`Moments, ${rm.history.length}`}>
          <Text style={styles.leaveText}>Moments{rm.history.length ? ` · ${rm.history.length}` : ''}</Text>
        </Pressable>
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
        <LoungeTv
          share={share}
          game={game}
          catchingUp={delayed.catchingUp}
          fullScreenRail={<CameraRail participants={participants} accent={accent} hits={hits} chugOwner={rm.chugOwner} />}
        />
        {rm.big?.tier === 1 && <MomentRibbon moment={rm.big} accent={accent} onDismiss={rm.dismissBig} />}
        {burst && (
          <View style={styles.burst} pointerEvents="none">
            <Text style={styles.burstText}>{burst.text}</Text>
          </View>
        )}
      </View>
      {!keyboardOpen && (
        <>
          {rm.big?.kind === 'chug' ? (
            <ChugAlertCard moment={rm.big} onPileOn={() => react('chug')} onDismiss={rm.dismissBig} />
          ) : rm.swing ? (
            <SwingStrip swing={rm.swing} accent={accent} />
          ) : (
            game && <LoungeField game={game} />
          )}
          <SweatCard sweat={sweat} game={game} onOpen={() => setSweatOpen(true)} />

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.peopleScroll} contentContainerStyle={styles.people}>
            {participants.map((p) => (
              <Person
                key={p.identity}
                participant={p}
                accent={accent}
                hit={hits[personOf(p.identity)]}
                owesChug={rm.chugOwner === personOf(p.identity)}
                onPress={() => setVolumeOpen(true)}
              />
            ))}
          </ScrollView>
        </>
      )}

      <View style={styles.feedWrap}>
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
                <Text style={styles.bold}>{item.text}</Text>
                {item.points ? (
                  <>
                    {' · '}
                    <Text style={[styles.bold, { color: accent }]}>{item.points}</Text>
                  </>
                ) : null}
                {item.team ? ` ${item.points ? '' : '· '}${item.team}` : ''}
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

      <MomentToasts toasts={rm.toasts} accent={accent} onDismiss={rm.dismissToast} />
      </View>

      <Footer party={party} onReact={react} counts={counts} bottomInset={insets.bottom} keyboardOpen={keyboardOpen} />

      <SweatSheet visible={sweatOpen} onClose={() => setSweatOpen(false)} sweat={sweat} game={game} share={share} catchingUp={delayed.catchingUp} />
      <VolumeSheet visible={volumeOpen} onClose={() => setVolumeOpen(false)} />
      <MomentsSheet visible={momentsOpen} onClose={() => setMomentsOpen(false)} history={rm.history} accent={accent} />
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

/** A camera tile — their video when their camera's on, else initials —
 *  in a honeycomb frame that lights up in an NFL team's colors when
 *  that team moves their score (HexFrame). Tap for everyone's volume. */
function Person({
  participant,
  accent,
  hit,
  owesChug,
  onPress,
  rail = false,
}: {
  participant: Participant;
  accent: string;
  // Their score just moved (lib/scoringHighlights.ts).
  hit?: ScoringHit;
  owesChug?: boolean;
  onPress?: () => void;
  // A slimmer tile for the full-screen TV's camera rail.
  rail?: boolean;
}) {
  const speaking = useIsSpeaking(participant);
  const camera = (useTracks([Track.Source.Camera]) as TrackReference[]).find((t) => t.participant.identity === participant.identity);
  const name = participant.isLocal ? 'You' : participant.name || participant.identity;
  const showVideo = !!camera && !camera.publication?.isMuted;
  const scored = hit ? `, ${hit.points >= 0 ? 'up' : 'down'} ${Math.abs(hit.points).toFixed(1)}` : '';
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}${speaking ? ', talking' : ''}${scored} — adjust volume`}>
      <HexFrame width={132} height={rail ? 74 : 99} hit={hit} fallback={accent} rail={rail}>
        <View style={[StyleSheet.absoluteFill, styles.personBody, { backgroundColor: PERSON_COLORS[hashIndex(name, PERSON_COLORS.length)] }]}>
          {showVideo ? (
            <VideoTrack trackRef={camera} style={StyleSheet.absoluteFill} objectFit="cover" mirror={participant.isLocal} />
          ) : (
            <Text style={[styles.personInitials, rail && styles.personInitialsRail]}>{initialsOf(name)}</Text>
          )}
        </View>
        <Text style={[styles.personName, rail && styles.personNameRail]} numberOfLines={1}>
          {name}
        </Text>
        {owesChug && (
          <Text style={[styles.personBadge, { backgroundColor: '#facc15' }]} maxFontSizeMultiplier={1.1}>
            OWES 1
          </Text>
        )}
        {(speaking || owesChug) && (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.personRing, { borderColor: owesChug ? '#facc15' : accent }]} />
        )}
      </HexFrame>
    </Pressable>
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
  counts,
  bottomInset,
  keyboardOpen,
}: {
  party: LoungeRoomProps['party'];
  onReact: (k: ReactionKey) => void;
  counts: Record<ReactionKey, number>;
  bottomInset: number;
  keyboardOpen: boolean;
}) {
  const { send: chatSocketSend } = useChatSocket();
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
                <Text style={styles.reactText}>
                  {r.label}
                  {counts[r.key] > 0 ? <Text style={styles.reactCount}> ×{counts[r.key]}</Text> : null}
                </Text>
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
              <MicAndCamera />
            </>
          )}
        </View>
      </View>
  );
}

/** The full-screen TV's right side (mockup A): everyone's camera down
 *  a rail, your mic and camera under it. */
function CameraRail({
  participants,
  accent,
  hits,
  chugOwner,
}: {
  participants: Participant[];
  accent: string;
  hits: Record<string, ScoringHit>;
  chugOwner: string | null;
}) {
  return (
    <View style={styles.rail}>
      <Text style={styles.railTitle}>IN THE ROOM · {participants.length}</Text>
      <ScrollView style={styles.railList} contentContainerStyle={styles.railListContent} showsVerticalScrollIndicator={false}>
        {participants.map((p) => (
          <Person
            key={p.identity}
            participant={p}
            accent={accent}
            hit={hits[personOf(p.identity)]}
            owesChug={chugOwner === personOf(p.identity)}
            rail
          />
        ))}
      </ScrollView>
      <View style={styles.railButtons}>
        <MicAndCamera flip={false} />
      </View>
    </View>
  );
}

// Your mic and camera (and, with the camera on, which camera), in the
// footer and on the full-screen TV's camera rail.
function MicAndCamera({ flip: showFlip = true }: { flip?: boolean }) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  // Off takes the camera out of the room entirely (stopped and
  // unpublished): LiveKit's own off only mutes it in place, which on the
  // phone could leave it stuck on with no way to turn it off.
  async function toggleCamera() {
    try {
      const camera = localParticipant.getTrackPublication(Track.Source.Camera)?.track;
      if (isCameraEnabled && camera) {
        await localParticipant.unpublishTrack(camera, true);
      } else {
        await localParticipant.setCameraEnabled(true);
      }
    } catch {
      Alert.alert("Couldn't change your camera", 'Try again in a moment.');
    }
  }
  // Any camera the phone has (front, wide, ultra wide, telephoto), like
  // the web's camera list. iOS's combined "Dual"/"Triple" cameras are left
  // out: they're the same lenses again.
  async function chooseCamera() {
    const track = localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack;
    if (!track) return;
    const devices = ((await mediaDevices.enumerateDevices().catch(() => [])) ?? []) as { kind: string; deviceId: string; label: string }[];
    const cameras = devices.filter((d) => d.kind === 'videoinput' && !/dual|triple/i.test(d.label));
    if (cameras.length === 0) return;
    const switchTo = (i: number) =>
      void track.restartTrack({ deviceId: cameras[i].deviceId }).catch(() => Alert.alert("Couldn't switch cameras", 'Try another one.'));
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: 'Camera', options: [...cameras.map((c) => c.label), 'Cancel'], cancelButtonIndex: cameras.length },
        (i) => {
          if (i < cameras.length) switchTo(i);
        },
      );
    } else {
      Alert.alert('Camera', undefined, [...cameras.map((c, i) => ({ text: c.label, onPress: () => switchTo(i) })), { text: 'Cancel', style: 'cancel' as const }]);
    }
  }
  return (
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
          void toggleCamera();
        }}
        style={[styles.roundBtn, !isCameraEnabled && styles.roundBtnOff]}
        accessibilityRole="button"
        accessibilityLabel={isCameraEnabled ? 'Camera on' : 'Camera off'}>
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M16 10l5-3v10l-5-3M3 7h13v10H3z" />
          {!isCameraEnabled && <Path d="M2 2l20 20" />}
        </Svg>
      </Pressable>
      {showFlip && isCameraEnabled && (
        <Pressable
          onPress={() => {
            haptics.tap();
            void chooseCamera();
          }}
          style={styles.roundBtn}
          accessibilityRole="button"
          accessibilityLabel="Choose a camera">
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M3 7h3l2-3h8l2 3h3v12H3z" />
            <Path d="M9 13a3 3 0 015.2-2M15 13a3 3 0 01-5.2 2" />
          </Svg>
        </Pressable>
      )}
    </>
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
  reactCount: { color: '#9aa3b2', fontFamily: Fonts.mono, fontSize: 11 },
  feedWrap: { flex: 1, position: 'relative' },
  personBadge: { position: 'absolute', top: 6, left: 6, color: '#05060a', fontFamily: Fonts.monoBold, fontSize: 11, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
  burst: { position: 'absolute', top: 18, right: 18, backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  burstText: { color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  peopleScroll: { flexGrow: 0 },
  people: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6 },
  rail: { width: 176, paddingTop: 12, paddingBottom: 12, paddingLeft: 10, paddingRight: 34, backgroundColor: '#0d1016', borderLeftWidth: 1, borderLeftColor: '#1c2027', gap: 8 },
  railTitle: { color: '#9aa3b2', fontFamily: Fonts.display, fontSize: 12, letterSpacing: 1.2 },
  railList: { flex: 1 },
  railListContent: { gap: 8 },
  railButtons: { flexDirection: 'row', justifyContent: 'space-between' },
  personBody: { alignItems: 'center', justifyContent: 'center' },
  personRing: { borderWidth: 2, borderRadius: 9 },
  personInitialsRail: { fontSize: 18 },
  personNameRail: { left: 4, bottom: 4, fontSize: 10, paddingHorizontal: 5 },
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
