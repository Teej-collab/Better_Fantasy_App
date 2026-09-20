"use client";

import { useEffect, useState } from "react";
import { LiveKitRoom, VideoConference } from "@livekit/components-react";
import "@livekit/components-styles";
import { getWatchPartyToken, type ChatMember, type ChatMessage, type WatchPartyRoom as WatchPartyRoomInfo } from "@/lib/api";
import { FantasyTicker } from "@/components/watchparty/FantasyTicker";
import { WatchPartyChat } from "@/components/watchparty/WatchPartyChat";
import { ParticipantVolumePanel } from "@/components/watchparty/ParticipantVolumePanel";

// Phase 1 of the approved Watch Party plan (confirmed working on real
// devices): LiveKit's own prebuilt <VideoConference/> — mic/camera
// controls, tile grid, screen share — is deliberately used as-is here
// rather than rebuilt from useTracks/useParticipants primitives, since
// a battle-tested call UI was the right thing to validate the actual
// media path against first. Phase 2 layered the live fantasy digest
// (FantasyTicker) on top via its own WebSocket. Phase 3 (this pass)
// adds the room's own chat panel and per-participant volume — both as
// custom overlays alongside <VideoConference>, not inside it, since
// the prebuilt component doesn't expose slots for extra per-tile UI
// (true click-a-tile-to-adjust-their-volume needs the fully custom
// tile grid still on the roadmap; a dedicated panel gets to the same
// outcome sooner).
export function WatchPartyRoom({
  room,
  onClose,
  messages,
  members,
  myOwnerId,
  connected,
  typingUsers,
  aiNoticeSeen,
  onAiNoticeResolved,
  onSend,
  onReact,
  onDelete,
  onTyping,
}: {
  room: WatchPartyRoomInfo;
  onClose: () => void;
  messages: ChatMessage[];
  members: ChatMember[];
  myOwnerId: number;
  connected: boolean;
  typingUsers: { owner_id: number; owner_name: string }[];
  aiNoticeSeen: boolean;
  onAiNoticeResolved: (optOut: boolean) => void;
  onSend: (body: string, mentions: number[], replyToId: number | null, imageUrl: string | null) => void;
  onReact: (messageId: number, emoji: string) => void;
  onDelete: (messageId: number) => void;
  onTyping: () => void;
}) {
  const [tokenData, setTokenData] = useState<{ token: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Mutually exclusive — both are bottom sheets over the same call, so
  // only one ever makes sense open at a time, especially on a phone.
  const [panel, setPanel] = useState<"none" | "chat" | "volume">("none");

  useEffect(() => {
    let cancelled = false;
    getWatchPartyToken(room.id)
      .then((data) => {
        if (!cancelled) setTokenData(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't join this room.");
      });
    return () => {
      cancelled = true;
    };
  }, [room.id]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div
        className="flex items-center justify-between gap-2 px-4 py-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.75rem)" }}
      >
        <span className="font-display truncate text-sm font-bold">{room.name}</span>
        <div className="flex shrink-0 items-center gap-2">
          {tokenData && (
            <>
              <button
                onClick={() => setPanel((p) => (p === "volume" ? "none" : "volume"))}
                aria-label="Volume controls"
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${panel === "volume" ? "bg-white text-black" : "bg-white/10"}`}
              >
                🔊
              </button>
              <button
                onClick={() => setPanel((p) => (p === "chat" ? "none" : "chat"))}
                aria-label="Room chat"
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${panel === "chat" ? "bg-white text-black" : "bg-white/10"}`}
              >
                💬
              </button>
            </>
          )}
          <button onClick={onClose} className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold">
            Leave
          </button>
        </div>
      </div>

      {error && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={onClose} className="rounded-full bg-white/10 px-4 py-2 text-sm">
            Close
          </button>
        </div>
      )}

      {!error && !tokenData && (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-white/60">Connecting…</p>
        </div>
      )}

      {tokenData && (
        <>
          <FantasyTicker roomId={room.id} />
          <LiveKitRoom
            token={tokenData.token}
            serverUrl={tokenData.url}
            video
            audio
            data-lk-theme="default"
            style={{ flex: 1, minHeight: 0, position: "relative" }}
            onDisconnected={onClose}
          >
            <VideoConference />
            <WatchPartyChat
              open={panel === "chat"}
              onClose={() => setPanel("none")}
              messages={messages}
              members={members}
              myOwnerId={myOwnerId}
              typingUsers={typingUsers}
              connected={connected}
              aiNoticeSeen={aiNoticeSeen}
              onAiNoticeResolved={onAiNoticeResolved}
              onSend={onSend}
              onReact={onReact}
              onDelete={onDelete}
              onTyping={onTyping}
            />
            <ParticipantVolumePanel open={panel === "volume"} onClose={() => setPanel("none")} />
          </LiveKitRoom>
        </>
      )}
    </div>
  );
}
