"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  RoomAudioRenderer,
  StartAudio,
  VideoTrack,
  useDataChannel,
  useIsSpeaking,
  useLocalParticipant,
  useMediaDeviceSelect,
  useRoomContext,
  useTracks,
  type TrackReference,
} from "@livekit/components-react";
import { Track, type Participant } from "livekit-client";
import { TickerStrip } from "@/components/LiveTicker";
import { FieldVisualization } from "@/components/gamecast/FieldVisualization";
import { ParticipantVolumePanel } from "@/components/watchparty/ParticipantVolumePanel";
import { buildLeagueTickerItems, buildNflTickerItems, endWatchParty, type ChatMember, type ChatMessage, type NflGame, type TickerItem, type WatchPartyRoom, type WeekMatchupContextItem } from "@/lib/api";
import type { Bet } from "@/lib/betsApi";
import { getPlayFantasy, type GamecastPlay, type GamecastPlayFantasyPlayer, type LiveGame } from "@/lib/gamecastApi";
import { toggleGameShare } from "@/lib/livekitMedia";
import { LoungeSweatPanel } from "@/components/lounge/LoungeSweatPanel";
import { ChugAlertCard, MomentRibbon, MomentsMenu, MomentToasts, SwingStrip, useRoomMoments } from "@/components/lounge/RoomMoments";
import { getMyLeagues } from "@/lib/leaguesApi";
import {
  clockLabel,
  delayForPlay,
  downLabel,
  isTouchdown,
  lastName,
  loungeApi,
  useDelayedGame,
  useDelayedValue,
  usePolled,
  useRoomTv,
} from "@/lib/loungeLive";
import { nflTeamColor } from "@/lib/nfl-teams";
import { personOf, useOwnDevices, useRoomPeople } from "@/lib/loungePeople";
import { HexFrame } from "@/components/lounge/HexFrame";
import { GameVolume } from "@/components/lounge/GameVolume";
import { LoungeBanner } from "@/components/lounge/LoungeBanner";
import { LoungeRing } from "@/components/lounge/LoungeRing";
import { gameGain, useApplyLoungeVolume, useLoungeVolume } from "@/lib/loungeVolume";
import { canSplitGameAudio, setGameOutput, useApplyGameOutput, useGameOutput } from "@/lib/loungeGameOutput";
import { useScoringHighlights, type ScoringHit } from "@/lib/scoringHighlights";
import { useRosterMoments, type RosterMoment } from "@/lib/rosterMoments";
import { isHexColor, MULTI, MULTI_COLORS } from "@/components/settings/ColorChoices";

// The League Lounge on the web (mockups 5 and 6): watch the game
// together and sweat it together. A big TV for whoever's sharing, both
// tickers, a gamecast of the TV's game (field, last play and what it
// meant), camera tiles, and a side panel with Chat, My Sweat and Plays.
//
// Everything about the TV's game runs on the room's delay
// (lib/loungeLive.ts), so a touchdown card never beats the touchdown.
// Whoever's sharing picks the game and syncs the delay to their TV.
// Rendered inside <LiveKitRoom> by WatchPartyRoom.tsx.

const REACTIONS = [
  { key: "letsgo", label: "Let's go" },
  { key: "robbed", label: "Robbed" },
  { key: "chug", label: "Chug!" },
] as const;
type ReactionKey = "letsgo" | "robbed" | "chug" | "flag";
// Stable empties, so the moments engine's effects don't rerun every render.
const EMPTY_LEAGUE: WeekMatchupContextItem[] = [];
const EMPTY_BETS: Bet[] = [];
const TILE_COLORS = ["#3b1d10", "#2a1650", "#152a5c", "#073d2d", "#4a1029", "#27272a"];
const NAME_COLORS = ["#fcd34d", "#f9a8d4", "#93c5fd", "#86efac", "#fca5a5", "#c4b5fd"];
const hash = (s: string, n: number) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % n;
};
const fmt = (n: number | null | undefined) => (n ?? 0).toFixed(1);

type FeedItem =
  | { kind: "message"; id: string; name: string; color: string; body: string; plus: number }
  | { kind: "moment"; id: string; text: string; points: string; team: string };

export function WebLoungeRoom({
  room,
  messages,
  members,
  myOwnerId,
  onSend,
  onLeave,
}: {
  room: WatchPartyRoom;
  messages: ChatMessage[];
  members: ChatMember[];
  myOwnerId: number;
  onSend: (body: string, mentions: number[], replyToId: number | null, imageUrl: string | null) => void;
  onLeave: () => void;
}) {
  const accent = "var(--user-accent, var(--wl-accent))";
  const tv = useRoomTv(room.id, { gameId: room.tv_game_id ?? null, delaySeconds: room.tv_delay_seconds ?? 45 });
  // The party ended (host, or it emptied out): back to the lobby.
  useEffect(() => {
    if (tv.closed) onLeave();
  }, [tv.closed, onLeave]);
  const isHost = room.kind === "party" && room.created_by_owner_id === myOwnerId;
  // One per person, though they may be here from a PC and a phone.
  const participants = useRoomPeople();
  useOwnDevices();
  useApplyLoungeVolume();
  useApplyGameOutput();
  const share = (useTracks([Track.Source.ScreenShare]) as TrackReference[])[0];
  const { localParticipant, isScreenShareEnabled, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const [devicesOpen, setDevicesOpen] = useState(false);
  // Theater: the TV as big as the window allows with the cameras and
  // banners around it; chat, the gamecast and the tickers step away.
  const [theater, setTheater] = useState(false);
  const [tab, setTab] = useState<"chat" | "sweat" | "plays">("chat");
  const [seenMessages, setSeenMessages] = useState(messages.length);
  const [momentsOpen, setMomentsOpen] = useState(false);
  const rmRef = useRef<((play: GamecastPlay, game: LiveGame, players: GamecastPlayFantasyPlayer[]) => void) | null>(null);
  const [moments, setMoments] = useState<FeedItem[]>([]);
  const [lastPlayPoints, setLastPlayPoints] = useState<{ playId: string; players: GamecastPlayFantasyPlayer[] } | null>(null);
  const [reactions, setReactions] = useState<{ key: ReactionKey; at: number }[]>([]);
  const [shareError, setShareError] = useState<string | null>(null);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [tvMenu, setTvMenu] = useState(false);

  async function onPlay(play: GamecastPlay, game: LiveGame) {
    const players = (await getPlayFantasy(game.game_id, play.play_id).catch(() => null)) ?? [];
    setLastPlayPoints({ playId: play.play_id, players });
    // Declared further down (it needs the league data); always set by now.
    rmRef.current?.(play, game, players);
    const top = [...players].sort((a, b) => Number(b.is_mine) - Number(a.is_mine) || Math.abs(b.points) - Math.abs(a.points))[0];
    if (!top || Math.abs(top.points) < 0.05) return;
    const yards = play.yards_gained ? `${Math.abs(play.yards_gained)}-yd ${play.play_type === "pass" ? "catch" : play.play_type === "rush" ? "run" : "play"}` : "big play";
    setMoments((m) => m.some((x) => x.id === `moment-${play.play_id}`) ? m : [
      ...m.slice(-20),
      {
        kind: "moment",
        id: `moment-${play.play_id}`,
        text: `${lastName(top.player_name)} ${isTouchdown(play) ? "touchdown" : play.is_turnover ? "turnover" : yards}`,
        points: `${top.points >= 0 ? "+" : "−"}${Math.abs(top.points).toFixed(1)}`,
        team: top.team_name,
      },
    ]);
  }
  const delayed = useDelayedGame(tv.gameId, tv.delaySeconds, (p, g) => void onPlay(p, g));
  const game = delayed.game;


  // Reactions — the same data-channel topic the native app uses.
  const { send: sendData } = useDataChannel("lounge-reaction", (msg) => {
    try {
      const data = JSON.parse(new TextDecoder().decode(msg.payload));
      setReactions((r) => [...r.filter((x) => Date.now() - x.at < 60_000), { key: data.key, at: Date.now() }]);
    } catch {
      // ignore
    }
  });
  function react(key: ReactionKey) {
    setReactions((r) => [...r.filter((x) => Date.now() - x.at < 60_000), { key, at: Date.now() }]);
    void sendData(new TextEncoder().encode(JSON.stringify({ key })), { reliable: true });
  }
  const counts = useMemo(() => {
    const c: Record<ReactionKey, number> = { letsgo: 0, robbed: 0, chug: 0, flag: 0 };
    for (const r of reactions) c[r.key] = (c[r.key] ?? 0) + 1;
    return c;
  }, [reactions]);

  // League data, held back by the room's delay so fantasy points from
  // the TV's game don't land before the play does.
  const week = useDelayedValue(usePolled("week", loungeApi.myWeek, 15000), tv.delaySeconds);
  const matchupId = week?.matchup?.matchup_id ?? null;
  const detail = useDelayedValue(usePolled(matchupId ? `m${matchupId}` : null, () => loungeApi.matchup(matchupId!), 15000), tv.delaySeconds);
  const bets = useDelayedValue(usePolled("bets", loungeApi.bets, 20000), tv.delaySeconds);
  const leagueBets = useDelayedValue(usePolled("league-bets", loungeApi.leagueBets, 30000), tv.delaySeconds);
  const ticker = useDelayedValue(
    usePolled(week?.week ? `t${week.season}-${week.week}` : null, () => loungeApi.leagueTicker(week!.season, week!.week!), 15000),
    tv.delaySeconds
  );
  const scoreboard = usePolled("nfl", loungeApi.scoreboard, 30000);
  // Every matchup this week with both lineups, for My Sweat's Scoreboard
  // and team rosters (the native sweat sheet's same source).
  const leagueContext = useDelayedValue(
    usePolled(week?.week ? `c${week.season}-${week.week}` : null, () => loungeApi.matchupContext(week!.season, week!.week!), 15000),
    tv.delaySeconds
  );

  // Whose score just moved, for everyone's tiles (lib/scoringHighlights.ts).
  const hits = useScoringHighlights(leagueContext?.matchups ?? EMPTY_LEAGUE, matchupId !== null ? String(matchupId) : null);

  const mySide = detail ? (detail.home.owner_id === myOwnerId ? detail.home : detail.away) : null;
  const myStarters = (mySide?.roster ?? []).filter((p) => p.lineup_slot !== "BE" && p.lineup_slot !== "IR");
  const winPct = week?.matchup?.win_probability ?? null;
  // No game on the TV: your own starters' touchdowns and 5+ point plays
  // from every game instead.
  const rosterMoments = useRosterMoments(matchupId, mySide ? myStarters : null, !tv.gameId);
  const latestRosterMoment = rosterMoments[rosterMoments.length - 1] ?? null;

  // The room's pop-ups (components/lounge/RoomMoments.tsx): big moments,
  // fantasy plays and league moments, all on the room's delay.
  const myLeagues = usePolled("leagues", getMyLeagues, 300_000);
  const activeLeague = myLeagues?.leagues.find((l) => l.id === myLeagues.activeLeagueId) ?? null;
  const rm = useRoomMoments({
    winPct,
    league: leagueContext?.matchups ?? EMPTY_LEAGUE,
    bets: bets?.bets ?? EMPTY_BETS,
    myOwnerId,
    roomOwnerIds: participants.map((p) => personOf(p.identity)),
    chugEnabled: !!activeLeague?.chug_enabled,
    chugRuleName: activeLeague?.chug_rule_name ?? null,
  });
  useEffect(() => {
    rmRef.current = rm.onPlay;
  }, [rm.onPlay]);
  // Your own player's big play from any game (no game on the TV): a
  // fantasy-play notification, once each.
  const rosterShown = useRef<string | null>(null);
  useEffect(() => {
    if (!latestRosterMoment || latestRosterMoment.id === rosterShown.current) return;
    rosterShown.current = latestRosterMoment.id;
    const m = latestRosterMoment;
    rm.onRosterPlay(m.id, m.playerName, m.touchdown, m.points, m.proTeam ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestRosterMoment?.id]);

  const unread = tab === "chat" ? 0 : Math.max(0, messages.length - seenMessages);
  function pickTab(next: "chat" | "sweat" | "plays") {
    if (tab === "chat" || next === "chat") setSeenMessages(messages.length);
    setTab(next);
  }

  const feed: FeedItem[] = [
    ...messages
      .filter((m) => !m.deleted && m.body)
      .slice(-40)
      .map((m) => ({
        kind: "message" as const,
        id: `m-${m.id}`,
        name: m.owner_name.split(" ")[0],
        color: isHexColor(m.owner_chat_color)
          ? m.owner_chat_color
          : m.owner_chat_color === MULTI
            ? MULTI_COLORS[0]
            : NAME_COLORS[hash(m.owner_name, NAME_COLORS.length)],
        body: m.body,
        plus: m.reactions.reduce((n, r) => n + r.count, 0),
      })),
    ...moments,
    ...rosterMoments.map((m) => ({
      kind: "moment" as const,
      id: `roster-${m.id}`,
      text: `${lastName(m.playerName)} ${m.touchdown ? "touchdown" : "big play"}`,
      points: `+${m.points.toFixed(1)}`,
      team: m.proTeam ?? "",
    })),
    // League moments stay in the chat after their pop-up is gone.
    ...rm.history
      .filter((m) => m.tier === 3)
      .reverse()
      .map((m) => ({
        kind: "moment" as const,
        id: `league-${m.id}`,
        text: m.kind === "chug" ? `Chug alert · ${m.detail}` : m.title,
        points: "",
        team: m.kind === "chug" ? "" : m.detail,
      })),
  ];

  async function toggleShare() {
    setShareError(null);
    try {
      const starting = !isScreenShareEnabled;
      await toggleGameShare(localParticipant, starting);
      if (starting && !tv.gameId) setTvMenu(true);
    } catch (e) {
      setShareError(e instanceof Error ? e.message : "Couldn't start sharing.");
    }
  }

  const nflItems = buildNflTickerItems((scoreboard?.games ?? []).map((g) => withTvScore(g, game)));
  const leagueItems = ticker ? buildLeagueTickerItems(ticker) : [];

  // From 1024px the cameras ring the TV (LoungeRing); below, they sit in
  // a grid under it.
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => false);
  const tvScreen = (
    <Tv
      share={share}
      game={game}
      catchingUp={delayed.catchingUp}
      accent={accent}
      overlay={rm.big?.tier === 1 ? <MomentRibbon moment={rm.big} accent={accent} onDismiss={rm.dismissBig} /> : null}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" style={{ background: "#0b0d14", color: "#f3f4f6" }}>
      <header className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] px-4 py-3 sm:gap-4 sm:px-6">
        <span className="font-display text-lg font-bold tracking-wide sm:text-xl">THE WEEKEND</span>
        <span className="text-white/30">/</span>
        <span className="font-display text-base font-semibold tracking-wide uppercase sm:text-lg">{room.kind === "open" ? "League Lounge" : room.name}</span>
        <span className="flex items-center gap-1.5 text-[13px] text-[#9aa3b2]">
          <span className="h-2 w-2 rounded-full bg-[#dc143c]" />
          {participants.length} watching
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {isScreenShareEnabled && (
            <div className="relative">
              <button onClick={() => setTvMenu((v) => !v)} className="h-[38px] rounded-full border border-white/[0.12] bg-[#12151d] px-4 text-[13px] font-semibold">
                TV: {game ? `${game.away_team.abbr} @ ${game.home_team.abbr}` : "Pick the game"} · Sync
              </button>
              {tvMenu && (
                <TvMenu
                  roomId={room.id}
                  games={scoreboard?.games ?? []}
                  currentGameId={tv.gameId}
                  delaySeconds={tv.delaySeconds}
                  recentPlays={delayed.recentPlays}
                  serverNow={delayed.serverNow}
                  onClose={() => setTvMenu(false)}
                />
              )}
            </div>
          )}
          <div className="relative">
            <button
              onClick={() => setMomentsOpen((v) => !v)}
              aria-expanded={momentsOpen}
              className="h-[38px] rounded-full border border-white/[0.12] bg-[#12151d] px-4 text-[13px] font-semibold"
            >
              Moments{rm.history.length ? ` · ${rm.history.length}` : ""}
            </button>
            {momentsOpen && <MomentsMenu history={rm.history} accent={accent} onClose={() => setMomentsOpen(false)} />}
          </div>
          <button
            onClick={() => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
            aria-pressed={isMicrophoneEnabled}
            className={`h-[38px] rounded-full px-4 text-[13px] font-semibold ${isMicrophoneEnabled ? "border border-white/[0.12] bg-[#12151d]" : "bg-[#b91c3c] text-white"}`}
          >
            {isMicrophoneEnabled ? "Mic on" : "Mic off"}
          </button>
          <button
            onClick={() => void localParticipant.setCameraEnabled(!isCameraEnabled)}
            aria-pressed={isCameraEnabled}
            className={`h-[38px] rounded-full px-4 text-[13px] font-semibold ${isCameraEnabled ? "border border-white/[0.12] bg-[#12151d]" : "bg-[#b91c3c] text-white"}`}
          >
            {isCameraEnabled ? "Camera on" : "Camera off"}
          </button>
          <button
            onClick={() => setTheater((v) => !v)}
            aria-pressed={theater}
            className={`h-[38px] rounded-full px-4 text-[13px] font-semibold ${theater ? "bg-[#eceef1] text-[#0d1016]" : "border border-white/[0.12] bg-[#12151d]"}`}
          >
            {theater ? "Exit theater" : "Theater"}
          </button>
          <div className="relative">
            <button
              onClick={() => setDevicesOpen((v) => !v)}
              aria-expanded={devicesOpen}
              className="h-[38px] rounded-full border border-white/[0.12] bg-[#12151d] px-4 text-[13px] font-semibold"
            >
              Devices
            </button>
            {devicesOpen && (
              <div className="absolute top-full right-0 z-40 mt-2 max-h-[60vh] w-72 overflow-y-auto rounded-xl border border-white/10 bg-[#0f1420] p-3 text-[13px] shadow-2xl">
                <p className="pb-1 text-xs text-[#9aa3b2]">Microphone</p>
                <DeviceList kind="audioinput" />
                <p className="pt-3 pb-1 text-xs text-[#9aa3b2]">Camera</p>
                <DeviceList kind="videoinput" />
                <p className="pt-3 pb-1 text-xs text-[#9aa3b2]">{canSplitGameAudio ? "Speakers · everyone's voices" : "Speakers"}</p>
                <DeviceList kind="audiooutput" />
                {canSplitGameAudio && (
                  <>
                    <p className="pt-3 pb-1 text-xs text-[#9aa3b2]">Game audio</p>
                    <GameOutputList />
                    <p className="pt-1 text-[11px] leading-snug text-white/40">Send the game to its own output, like a mixer&apos;s Game channel, with voices on Chat.</p>
                  </>
                )}
                <button onClick={() => setDevicesOpen(false)} className="mt-3 w-full rounded-full bg-white/10 py-1.5 font-semibold">
                  Done
                </button>
              </div>
            )}
          </div>
          <button onClick={toggleShare} className={`h-[38px] rounded-full px-4 text-[13px] font-semibold ${isScreenShareEnabled ? "bg-[#b91c3c] text-white" : "border border-white/[0.12] bg-[#12151d]"}`}>
            {isScreenShareEnabled ? "Stop sharing" : "Share screen"}
          </button>
          {isHost && (
            <button
              onClick={() => {
                if (!window.confirm("End this watch party for everyone?")) return;
                void endWatchParty(room.id).finally(onLeave);
              }}
              className="h-[38px] rounded-full border border-[#b91c3c] px-4 text-[13px] font-bold text-[#fca5a5]"
            >
              End party
            </button>
          )}
          <button onClick={onLeave} className="h-[38px] rounded-full bg-[#b91c3c] px-4 text-[13px] font-bold text-white">
            Leave
          </button>
        </div>
        {shareError && <p className="w-full text-xs text-red-400">{shareError}</p>}
      </header>

      {/* The same strips as every other page (components/LiveTicker.tsx),
          so they can be dragged too — links off, so a tap doesn't pull
          you out of the room. */}
      {!theater && <TickerStrip label="NFL" labelColor="#9aa3b2" items={noLinks(nflItems)} fast tint="rgba(255,255,255,0.03)" />}
      {!theater && leagueItems.length > 0 && <TickerStrip label="LEAGUE" labelColor={accent} items={noLinks(leagueItems)} fast tint="rgba(57,255,20,0.04)" />}

      {/* Phones stack everything: TV, gamecast, a banner and the cameras,
          chat. From 1024px everyone's camera rings the TV (LoungeRing),
          banners fill the open border, the gamecast sits under it and chat
          beside it. Layout lives in globals.css (.lounge-grid, .lounge-ring). */}
      <main className="lounge-grid w-full flex-1 px-4 py-5 sm:px-6" data-theater={theater ? "" : undefined}>
        <div className="lounge-tv-cell">
          {wide ? (
            <>
              <div className="mb-2.5 flex items-center justify-between gap-2 px-0.5">
                <span className="text-xs font-bold tracking-wider text-[#9aa3b2] uppercase">In the room · {participants.length}</span>
                <button onClick={() => setVolumeOpen(true)} className="rounded-full border border-white/[0.1] px-3 py-1 text-xs font-semibold text-[#9aa3b2] hover:bg-white/5">
                  Sound board
                </button>
              </div>
              <LoungeRing
                people={participants}
                keyOf={(p) => p.identity}
                tv={tvScreen}
                renderTile={(p) => <Tile participant={p} accent={accent} hit={hits[personOf(p.identity)]} owesChug={rm.chugOwner === personOf(p.identity)} fill />}
              />
            </>
          ) : (
            tvScreen
          )}
        </div>

        <section aria-label="Gamecast" className="lounge-cast flex min-w-0 flex-col gap-3">
          {rm.big?.kind === "chug" && <ChugAlertCard moment={rm.big} onPileOn={() => react("chug")} onDismiss={rm.dismissBig} />}
          {rm.swing && <SwingStrip swing={rm.swing} accent={accent} />}
          {game ? (
            <>
              <FieldVisualization game={game} beta />
              <LastPlay game={game} points={lastPlayPoints} accent={accent} />
            </>
          ) : (
            <>
              <RosterMoments moments={rosterMoments} accent={accent} />
              <div className="rounded-[14px] border border-white/[0.08] bg-[#12151d] p-4 text-sm text-[#9aa3b2]">
                {share ? "Waiting for whoever's sharing to pick the game on the TV." : "When someone shares a game, its gamecast shows here."}
              </div>
            </>
          )}
        </section>

        <section aria-label="In the room" className="lounge-cams flex min-h-0 min-w-0 flex-col gap-2.5 rounded-2xl border border-white/[0.08] bg-[#12151d] p-3">
          <div className="flex items-center justify-between gap-2 px-0.5">
            <span className="text-xs font-bold tracking-wider text-[#9aa3b2] uppercase">In the room · {participants.length}</span>
            <button onClick={() => setVolumeOpen(true)} className="rounded-full border border-white/[0.1] px-3 py-1 text-xs font-semibold text-[#9aa3b2] hover:bg-white/5">
              Sound board
            </button>
          </div>
          {/* Phones and tablets: the cameras in a grid under the TV (the
              ring takes over from 1024px, so they're only mounted once). */}
          {!wide && (
            <>
              <LoungeBanner shape="strip" className="h-[76px] shrink-0" />
              <CameraGrid>
                {participants.map((p) => (
                  <Tile key={p.identity} participant={p} accent={accent} hit={hits[personOf(p.identity)]} owesChug={rm.chugOwner === personOf(p.identity)} />
                ))}
              </CameraGrid>
            </>
          )}
        </section>

        <aside className="lounge-side flex min-w-0 flex-col gap-3 rounded-2xl border border-white/[0.08] bg-[#10131b] p-3">
          <div role="tablist" aria-label="Side panel" className="flex gap-1.5">
            {(["chat", "sweat", "plays"] as const).map((id) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => pickTab(id)}
                className="h-9 flex-1 rounded-full text-[13px] font-bold"
                style={tab === id ? { background: accent, color: "#06110a" } : { border: "1px solid rgba(255,255,255,0.12)" }}
              >
                {id === "chat" ? "Chat" : id === "sweat" ? "My Sweat" : "Plays"}
                {id === "chat" && unread > 0 && <span style={{ color: accent }}> · {unread}</span>}
              </button>
            ))}
          </div>

          {week?.matchup && (
            <div className="flex items-center gap-2.5 rounded-xl border bg-[#161a24] px-3 py-2.5 text-[13px]" style={{ borderColor: "rgba(57,255,20,0.25)" }}>
              <b className="truncate">{week.team_name}</b>
              <span className="font-mono">{fmt(week.matchup.my_score)}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#2b2f3a]">
                <div className="h-full" style={{ width: `${Math.max(2, Math.min(98, winPct ?? 50))}%`, background: accent }} />
              </div>
              <span className="font-mono">{fmt(week.matchup.opponent_score)}</span>
            </div>
          )}

          {tab === "chat" && (
            <ChatPanel feed={feed} members={members} onSend={(body, mentions) => onSend(body, mentions, null, null)} onReact={react} counts={counts} accent={accent} />
          )}
          {tab === "sweat" && (
            <LoungeSweatPanel week={week} league={leagueContext?.matchups ?? []} bets={bets?.bets ?? []} leagueBets={leagueBets?.enabled ? leagueBets.bets : []} myOwnerId={myOwnerId} accent={accent} />
          )}
          {tab === "plays" && <PlaysPanel game={game} />}
        </aside>
      </main>
      <MomentToasts toasts={rm.toasts} accent={accent} onDismiss={rm.dismissToast} />

      <RoomAudioRenderer />
      <StartAudio label="Click to turn on sound" className="fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white px-5 py-3 text-sm font-bold text-black shadow-lg" />
      <ParticipantVolumePanel open={volumeOpen} onClose={() => setVolumeOpen(false)} />
    </div>
  );
}

function withTvScore(g: NflGame, tv: LiveGame | null): NflGame {
  if (!tv || g.id !== tv.game_id) return g;
  return {
    ...g,
    home_score: String(tv.home_team.score),
    away_score: String(tv.away_team.score),
    state: tv.status === "final" ? "post" : tv.status === "scheduled" ? "pre" : "in",
    status_detail: clockLabel(tv),
  };
}

function noLinks(items: TickerItem[]): TickerItem[] {
  return items.map((item) => ({ ...item, href: undefined }));
}

const CHROME_FADE_MS = 3000;

function Tv({
  share,
  game,
  catchingUp,
  accent,
  overlay,
}: {
  share: TrackReference | undefined;
  game: LiveGame | null;
  catchingUp: boolean;
  accent: string;
  // A big moment's ribbon across the bottom (RoomMoments.tsx).
  overlay: React.ReactNode;
}) {
  const sharer = share?.participant;
  // Like the app's TV: LIVE, who's sharing and the sound control fade
  // CHROME_FADE_MS after the mouse last moved over the game (LIVE shrinks
  // to a red dot), and come back on any move or tap. The score bug stays.
  const [chrome, setChrome] = useState(true);
  const fadeTimer = useRef<number | undefined>(undefined);
  const fades = !!share;
  const wake = () => {
    if (!fades) return;
    setChrome(true);
    window.clearTimeout(fadeTimer.current);
    fadeTimer.current = window.setTimeout(() => setChrome(false), CHROME_FADE_MS);
  };
  useEffect(() => {
    if (!fades) return;
    fadeTimer.current = window.setTimeout(() => setChrome(false), CHROME_FADE_MS);
    return () => window.clearTimeout(fadeTimer.current);
  }, [fades]);
  const shown = !fades || chrome;
  return (
    <section
      aria-label="Shared game"
      onPointerMove={wake}
      onPointerDown={wake}
      onFocus={wake}
      className="lounge-tv relative overflow-hidden rounded-2xl border"
      style={{ borderColor: "rgba(255,255,255,0.08)", background: "radial-gradient(120% 90% at 50% 20%, #1d3a24 0%, #0f1f14 55%, #070b08 100%)" }}
    >
      {share ? (
        <VideoTrack trackRef={share} className="absolute inset-0 h-full w-full object-contain" />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center">
          <p className="text-sm font-semibold">Nothing on the TV yet</p>
          <p className="text-xs text-white/50">Hit &ldquo;Share screen&rdquo; to put the game up.</p>
        </div>
      )}
      {(
        <>
          {fades && (
            <span
              aria-hidden
              className="absolute top-4 left-4 h-2.5 w-2.5 rounded-full bg-[#dc143c] shadow-[0_0_6px_#dc143c] transition-opacity duration-300"
              style={{ opacity: shown ? 0 : 1 }}
            />
          )}
          <div
            className={`absolute inset-0 transition-opacity duration-300 ${shown ? "pointer-events-none [&>*]:pointer-events-auto" : "pointer-events-none opacity-0 [&_*]:pointer-events-none"}`}
          >
            {share && (
              <div className="absolute top-3.5 left-3.5 flex gap-2">
                <span className="rounded bg-[#dc143c] px-2 py-1 text-[11px] font-extrabold tracking-wider text-white">LIVE</span>
                <span className="rounded bg-black/60 px-2.5 py-1 text-xs">Shared by {sharer?.isLocal ? "you" : sharer?.name || "someone"}</span>
              </div>
            )}
            {sharer && (sharer.isLocal ? <SharerGameVolume accent={accent} /> : <GameVolume accent={accent} className="absolute top-3.5 right-3.5" />)}
          </div>
          {/* A broadcast-style bug in the corner, only as wide as the
              scores: quarter and clock on top, the score (a dot for who has
              the ball), down and distance underneath. */}
          {game && !overlay && (
            <div className="absolute bottom-3.5 left-3.5 flex flex-col overflow-hidden rounded-[10px] bg-[rgba(8,10,16,0.85)] font-mono whitespace-nowrap shadow-lg">
              <div className="flex items-center justify-center gap-1.5 px-2 py-0.5 text-[11px] text-white/85">
                <span>{clockLabel(game)}</span>
                {catchingUp && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#9aa3b2]" title="Syncing to the TV" />}
              </div>
              <div className="flex">
                {[game.away_team, game.home_team].map((t) => (
                  <div key={t.abbr} className="flex flex-1 items-center gap-1.5 px-2.5 py-1" style={{ background: nflTeamColor(t.abbr) ?? "#2b2d31" }}>
                    <b className="font-display text-sm">{t.abbr}</b>
                    <b className="text-lg leading-none">{t.score}</b>
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${game.status === "in_progress" && game.possession_team_abbr === t.abbr ? "bg-[#facc15] shadow-[0_0_4px_#facc15]" : "bg-transparent"}`}
                      aria-label={game.status === "in_progress" && game.possession_team_abbr === t.abbr ? `${t.abbr} has the ball` : undefined}
                    />
                  </div>
                ))}
              </div>
              {downLabel(game) && <div className="px-2 py-0.5 text-center text-[11px] text-[#facc15]">{downLabel(game)}</div>}
            </div>
          )}
          {overlay}
        </>
      )}
    </section>
  );
}

// Where the game plays: with the voices, or an output of its own
// (lib/loungeGameOutput.ts).
function GameOutputList() {
  const { devices } = useMediaDeviceSelect({ kind: "audiooutput" });
  const output = useGameOutput();
  const options = [{ id: null as string | null, label: "Same as speakers" }, ...devices.map((d) => ({ id: d.deviceId as string | null, label: d.label || "Speaker" }))];
  return (
    <ul className="flex flex-col gap-0.5">
      {options.map((o) => (
        <li key={o.id ?? "same"}>
          <button
            onClick={() => setGameOutput(o.id)}
            className={`w-full rounded px-2 py-1.5 text-left break-words ${o.id === output ? "bg-white/15 font-semibold" : "hover:bg-white/5"}`}
          >
            {o.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

// Pick which mic, camera or speakers the call uses (the browser's own
// device list; built on the hook rather than LiveKit's <MediaDeviceSelect/>,
// see LoungeVideoRoom.tsx's DeviceList for why).
function DeviceList({ kind }: { kind: MediaDeviceKind }) {
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind });
  if (devices.length === 0) return <p className="py-1 text-white/40">None found</p>;
  return (
    <ul className="flex flex-col gap-0.5">
      {devices.map((d) => (
        <li key={d.deviceId}>
          <button
            onClick={() => void setActiveMediaDevice(d.deviceId)}
            className={`w-full rounded px-2 py-1.5 text-left break-words ${d.deviceId === activeDeviceId ? "bg-white/15 font-semibold" : "hover:bg-white/5"}`}
          >
            {d.deviceId === activeDeviceId ? "✓ " : ""}
            {d.label || kind}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The sharer's own game volume. Their shared tab is muted on their
 *  computer (suppressLocalAudioPlayback in lib/livekitMedia.ts), so this
 *  plays the shared audio back to them — turn the game down and still
 *  hear everyone. No delay: it's their own track, not the room's copy. */
function SharerGameVolume({ accent }: { accent: string }) {
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();
  const gameAudio = useTracks([Track.Source.ScreenShareAudio]).find((t) => t.participant.isLocal)?.publication?.track?.mediaStreamTrack;
  // A plain audio element can't go past its own full volume.
  const volume = Math.min(1, gameGain(useLoungeVolume().game));
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const gameOutput = useGameOutput();

  useEffect(() => {
    if (!gameAudio) return;
    const audio = new Audio();
    audio.srcObject = new MediaStream([gameAudio]);
    audio.volume = volume;
    // Same speakers the rest of the call plays through (Devices).
    // The game's own output when one is picked (split audio), else the
    // same speakers as the rest of the call.
    const sink = gameOutput ?? room.getActiveDevice("audiooutput");
    if (sink && "setSinkId" in audio) void (audio as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> }).setSinkId(sink).catch(() => {});
    void audio.play().catch(() => {});
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.srcObject = null;
      audioRef.current = null;
    };
    // volume is applied live below; restarting playback on every step would stutter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameAudio, room, localParticipant, gameOutput]);
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  if (!gameAudio) return null;
  return <GameVolume accent={accent} className="absolute top-3.5 right-3.5" />;
}


/** Your starters' moments from every game, newest first (no game on the TV). */
function RosterMoments({ moments, accent }: { moments: RosterMoment[]; accent: string }) {
  if (moments.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-white/[0.08] bg-[#12151d] p-3.5">
      <span className="text-xs font-bold tracking-wider text-[#9aa3b2] uppercase">Your players</span>
      {[...moments]
        .reverse()
        .slice(0, 6)
        .map((m, i) => (
          <div
            key={m.id}
            className="flex items-center gap-2.5 rounded-xl border px-3 py-2 text-sm"
            style={i === 0 ? { background: "rgba(57,255,20,0.08)", borderColor: "rgba(57,255,20,0.3)" } : { borderColor: "rgba(255,255,255,0.06)" }}
          >
            <span className="rounded px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-black" style={{ background: m.touchdown ? accent : "#facc15" }}>
              {m.touchdown ? "TD" : "BIG"}
            </span>
            <span className="min-w-0 flex-1 truncate">
              <b>{m.playerName}</b>
              <span className="text-[#9aa3b2]">
                {m.position ? ` · ${m.position}` : ""}
                {m.proTeam ? ` · ${m.proTeam}` : ""}
              </span>
            </span>
            <b className="font-mono" style={{ color: accent }}>
              +{m.points.toFixed(1)}
            </b>
          </div>
        ))}
    </div>
  );
}

function LastPlay({ game, points, accent }: { game: LiveGame; points: { playId: string; players: GamecastPlayFantasyPlayer[] } | null; accent: string }) {
  const play = game.plays.find((p) => p.is_scoring_play || !["timeout", "other"].includes(p.play_type));
  if (!play) return null;
  const pts = points && points.playId === play.play_id ? points.players.filter((p) => Math.abs(p.points) >= 0.05).slice(0, 3) : [];
  return (
    <p className="m-0 rounded-[14px] border border-white/[0.08] bg-[#12151d] px-4 py-3 text-sm">
      <b>Last play:</b> {play.description}{" "}
      {pts.length > 0 && (
        <span style={{ color: accent }}>
          {pts.map((p) => `${lastName(p.player_name)} ${p.points >= 0 ? "+" : "−"}${Math.abs(p.points).toFixed(1)}`).join(" · ")}
        </span>
      )}
    </p>
  );
}

const WIDE = "(min-width: 1024px)";
function subscribeWide(onChange: () => void) {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** The cameras on phones and tablets: a grid under the TV. From 1024px
 *  they ring the TV instead (LoungeRing). */
function CameraGrid({ children }: { children: React.ReactNode }) {
  return <div className="lounge-cams-grid">{children}</div>;
}

// A camera tile in its honeycomb frame, which lights up in an NFL team's
// colors when that team moves this person's score (HexFrame).
function Tile({ participant, accent, hit, owesChug, fill = false }: { participant: Participant; accent: string; hit?: ScoringHit; owesChug?: boolean; fill?: boolean }) {
  const speaking = useIsSpeaking(participant);
  const camera = useTracks([Track.Source.Camera]).find((t) => t.participant.identity === participant.identity) as TrackReference | undefined;
  const name = participant.isLocal ? "You" : participant.name || participant.identity;
  const cameraOn = !!camera && !camera.publication?.isMuted;
  return (
    <HexFrame hit={hit} style={fill ? { width: "100%", height: "100%" } : { aspectRatio: "16 / 9" }}>
      <div className="absolute inset-0 flex items-center justify-center" style={{ background: TILE_COLORS[hash(name, TILE_COLORS.length)] }}>
        {cameraOn ? (
          <VideoTrack trackRef={camera} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <span className="font-display text-3xl text-white/70">{name.slice(0, 1).toUpperCase()}</span>
        )}
      </div>
      <span className="absolute bottom-2 left-2 rounded-md bg-black/55 px-2 py-0.5 text-[13px] font-bold">{name}</span>
      {owesChug && <span className="font-display absolute top-2 left-2 rounded-full bg-[#facc15] px-2 py-0.5 text-[11px] font-bold text-[#120f02]">OWES 1</span>}
      {(speaking || owesChug) && (
        <span className="pointer-events-none absolute inset-0 rounded-[9px]" style={{ boxShadow: `inset 0 0 0 2px ${owesChug ? "#facc15" : accent}` }} />
      )}
    </HexFrame>
  );
}

function ChatPanel({
  feed,
  members,
  onSend,
  onReact,
  counts,
  accent,
}: {
  feed: FeedItem[];
  members: ChatMember[];
  onSend: (body: string, mentions: number[]) => void;
  onReact: (k: ReactionKey) => void;
  counts: Record<ReactionKey, number>;
  accent: string;
}) {
  const [draft, setDraft] = useState("");
  // @mentions, as in MessageComposer.tsx: "@Jo" before the cursor lists
  // league members; a tag pings them with a link into this room — even
  // if they haven't opened it yet (backend chat_ws).
  const [cursor, setCursor] = useState(0);
  // Display name (or "everyone") → the owner ids it tags.
  const [pendingMentions, setPendingMentions] = useState<Map<string, number[]>>(new Map());
  const inputRef = useRef<HTMLInputElement>(null);
  const mentionQuery = draft.slice(0, cursor).match(/(?:^|\s)@(\w*)$/)?.[1] ?? null;
  const q = mentionQuery?.toLowerCase() ?? "";
  // @everyone tags every league member at once.
  const everyoneMatches = mentionQuery !== null && members.length > 1 && "everyone".startsWith(q);
  const matches = mentionQuery === null ? [] : members.filter((m) => m.display_name.toLowerCase().startsWith(q)).slice(0, everyoneMatches ? 5 : 6);
  function pick(name: string, ownerIds: number[]) {
    const before = draft.slice(0, cursor).replace(/@(\w*)$/, `@${name} `);
    setDraft(before + draft.slice(cursor));
    setCursor(before.length);
    setPendingMentions((prev) => new Map(prev).set(name, ownerIds));
    inputRef.current?.focus();
  }
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [feed.length]);
  return (
    <>
      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">
        <div className="flex-1" />
        {feed.map((item) =>
          item.kind === "moment" ? (
            <div key={item.id} className="flex items-center gap-2 rounded-[10px] border px-2.5 py-2 text-[13px]" style={{ background: "rgba(57,255,20,0.08)", borderColor: "rgba(57,255,20,0.25)" }}>
              <span>
                <b>{item.text}</b>
                {item.points ? (
                  <>
                    {" · "}
                    <b style={{ color: accent }}>{item.points}</b>
                  </>
                ) : null}
                {item.team ? ` ${item.points ? "" : "· "}${item.team}` : ""}
              </span>
            </div>
          ) : (
            <div key={item.id} className="flex items-center gap-2 text-sm">
              <span>
                <b style={{ color: item.color }}>{item.name}</b> <span className="text-[#d1d5db]">{item.body}</span>
              </span>
              {item.plus > 0 && <span className="rounded-full bg-white/[0.08] px-1.5 text-[11px]">+{item.plus}</span>}
            </div>
          )
        )}
      </div>
      <div className="flex gap-1.5">
        {REACTIONS.map((r) => (
          <button key={r.key} onClick={() => onReact(r.key)} className="h-8 flex-1 rounded-full border border-white/[0.1] bg-[#161a24] text-xs font-bold">
            {r.label}
            {counts[r.key] > 0 && <span className="font-mono font-medium text-[#9aa3b2]"> ×{counts[r.key]}</span>}
          </button>
        ))}
      </div>
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          const body = draft.trim();
          if (!body) return;
          onSend(body, [...new Set([...pendingMentions].filter(([name]) => body.includes(`@${name}`)).flatMap(([, ids]) => ids))]);
          setDraft("");
          setCursor(0);
          setPendingMentions(new Map());
        }}
      >
        {(everyoneMatches || matches.length > 0) && (
          <div className="absolute right-0 bottom-full left-0 z-40 mb-1.5 flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0f1420] shadow-2xl">
            {everyoneMatches && (
              <button type="button" onClick={() => pick("everyone", members.map((m) => m.owner_id))} className="flex flex-col px-3 py-2 text-left text-sm hover:bg-white/[0.06]">
                <span className="font-semibold">@everyone</span>
                <span className="text-xs text-[#9aa3b2]">Tag the whole league</span>
              </button>
            )}
            {matches.map((m) => (
              <button key={m.owner_id} type="button" onClick={() => pick(m.display_name, [m.owner_id])} className="flex flex-col px-3 py-2 text-left text-sm hover:bg-white/[0.06]">
                <span className="font-semibold">{m.display_name}</span>
                <span className="text-xs text-[#9aa3b2]">{m.team_name}</span>
              </button>
            ))}
          </div>
        )}
        <label className="flex">
          <span className="sr-only">Message the room</span>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setCursor(e.target.selectionStart ?? e.target.value.length);
            }}
            onSelect={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
            placeholder="Talk your talk…"
            className="h-11 flex-1 rounded-full border border-white/[0.1] bg-[#161a24] px-4 text-sm text-[#f3f4f6]"
          />
        </label>
      </form>
    </>
  );
}

function PlaysPanel({ game }: { game: LiveGame | null }) {
  if (!game) return <p className="text-sm text-[#9aa3b2]">Plays from the game on the TV show here, in step with the stream.</p>;
  const plays = game.plays.filter((p) => p.is_scoring_play || !["timeout", "other"].includes(p.play_type)).slice(0, 25);
  return (
    <ol className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      {plays.map((p) => (
        <li key={p.play_id} className="rounded-xl px-3 py-2 text-[13px]" style={{ background: p.is_scoring_play ? "rgba(227,24,55,0.12)" : "#161a24" }}>
          <span className="font-mono text-xs text-[#9aa3b2]">
            Q{p.period} {p.clock}
          </span>{" "}
          {p.description}
        </li>
      ))}
    </ol>
  );
}

// Whoever's sharing: which game is on the TV, and lining the room's delay
// up with it — pick the play that just finished on your TV.
function TvMenu({
  roomId,
  games,
  currentGameId,
  delaySeconds,
  recentPlays,
  serverNow,
  onClose,
}: {
  roomId: number;
  games: NflGame[];
  currentGameId: string | null;
  delaySeconds: number;
  recentPlays: { play: GamecastPlay; firstSeenAt: number }[];
  serverNow: () => number;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const live = games.filter((g) => g.state === "in" || g.state === "pre");
  async function save(body: { game_id?: string | null; delay_seconds?: number }) {
    setBusy(true);
    try {
      await loungeApi.setTv(roomId, body);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="absolute top-full right-0 z-40 mt-2 w-[320px] rounded-xl border border-white/10 bg-[#0f1420] p-3 text-[13px] shadow-2xl">
      <div className="mb-2 flex items-center justify-between">
        <b>What&apos;s on your TV</b>
        <button onClick={onClose} aria-label="Close" className="text-[#9aa3b2]">
          ✕
        </button>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-[#9aa3b2]">Game</span>
        <select
          value={currentGameId ?? ""}
          disabled={busy}
          onChange={(e) => void save({ game_id: e.target.value || null })}
          className="h-9 rounded-lg border border-white/10 bg-[#161a24] px-2"
        >
          <option value="">Nothing / not a game</option>
          {live.map((g) => (
            <option key={g.id} value={g.id}>
              {g.away_team} @ {g.home_team} · {g.status_detail}
            </option>
          ))}
        </select>
      </label>
      {currentGameId && (
        <div className="mt-3 flex flex-col gap-1.5">
          <span className="text-xs text-[#9aa3b2]">
            Sync to TV — tap the play that just finished on your screen (now {delaySeconds}s behind live)
          </span>
          {recentPlays.length === 0 && <span className="text-xs text-[#9aa3b2]">No plays yet.</span>}
          {recentPlays.map(({ play, firstSeenAt }) => (
            <button
              key={play.play_id}
              disabled={busy}
              onClick={() => void save({ delay_seconds: delayForPlay(firstSeenAt, serverNow()) }).then(onClose)}
              className="rounded-lg bg-[#161a24] px-2.5 py-2 text-left hover:bg-[#1d2230]"
            >
              <span className="font-mono text-xs text-[#9aa3b2]">{play.clock}</span> {play.description.slice(0, 80)}
            </button>
          ))}
          <div className="mt-1 flex items-center gap-2 text-xs">
            <span className="text-[#9aa3b2]">Fine-tune</span>
            <button onClick={() => void save({ delay_seconds: Math.max(0, delaySeconds - 5) })} className="rounded-full border border-white/10 px-2.5 py-1">
              −5s
            </button>
            <button onClick={() => void save({ delay_seconds: Math.min(180, delaySeconds + 5) })} className="rounded-full border border-white/10 px-2.5 py-1">
              +5s
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
