"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  RoomAudioRenderer,
  StartAudio,
  VideoTrack,
  useDataChannel,
  useIsSpeaking,
  useLocalParticipant,
  useMediaDeviceSelect,
  useParticipants,
  useTracks,
  type TrackReference,
} from "@livekit/components-react";
import { Track, type Participant, type RemoteParticipant } from "livekit-client";
import { FieldVisualization } from "@/components/gamecast/FieldVisualization";
import { ParticipantVolumePanel } from "@/components/watchparty/ParticipantVolumePanel";
import { buildLeagueTickerItems, buildNflTickerItems, type ChatMessage, type NflGame, type TickerItem, type WatchPartyRoom } from "@/lib/api";
import { getPlayFantasy, type GamecastPlay, type GamecastPlayFantasyPlayer, type LiveGame } from "@/lib/gamecastApi";
import { toggleGameShare } from "@/lib/livekitMedia";
import {
  clockLabel,
  delayForPlay,
  downLabel,
  isTouchdown,
  lastName,
  loungeApi,
  scoringHeadline,
  shade,
  useDelayedGame,
  useDelayedValue,
  usePolled,
  useRoomTv,
} from "@/lib/loungeLive";
import { nflTeamColor, nflTeamName } from "@/lib/nfl-teams";

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
const MOMENT_MS = 15000;
const TILE_COLORS = ["#3b1d10", "#2a1650", "#152a5c", "#073d2d", "#4a1029", "#27272a"];
const NAME_COLORS = ["#fcd34d", "#f9a8d4", "#93c5fd", "#86efac", "#fca5a5", "#c4b5fd"];
const hash = (s: string, n: number) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % n;
};
const fmt = (n: number | null | undefined) => (n ?? 0).toFixed(1);

type Moment = { play: GamecastPlay; game: LiveGame; players: GamecastPlayFantasyPlayer[]; at: number };
type FeedItem =
  | { kind: "message"; id: string; name: string; color: string; body: string; plus: number }
  | { kind: "moment"; id: string; text: string; points: string; team: string };

export function WebLoungeRoom({
  room,
  messages,
  myOwnerId,
  onSend,
  onLeave,
}: {
  room: WatchPartyRoom;
  messages: ChatMessage[];
  myOwnerId: number;
  onSend: (body: string, mentions: number[], replyToId: number | null, imageUrl: string | null) => void;
  onLeave: () => void;
}) {
  const accent = "var(--user-accent, var(--wl-accent))";
  const tv = useRoomTv(room.id, { gameId: room.tv_game_id ?? null, delaySeconds: room.tv_delay_seconds ?? 45 });
  const participants = useParticipants();
  const share = (useTracks([Track.Source.ScreenShare]) as TrackReference[])[0];
  const { localParticipant, isScreenShareEnabled, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [tab, setTab] = useState<"chat" | "sweat" | "plays">("chat");
  const [seenMessages, setSeenMessages] = useState(messages.length);
  const [moment, setMoment] = useState<Moment | null>(null);
  // Your win odds when the moment's play landed, for its "before → now".
  const [winBefore, setWinBefore] = useState<number | null>(null);
  const latestWin = useRef<number | null>(null);
  const [moments, setMoments] = useState<FeedItem[]>([]);
  const [lastPlayPoints, setLastPlayPoints] = useState<{ playId: string; players: GamecastPlayFantasyPlayer[] } | null>(null);
  const [reactions, setReactions] = useState<{ key: ReactionKey; at: number }[]>([]);
  const [shareError, setShareError] = useState<string | null>(null);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [tvMenu, setTvMenu] = useState(false);

  async function onPlay(play: GamecastPlay, game: LiveGame) {
    const players = (await getPlayFantasy(game.game_id, play.play_id).catch(() => null)) ?? [];
    setLastPlayPoints({ playId: play.play_id, players });
    if (isTouchdown(play)) {
      setWinBefore(latestWin.current);
      setMoment({ play, game, players, at: Date.now() });
      setTab("sweat");
    }
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

  useEffect(() => {
    if (!moment) return;
    const id = setTimeout(() => setMoment(null), MOMENT_MS);
    return () => clearTimeout(id);
  }, [moment]);

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
  const ticker = useDelayedValue(
    usePolled(week?.week ? `t${week.season}-${week.week}` : null, () => loungeApi.leagueTicker(week!.season, week!.week!), 15000),
    tv.delaySeconds
  );
  const scoreboard = usePolled("nfl", loungeApi.scoreboard, 30000);

  const mySide = detail ? (detail.home.owner_id === myOwnerId ? detail.home : detail.away) : null;
  const myStarters = (mySide?.roster ?? []).filter((p) => p.lineup_slot !== "BE" && p.lineup_slot !== "IR");
  const winPct = week?.matchup?.win_probability ?? null;
  useEffect(() => {
    latestWin.current = winPct;
  }, [winPct]);

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
        color: m.owner_chat_color ?? NAME_COLORS[hash(m.owner_name, NAME_COLORS.length)],
        body: m.body,
        plus: m.reactions.reduce((n, r) => n + r.count, 0),
      })),
    ...moments,
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
                <p className="pt-3 pb-1 text-xs text-[#9aa3b2]">Speakers</p>
                <DeviceList kind="audiooutput" />
                <button onClick={() => setDevicesOpen(false)} className="mt-3 w-full rounded-full bg-white/10 py-1.5 font-semibold">
                  Done
                </button>
              </div>
            )}
          </div>
          <button onClick={toggleShare} className={`h-[38px] rounded-full px-4 text-[13px] font-semibold ${isScreenShareEnabled ? "bg-[#b91c3c] text-white" : "border border-white/[0.12] bg-[#12151d]"}`}>
            {isScreenShareEnabled ? "Stop sharing" : "Share screen"}
          </button>
          <button onClick={onLeave} className="h-[38px] rounded-full bg-[#b91c3c] px-4 text-[13px] font-bold text-white">
            Leave
          </button>
        </div>
        {shareError && <p className="w-full text-xs text-red-400">{shareError}</p>}
      </header>

      <TickerRow label="NFL" labelColor="#9aa3b2" items={nflItems} tint="rgba(255,255,255,0.03)" mono />
      {leagueItems.length > 0 && <TickerRow label="LEAGUE" labelColor={accent} items={leagueItems} tint="rgba(57,255,20,0.04)" />}

      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-wrap gap-5 px-4 py-5 sm:px-6">
        <div className="flex min-w-0 flex-col gap-3.5" style={{ flex: "999 1 640px" }}>
          <Tv share={share} game={game} moment={moment} counts={counts} catchingUp={delayed.catchingUp} accent={accent} />
          {moment ? (
            <MomentCards moment={moment} winBefore={winBefore} winNow={winPct} accent={accent} />
          ) : (
            <section aria-label="Gamecast" className="flex flex-wrap gap-3.5">
              <div className="flex min-w-0 flex-col gap-2.5" style={{ flex: "2 1 420px" }}>
                {game ? (
                  <FieldVisualization game={game} beta />
                ) : (
                  <div className="rounded-[14px] border border-white/[0.08] bg-[#12151d] p-4 text-sm text-[#9aa3b2]">
                    {share ? "Waiting for whoever's sharing to pick the game on the TV." : "When someone shares a game, its gamecast shows here."}
                  </div>
                )}
                {game && <LastPlay game={game} points={lastPlayPoints} accent={accent} />}
              </div>
              <div aria-label="In the room" className="grid gap-2 rounded-[14px] border border-white/[0.08] bg-[#12151d] p-3.5" style={{ flex: "1 1 240px", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", alignContent: "start" }}>
                {participants.slice(0, 9).map((p) => (
                  <Tile key={p.identity} participant={p} accent={accent} />
                ))}
                <button onClick={() => setVolumeOpen(true)} className="col-span-3 mt-1 rounded-full border border-white/[0.1] py-1.5 text-xs font-semibold text-[#9aa3b2]">
                  Adjust everyone&apos;s volume
                </button>
              </div>
            </section>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-3 rounded-2xl border border-white/[0.08] bg-[#10131b] p-3" style={{ flex: "1 1 340px", maxWidth: 420, minHeight: 600 }}>
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

          {tab === "chat" && <ChatPanel feed={feed} onSend={(body) => onSend(body, [], null, null)} onReact={react} accent={accent} />}
          {tab === "sweat" && <SweatPanel week={week} myStarters={myStarters} bets={bets?.bets ?? []} winPct={winPct} accent={accent} />}
          {tab === "plays" && <PlaysPanel game={game} />}
        </aside>
      </main>

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

function TickerRow({ label, labelColor, items, tint, mono }: { label: string; labelColor: string; items: TickerItem[]; tint: string; mono?: boolean }) {
  if (items.length === 0) return null;
  const line = (copy: number) =>
    items.map((item) => (
      <span key={`${copy}-${item.key}`} className="flex shrink-0 items-center whitespace-nowrap">
        {item.segments.map((seg, i) => (
          <span key={i} style={seg.color ? { color: seg.color, fontWeight: 700 } : undefined}>
            {seg.text}
          </span>
        ))}
        <span className="px-3 text-[#4b5263]">•</span>
      </span>
    ));
  return (
    <div className="flex min-h-[34px] items-center gap-3.5 overflow-hidden px-4 text-[13px] sm:px-6" style={{ background: tint }}>
      <span className="font-display shrink-0 text-[11px] font-bold tracking-[1.4px]" style={{ color: labelColor }}>
        {label}
      </span>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className={`live-ticker-track live-ticker-track--fast ${mono ? "font-mono" : ""}`}>
          {line(0)}
          {line(1)}
        </div>
      </div>
    </div>
  );
}

function Tv({
  share,
  game,
  moment,
  counts,
  catchingUp,
  accent,
}: {
  share: TrackReference | undefined;
  game: LiveGame | null;
  moment: Moment | null;
  counts: Record<ReactionKey, number>;
  catchingUp: boolean;
  accent: string;
}) {
  const sharer = share?.participant;
  const scorer = moment?.play.team_abbr ?? null;
  // The takeover wears the scoring team's colors.
  const teamColor = (scorer && nflTeamColor(scorer)) || "#e31837";
  const city = (() => {
    const name = nflTeamName(scorer) ?? scorer ?? "";
    const parts = name.split(" ");
    return (parts.length > 1 ? parts.slice(0, -1).join(" ") : name).toUpperCase();
  })();
  return (
    <section
      aria-label={moment ? "Touchdown" : "Shared game"}
      className="relative overflow-hidden rounded-2xl border"
      style={{
        aspectRatio: "16 / 9",
        maxHeight: 480,
        borderColor: moment ? `${teamColor}aa` : "rgba(255,255,255,0.08)",
        background: "radial-gradient(120% 90% at 50% 20%, #1d3a24 0%, #0f1f14 55%, #070b08 100%)",
        boxShadow: moment ? `0 0 60px ${teamColor}55` : undefined,
      }}
    >
      {share ? (
        <VideoTrack trackRef={share} className="absolute inset-0 h-full w-full object-contain" />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center">
          <p className="text-sm font-semibold">Nothing on the TV yet</p>
          <p className="text-xs text-white/50">Hit &ldquo;Share screen&rdquo; to put the game up.</p>
        </div>
      )}
      {moment ? (
        <>
          <div
            className="absolute inset-0"
            style={{ background: `radial-gradient(120% 90% at 50% 30%, ${shade(teamColor, 0.35)}eb 0%, ${shade(teamColor, 0.7)}eb 60%, ${shade(teamColor, 0.9)}f2 100%)` }}
          />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <span className="font-display text-base tracking-[6px] text-white/80">{city}</span>
            <span className="font-display text-5xl leading-none font-bold tracking-[3px] text-white sm:text-[88px]" style={{ textShadow: `0 0 32px ${teamColor}` }}>
              TOUCHDOWN
            </span>
            <span className="text-base text-white/90 sm:text-lg">{scoringHeadline(moment.play, moment.game)}</span>
          </div>
          <div className="absolute right-3.5 bottom-3.5 left-3.5 flex flex-wrap gap-2">
            {counts.letsgo > 0 && <span className="rounded-full px-3 py-1.5 text-[13px] font-extrabold" style={{ background: "rgba(57,255,20,0.18)" }}>LET&apos;S GO ×{counts.letsgo}</span>}
            {counts.robbed > 0 && <span className="rounded-full bg-[rgba(248,113,113,0.2)] px-3 py-1.5 text-[13px] font-extrabold">ROBBED ×{counts.robbed}</span>}
            {counts.chug > 0 && <span className="rounded-full bg-[rgba(250,204,21,0.2)] px-3 py-1.5 text-[13px] font-extrabold">CHUG! ×{counts.chug}</span>}
          </div>
        </>
      ) : (
        <>
          {share && (
            <div className="absolute top-3.5 left-3.5 flex gap-2">
              <span className="rounded bg-[#dc143c] px-2 py-1 text-[11px] font-extrabold tracking-wider text-white">LIVE</span>
              <span className="rounded bg-black/60 px-2.5 py-1 text-xs">Shared by {sharer?.isLocal ? "you" : sharer?.name || "someone"}</span>
            </div>
          )}
          {sharer && !sharer.isLocal && <TvVolume participant={sharer as RemoteParticipant} accent={accent} />}
          {/* A compact score block in the corner (not a full-width bar over
              the picture): scores, and the quarter and clock under them. */}
          {game && (
            <div className="absolute bottom-3.5 left-3.5 overflow-hidden rounded-[10px] bg-[rgba(8,10,16,0.85)] font-mono shadow-lg">
              <div className="flex">
                <div className="flex items-center gap-2 px-3 py-1.5" style={{ background: nflTeamColor(game.away_team.abbr) ?? "#2b2d31" }}>
                  <b className="font-display text-sm">{game.away_team.abbr}</b>
                  <b className="text-lg">{game.away_team.score}</b>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5" style={{ background: nflTeamColor(game.home_team.abbr) ?? "#2b2d31" }}>
                  <b className="font-display text-sm">{game.home_team.abbr}</b>
                  <b className="text-lg">{game.home_team.score}</b>
                </div>
              </div>
              <div className="flex items-center gap-2 px-3 py-1 text-[12px]">
                <span>{clockLabel(game)}</span>
                {downLabel(game) && <span className="text-[#facc15]">{downLabel(game)}</span>}
                {catchingUp && <span className="text-[#9aa3b2]">syncing…</span>}
              </div>
            </div>
          )}
        </>
      )}
    </section>
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

function TvVolume({ participant, accent }: { participant: RemoteParticipant; accent: string }) {
  const [volume, setVolume] = useState(() => participant.getVolume(Track.Source.ScreenShareAudio) ?? 1);
  return (
    <label className="absolute top-3.5 right-3.5 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f3f4f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M11 5L6 9H2v6h4l5 4V5z" />
        {volume > 0 ? <path d="M15.5 8.5a5 5 0 010 7" /> : <path d="M22 9l-6 6M16 9l6 6" />}
      </svg>
      <span className="sr-only">Game volume, only for you</span>
      <input
        type="range"
        min={0}
        max={2}
        step={0.05}
        value={volume}
        onChange={(e) => {
          const v = Number(e.target.value);
          setVolume(v);
          participant.setVolume(v, Track.Source.ScreenShareAudio);
        }}
        className="w-[96px]"
        style={{ accentColor: accent }}
      />
    </label>
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

function Tile({ participant, accent }: { participant: Participant; accent: string }) {
  const speaking = useIsSpeaking(participant);
  const camera = useTracks([Track.Source.Camera]).find((t) => t.participant.identity === participant.identity) as TrackReference | undefined;
  const name = participant.isLocal ? "You" : participant.name || participant.identity;
  return (
    <div
      className="relative flex items-end overflow-hidden rounded-[10px] p-1.5 text-[11px] font-bold"
      style={{ aspectRatio: "4 / 3", background: TILE_COLORS[hash(name, TILE_COLORS.length)], boxShadow: speaking ? `0 0 0 2px ${accent}` : "none" }}
    >
      {camera && !camera.publication?.isMuted && <VideoTrack trackRef={camera} className="absolute inset-0 h-full w-full object-cover" />}
      <span className="relative">{name}</span>
    </div>
  );
}

function MomentCards({ moment, winBefore, winNow, accent }: { moment: Moment; winBefore: number | null; winNow: number | null; accent: string }) {
  const mine = [...moment.players].sort((a, b) => Number(b.is_mine) - Number(a.is_mine) || Math.abs(b.points) - Math.abs(a.points)).slice(0, 2);
  return (
    <section aria-label="What that play meant" className="grid gap-3" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
      {mine.map((p, i) => (
        <div
          key={p.player_id}
          className="flex flex-col gap-1 rounded-[14px] border p-3.5"
          style={i === 0 && p.is_mine ? { background: "rgba(57,255,20,0.08)", borderColor: "rgba(57,255,20,0.35)" } : { background: "#12151d", borderColor: "rgba(255,255,255,0.08)" }}
        >
          <span className="text-xs text-[#9aa3b2]">
            {p.player_name} · {p.is_mine ? `your ${p.position === "DEF" ? "D/ST" : p.position}` : `${p.owner_name}'s`}
          </span>
          <b className="font-mono text-[28px]" style={{ color: p.points >= 0 ? accent : "#f87171" }}>
            {p.points >= 0 ? "+" : "−"}
            {Math.abs(p.points).toFixed(1)}
          </b>
        </div>
      ))}
      {winNow !== null && (
        <div className="flex flex-col gap-1 rounded-[14px] border border-white/[0.08] bg-[#12151d] p-3.5">
          <span className="text-xs text-[#9aa3b2]">Your win odds</span>
          <b className="font-mono text-[28px]">
            {winBefore !== null && winBefore !== winNow && (
              <>
                {Math.round(winBefore)}% <span className="text-lg text-[#9aa3b2]">→</span>{" "}
              </>
            )}
            <span style={{ color: accent }}>{Math.round(winNow)}%</span>
          </b>
        </div>
      )}
    </section>
  );
}

function ChatPanel({ feed, onSend, onReact, accent }: { feed: FeedItem[]; onSend: (body: string) => void; onReact: (k: ReactionKey) => void; accent: string }) {
  const [draft, setDraft] = useState("");
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
                <b>{item.text}</b> · <b style={{ color: accent }}>{item.points}</b> {item.team}
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
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          onSend(draft.trim());
          setDraft("");
        }}
      >
        <label className="flex">
          <span className="sr-only">Message the room</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Talk your talk…"
            className="h-11 flex-1 rounded-full border border-white/[0.1] bg-[#161a24] px-4 text-sm text-[#f3f4f6]"
          />
        </label>
      </form>
    </>
  );
}

function SweatPanel({
  week,
  myStarters,
  bets,
  winPct,
  accent,
}: {
  week: ReturnType<typeof useDelayedValue<Awaited<ReturnType<typeof loungeApi.myWeek>>>>;
  myStarters: { player_id: string | number | null; player_name: string; position: string | null; points_scored: number | null; game_status?: string | null }[];
  bets: Awaited<ReturnType<typeof loungeApi.bets>>["bets"];
  winPct: number | null;
  accent: string;
}) {
  const m = week?.matchup;
  const playing = myStarters.filter((p) => p.game_status === "in_progress");
  const open = bets.filter((b) => b.status === "open");
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      {m && (
        <div className="flex items-center justify-between rounded-[14px] border border-white/[0.08] bg-[#161a24] p-3">
          <div className="flex flex-col">
            <span className="text-xs text-[#9aa3b2]">{week?.team_name} · you</span>
            <b className="font-mono text-2xl">{fmt(m.my_score)}</b>
          </div>
          <b className="font-mono text-xl" style={{ color: accent }}>
            {winPct !== null ? `${Math.round(winPct)}%` : "—"}
          </b>
          <div className="flex flex-col items-end">
            <span className="text-xs text-[#9aa3b2]">{m.opponent_team_name}</span>
            <b className="font-mono text-2xl">{fmt(m.opponent_score)}</b>
          </div>
        </div>
      )}
      {playing.length > 0 && <span className="font-display text-[11px] font-semibold tracking-[1.2px] text-[#9aa3b2]">PLAYING NOW</span>}
      {playing.map((p) => (
        <div key={String(p.player_id ?? p.player_name)} className="flex items-center gap-2.5 rounded-xl bg-[#161a24] px-3 py-2.5">
          <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
          <div className="flex flex-1 flex-col">
            <b className="text-sm">{p.player_name}</b>
            <span className="text-xs text-[#9aa3b2]">{p.position === "DEF" ? "D/ST" : p.position}</span>
          </div>
          <b className="font-mono">{fmt(p.points_scored)}</b>
        </div>
      ))}
      {open.length > 0 && <span className="font-display text-[11px] font-semibold tracking-[1.2px] text-[#9aa3b2]">YOUR BETS</span>}
      {open.map((b) => (
        <div key={b.id} className="flex flex-col gap-2 rounded-[14px] border bg-[#161a24] p-3 text-[13px]" style={{ borderColor: "rgba(96,165,250,0.35)" }}>
          {b.legs.map((leg) => {
            const pct = leg.status === "won" ? 100 : leg.current !== null && leg.target ? Math.min(100, (leg.current / leg.target) * 100) : 0;
            const color = leg.status === "won" ? accent : leg.status === "lost" ? "#f87171" : "#93c5fd";
            return (
              <div key={leg.id} className="flex flex-col gap-1">
                <div className="flex justify-between gap-2">
                  <span className="truncate">{leg.description}</span>
                  <span className="font-mono" style={{ color }}>
                    {leg.status === "won" ? "Hit" : leg.status === "lost" ? "Missed" : leg.current !== null ? `${leg.current} / ${leg.target ?? leg.line ?? ""}` : "Live"}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[#2b2f3a]">
                  <div className="h-full" style={{ width: `${pct}%`, background: color }} />
                </div>
              </div>
            );
          })}
        </div>
      ))}
      {!m && open.length === 0 && <p className="text-sm text-[#9aa3b2]">Nothing on the line yet this week.</p>}
    </div>
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
