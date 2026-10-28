"use client";

import { useMemo, useState } from "react";
import { LiveKitRoom, RoomAudioRenderer, useLocalParticipant, useTracks, VideoTrack, type TrackReference } from "@livekit/components-react";
import { Track } from "livekit-client";
import "@livekit/components-styles";
import { LIVEKIT_ROOM_OPTIONS } from "@/lib/livekitMedia";
import { personOf } from "@/lib/loungePeople";
import { getDraftVideoToken, type DraftChatMessage, type DraftConfig, type DraftPick, type DraftPoolPlayer } from "@/lib/draftApi";

// The Board Wall (2026-10-28, mockup C, "love the C"): the draft for a
// TV, iPad or computer — the whole board, each manager's camera on top
// of their column, and a rail with who's on the clock, who's next, the
// best players left and the draft chat. Built for a league that's half
// in one room around a TV and half joining from their phones.

const POS: Record<string, string> = { QB: "#f87171", RB: "#4ade80", WR: "#38bdf8", TE: "#fb923c", K: "#c084fc", DEF: "#facc15" };
const FACES = ["#2f3a4d", "#33304a", "#2d4038", "#3d3328", "#283a44", "#3a2d3a"];
const HEX = "polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%)";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase() || "?";
}

function useCameras(): Map<string, TrackReference> {
  const tracks = useTracks([Track.Source.Camera]) as TrackReference[];
  return useMemo(() => {
    const m = new Map<string, TrackReference>();
    for (const t of tracks) {
      if (t.publication?.isMuted) continue;
      const owner = personOf(t.participant.identity);
      if (!m.has(owner) || t.participant.isLocal) m.set(owner, t);
    }
    return m;
  }, [tracks]);
}

function Cam({ ownerId, name, index, ring, cams, dim }: { ownerId: number; name: string; index: number; ring: string | null; cams: Map<string, TrackReference>; dim?: boolean }) {
  const track = cams.get(String(ownerId));
  return (
    <div className="relative aspect-[1.15] w-full" style={{ opacity: dim ? 0.45 : 1 }} aria-label={name}>
      <div className="absolute inset-0" style={{ clipPath: HEX, background: ring ?? "#2a303a" }} />
      <div className="absolute inset-[3px] flex items-center justify-center overflow-hidden" style={{ clipPath: HEX, background: FACES[index % FACES.length] }}>
        {track ? (
          <VideoTrack trackRef={track} className="h-full w-full object-cover" style={track.participant.isLocal ? { transform: "scaleX(-1)" } : undefined} />
        ) : (
          <span className="font-[Oswald,sans-serif] text-[clamp(14px,1.6vw,26px)] text-[#dfe4ea]">{initials(name)}</span>
        )}
      </div>
    </div>
  );
}

function MyControls({ onLeave }: { onLeave: () => void }) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const btn = "min-h-11 rounded-full border border-[#2a303a] bg-[#12161c] px-4 text-sm font-semibold";
  return (
    <div className="flex gap-2">
      <button className={btn} onClick={() => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}>
        {isMicrophoneEnabled ? "Mic on" : "Muted"}
      </button>
      <button className={btn} onClick={() => void localParticipant.setCameraEnabled(!isCameraEnabled)}>
        {isCameraEnabled ? "Cam on" : "Cam off"}
      </button>
      <button className={`${btn} text-red-400`} onClick={onLeave}>
        Leave cameras
      </button>
    </div>
  );
}

type Props = {
  config: DraftConfig;
  picks: DraftPick[];
  connectedOwnerIds: Set<number>;
  chatMessages: DraftChatMessage[];
  onSendChat: (text: string) => boolean;
  bestAvailable: DraftPoolPlayer[];
  nameByOwner: Map<number, string>;
  myOwnerId: number;
  secondsRemaining: number;
  isAuction: boolean;
  leagueLine: string;
  onClose: () => void;
};

export function BoardWall(props: Props) {
  const [creds, setCreds] = useState<{ token: string; url: string } | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  async function join() {
    setJoinError(null);
    try {
      const { token, url } = await getDraftVideoToken();
      setCreds({ token, url });
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : "Couldn't join the cameras");
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-[#0d1016] text-[#eceef1]" role="dialog" aria-label="Draft board wall">
      <LiveKitRoom
        serverUrl={creds?.url}
        token={creds?.token}
        connect={creds !== null}
        audio={creds !== null}
        video={creds !== null}
        options={LIVEKIT_ROOM_OPTIONS}
        onError={(e) => setJoinError(e.message)}
        className="contents"
      >
        <RoomAudioRenderer />
        <Wall {...props} joined={creds !== null} onJoin={() => void join()} onLeave={() => setCreds(null)} joinError={joinError} />
      </LiveKitRoom>
    </div>
  );
}

function Wall({
  config,
  picks,
  connectedOwnerIds,
  chatMessages,
  onSendChat,
  bestAvailable,
  nameByOwner,
  myOwnerId,
  secondsRemaining,
  isAuction,
  leagueLine,
  onClose,
  joined,
  onJoin,
  onLeave,
  joinError,
}: Props & { joined: boolean; onJoin: () => void; onLeave: () => void; joinError: string | null }) {
  const cams = useCameras();
  const [message, setMessage] = useState("");
  const order = config.draft_order;
  const teams = order.length;
  const live = config.status === "in_progress" || config.status === "paused";
  const current = picks.find((p) => p.pick_number === config.current_pick_number);
  const clockOwner = live && !isAuction ? current?.owner_id ?? null : null;
  const linear = config.draft_type === "linear";
  const name = (o: number) => (o === myOwnerId ? "You" : nameByOwner.get(o) ?? picks.find((p) => p.owner_id === o)?.owner_name ?? "Team");
  const upNext = picks
    .filter((p) => p.pick_number > config.current_pick_number && !p.sleeper_player_id)
    .sort((a, b) => a.pick_number - b.pick_number)
    .slice(0, 3);

  // Picks by round, laid out in each owner's original column; a traded
  // pick sits in the column of the slot it came from.
  const rounds = useMemo(() => {
    const byRound = new Map<number, DraftPick[]>();
    for (const p of picks) byRound.set(p.round, [...(byRound.get(p.round) ?? []), p]);
    return [...byRound.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([round, list]) => {
        const cells: (DraftPick | null)[] = Array(teams).fill(null);
        for (const p of list) {
          const col = linear || round % 2 === 1 ? p.round_pick - 1 : teams - p.round_pick;
          if (col >= 0 && col < teams) cells[col] = p;
        }
        return { round, cells, forward: linear || round % 2 === 1 };
      });
  }, [picks, teams, linear]);

  const btn = "min-h-11 rounded-full border border-[#2a303a] bg-[#12161c] px-4 text-sm font-semibold";
  const clockName = clockOwner !== null ? name(clockOwner) : null;

  return (
    <div className="flex min-h-full flex-col gap-3 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-[Oswald,sans-serif] text-2xl font-bold tracking-wide">DRAFT NIGHT</h1>
        <span className="text-sm text-[#8790a0]">{leagueLine}</span>
        <span className="ml-auto flex items-center gap-2 rounded-full border border-[#39ff14]/40 px-3 py-1.5 text-sm font-bold text-[#39ff14]">
          <span className="h-2 w-2 rounded-full bg-[#39ff14]" aria-hidden />
          {order.filter((o) => connectedOwnerIds.has(o)).length} of {teams} in the room
        </span>
        {joined ? (
          <MyControls onLeave={onLeave} />
        ) : (
          <button className={`${btn} border-[#39ff14] bg-[#39ff14] text-[#0d1016]`} onClick={onJoin}>
            Join on camera
          </button>
        )}
        <button className={btn} onClick={() => void document.documentElement.requestFullscreen?.().catch(() => {})}>
          Full screen
        </button>
        <button className={btn} onClick={onClose}>
          Close
        </button>
      </div>
      {joinError && <p className="text-sm text-red-400">{joinError}</p>}

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1 overflow-x-auto">
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `44px repeat(${teams}, minmax(84px, 1fr))`, minWidth: 44 + teams * 90 }}>
            <span />
            {order.map((o, i) => {
              const ring = o === clockOwner ? "#39ff14" : o === myOwnerId ? "#4cc3ff" : null;
              return (
                <div key={o} className="flex flex-col items-center gap-1">
                  <Cam ownerId={o} name={name(o)} index={i} ring={ring} cams={cams} dim={!connectedOwnerIds.has(o) && o !== myOwnerId} />
                  <span className="max-w-full truncate text-xs font-bold" style={{ color: ring ?? "#aeb5c1" }}>
                    {name(o)}
                  </span>
                </div>
              );
            })}
            {rounds.map(({ round, cells, forward }) => (
              <div key={round} className="contents">
                <span className="flex flex-col items-center justify-center font-[Oswald,sans-serif] text-sm text-[#8790a0]" aria-label={`Round ${round}, ${forward ? "left to right" : "right to left"}`}>
                  R{round}
                  <span aria-hidden>{forward ? "→" : "←"}</span>
                </span>
                {cells.map((p, i) => {
                  if (!p) return <div key={i} className="min-h-[58px] rounded-lg border border-[#1c2027] bg-[#11151b]" />;
                  const color = p.player_position ? POS[p.player_position] ?? "#9ca3af" : null;
                  const isClock = p.pick_number === config.current_pick_number && live;
                  const mine = p.owner_id === myOwnerId && !p.sleeper_player_id;
                  return (
                    <div
                      key={i}
                      className="flex min-h-[58px] min-w-0 flex-col justify-between overflow-hidden rounded-lg border px-1.5 py-1"
                      style={{
                        background: color ? `${color}1f` : isClock ? "rgba(57,255,20,0.10)" : mine ? "rgba(76,195,255,0.08)" : "#11151b",
                        borderColor: color ? `${color}55` : isClock ? "#39ff14" : mine ? "rgba(76,195,255,0.5)" : "#1c2027",
                      }}
                    >
                      <span className="text-[10px] font-bold" style={{ color: isClock ? "#39ff14" : mine ? "#4cc3ff" : "#8790a0" }}>
                        {p.round}.{String(p.round_pick).padStart(2, "0")}
                        {p.owner_id !== order[i] ? ` · ${name(p.owner_id)}` : ""}
                      </span>
                      <span className="truncate text-xs font-bold leading-tight">
                        {p.player_name ?? (isClock ? "ON THE CLOCK" : mine ? "Your pick" : "")}
                      </span>
                      <span className="text-[10px] font-bold" style={{ color: color ?? "#39ff14" }}>
                        {p.player_position === "DEF" ? "D/ST" : p.player_position ?? (isClock ? `${secondsRemaining}s` : "")}
                        {p.is_keeper ? " · K" : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-[300px]">
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-[#39ff14] bg-[#12161c] p-4 text-center">
            <span className="text-xs font-extrabold tracking-[0.14em] text-[#39ff14]">
              {config.status === "complete" ? "DRAFT COMPLETE" : config.status === "paused" ? "PAUSED" : clockName ? `ON THE CLOCK · ${current?.round}.${String(current?.round_pick).padStart(2, "0")}` : "NOT STARTED"}
            </span>
            {clockOwner !== null && (
              <div className="relative w-[220px]">
                <Cam ownerId={clockOwner} name={clockName ?? ""} index={order.indexOf(clockOwner)} ring="#39ff14" cams={cams} />
                <span className={`absolute bottom-1 right-1 rounded-lg px-2 font-[Oswald,sans-serif] text-2xl font-bold text-[#0d1016] ${secondsRemaining <= 10 ? "bg-red-400" : "bg-[#39ff14]"}`}>
                  {Math.floor(secondsRemaining / 60)}:{String(secondsRemaining % 60).padStart(2, "0")}
                </span>
              </div>
            )}
            {clockName && <span className="font-[Oswald,sans-serif] text-2xl font-bold uppercase">{clockName}</span>}
            {upNext.length > 0 && <span className="text-sm text-[#aeb5c1]">Then: {upNext.map((p) => name(p.owner_id)).join(" · ")}</span>}
          </div>

          {bestAvailable.length > 0 && (
            <div className="flex flex-col gap-2 rounded-2xl border border-[#1c2027] bg-[#12161c] p-3">
              <span className="text-xs font-extrabold tracking-[0.12em] text-[#8790a0]">BEST STILL ON THE BOARD</span>
              {bestAvailable.map((p) => (
                <div key={p.sleeper_player_id} className="flex justify-between gap-2 text-sm">
                  <span className="truncate">
                    {p.full_name}{" "}
                    <span className="font-bold" style={{ color: POS[p.position] ?? "#9ca3af" }}>
                      {p.position === "DEF" ? "D/ST" : p.position}
                    </span>
                  </span>
                  {p.adp != null && <span className="text-[#8790a0]">ADP {Math.round(p.adp)}</span>}
                </div>
              ))}
            </div>
          )}

          <div className="flex min-h-[220px] flex-1 flex-col gap-2 rounded-2xl border border-[#1c2027] bg-[#12161c] p-3">
            <span className="text-xs font-extrabold tracking-[0.12em] text-[#8790a0]">DRAFT CHAT</span>
            <div className="flex max-h-[40vh] flex-1 flex-col gap-1.5 overflow-y-auto text-sm">
              {chatMessages.slice(-40).map((m) => (
                <p key={m.id}>
                  <b style={{ color: m.owner_id === myOwnerId ? "#4cc3ff" : "#fb923c" }}>{m.owner_id === myOwnerId ? "You" : m.owner_name}</b> {m.text}
                </p>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (message.trim() && onSendChat(message.trim())) setMessage("");
              }}
            >
              <label className="sr-only" htmlFor="wall-chat">
                Message
              </label>
              <input
                id="wall-chat"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Talk your trash"
                className="min-h-11 flex-1 rounded-xl border border-[#2a303a] bg-[#0d1016] px-3 text-sm"
              />
            </form>
          </div>
        </aside>
      </div>
    </div>
  );
}
