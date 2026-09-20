"use client";

import { useCallback, useEffect, useState } from "react";
import { LiveKitRoom, VideoConference, useLocalParticipant } from "@livekit/components-react";
import type { LocalParticipant } from "livekit-client";
import "@livekit/components-styles";
import { getWatchPartyToken, type ChatMember, type ChatMessage, type WatchPartyRoom as WatchPartyRoomInfo } from "@/lib/api";
import { WatchPartyChat } from "@/components/watchparty/WatchPartyChat";
import { ParticipantVolumePanel } from "@/components/watchparty/ParticipantVolumePanel";

// Bridges the local participant out of <LiveKitRoom>'s context (where
// the room-share button needs to live, since only useLocalParticipant
// can toggle a share with audio) up to the toolbar row above it, which
// sits outside that context in the DOM for layout reasons (LiveKitRoom
// is flex:1 within an outer flex column — a normal-flow sibling before
// it would break VideoConference's own height:100% sizing). Renders
// nothing itself.
function LocalParticipantBridge({
  onUpdate,
}: {
  onUpdate: (info: { localParticipant: LocalParticipant; isScreenShareEnabled: boolean }) => void;
}) {
  const { localParticipant, isScreenShareEnabled } = useLocalParticipant();
  useEffect(() => {
    onUpdate({ localParticipant, isScreenShareEnabled });
  }, [localParticipant, isScreenShareEnabled, onUpdate]);
  return null;
}

// Phase 1 of the approved Watch Party plan (confirmed working on real
// devices): LiveKit's own prebuilt <VideoConference/> — mic/camera
// controls, tile grid, screen share — is deliberately used as-is here
// rather than rebuilt from useTracks/useParticipants primitives, since
// a battle-tested call UI was the right thing to validate the actual
// media path against first. Phase 3 adds the room's own chat panel and
// per-participant volume — both as custom overlays alongside
// <VideoConference>, not inside it, since the prebuilt component
// doesn't expose slots for extra per-tile UI (true
// click-a-tile-to-adjust-their-volume needs the fully custom tile grid
// still on the roadmap; a dedicated panel gets to the same outcome
// sooner). Both get their own clearly-labeled toolbar row (not small
// unlabeled icons in the top corner, which real usage found too easy
// to miss next to LiveKit's own controls).
//
// FantasyTicker (Phase 2's fantasy digest overlay) is deliberately not
// rendered right now — real usage found it landing dead center over
// faces on a real call. Pulled out rather than left half-broken;
// bringing it back needs a real repositioning pass, not a quick patch.
//
// LiveKit's own built-in screen-share button (in VideoConference's
// control bar) never requests audio — confirmed against
// livekit-client's own createLocalScreenTracks, which only captures
// audio when explicitly called with {audio: true}, and ControlBar has
// no prop to pass that through. Real report: someone shared their
// screen to watch the game and its sound reached everyone only by
// bleeding into the sharer's own mic, uncontrollable separately from
// their voice. globals.css hides that broken button (targeting the
// data-lk-source="screen_share" attribute LiveKit itself sets) and
// this file's own "Share w/ Audio" button below replaces it, calling
// setScreenShareEnabled with audio explicitly requested.
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
  const [localInfo, setLocalInfo] = useState<{ localParticipant: LocalParticipant; isScreenShareEnabled: boolean } | null>(
    null
  );
  const [shareError, setShareError] = useState<string | null>(null);
  const onLocalUpdate = useCallback(
    (info: { localParticipant: LocalParticipant; isScreenShareEnabled: boolean }) => setLocalInfo(info),
    []
  );

  async function toggleShare() {
    if (!localInfo) return;
    setShareError(null);
    try {
      await localInfo.localParticipant.setScreenShareEnabled(!localInfo.isScreenShareEnabled, {
        audio: true,
        // Hints Chrome to actually offer a system/tab audio source in
        // its picker — without this some browsers only surface the
        // video-only path even with audio: true set.
        systemAudio: "include",
      });
    } catch (e) {
      // A cancelled picker is a normal, expected outcome (someone
      // opened the dialog and backed out) — still surfaced, briefly,
      // since a real permission/device error looks identical from here
      // and shouldn't fail silently.
      setShareError(e instanceof Error ? e.message : "Couldn't start sharing.");
    }
  }

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
        <button onClick={onClose} className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold">
          Leave
        </button>
      </div>

      {tokenData && (
        <div className="flex flex-col gap-1.5 px-4 pb-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPanel((p) => (p === "volume" ? "none" : "volume"))}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold ${panel === "volume" ? "bg-white text-black" : "bg-white/15"}`}
            >
              🔊 Volume
            </button>
            <button
              onClick={() => setPanel((p) => (p === "chat" ? "none" : "chat"))}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold ${panel === "chat" ? "bg-white text-black" : "bg-white/15"}`}
            >
              💬 Chat
            </button>
            {localInfo && (
              <button
                onClick={toggleShare}
                className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold ${localInfo.isScreenShareEnabled ? "bg-red-500" : "bg-white/15"}`}
              >
                🖥️ {localInfo.isScreenShareEnabled ? "Stop Sharing" : "Share w/ Audio"}
              </button>
            )}
          </div>
          {shareError && <p className="text-xs text-red-400">{shareError}</p>}
        </div>
      )}

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
        <LiveKitRoom
          token={tokenData.token}
          serverUrl={tokenData.url}
          video
          audio
          data-lk-theme="default"
          style={{ flex: 1, minHeight: 0, position: "relative" }}
          onDisconnected={onClose}
        >
          <LocalParticipantBridge onUpdate={onLocalUpdate} />
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
      )}
    </div>
  );
}
