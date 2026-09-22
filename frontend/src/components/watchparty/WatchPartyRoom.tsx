"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LiveKitRoom, VideoConference, useLocalParticipant } from "@livekit/components-react";
import type { LocalParticipant } from "livekit-client";
import "@livekit/components-styles";
import { getWatchPartyToken, type ChatMember, type ChatMessage, type WatchPartyRoom as WatchPartyRoomInfo } from "@/lib/api";
import { WatchPartyChat } from "@/components/watchparty/WatchPartyChat";
import { ParticipantVolumePanel } from "@/components/watchparty/ParticipantVolumePanel";
import { LoungeNflSidebar } from "@/components/lounge/LoungeNflSidebar";

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
  // Separate from `error` above — that one only ever covers the
  // initial token fetch (shown with a plain "Close"). This covers a
  // real LiveKit connection failure or an unexpected drop *after*
  // already being connected, which gets an offer to Rejoin instead —
  // added after the same silent-failure problem Lounge's own room hit
  // (2026-09), where a bad/rejected token just bounced back to the
  // call list with no visible reason why.
  const [connectError, setConnectError] = useState<string | null>(null);
  // Mutually exclusive — all are bottom sheets over the same call, so
  // only one ever makes sense open at a time, especially on a phone.
  const [panel, setPanel] = useState<"none" | "chat" | "volume" | "scores">("none");
  const [localInfo, setLocalInfo] = useState<{ localParticipant: LocalParticipant; isScreenShareEnabled: boolean } | null>(
    null
  );
  const [shareError, setShareError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const onLocalUpdate = useCallback(
    (info: { localParticipant: LocalParticipant; isScreenShareEnabled: boolean }) => setLocalInfo(info),
    []
  );
  // Distinguishes "the visitor clicked Leave" (call onClose right away)
  // from "LiveKit dropped the connection on its own" (show connectError
  // with a Rejoin option instead) — onDisconnected alone can't tell the
  // two apart.
  const leavingRef = useRef(false);

  function handleLeaveClick() {
    leavingRef.current = true;
    onClose();
  }

  function handleDisconnected() {
    if (leavingRef.current) {
      onClose();
      return;
    }
    setConnectError((current) => current ?? "Disconnected from the call unexpectedly.");
  }

  async function submitRename() {
    if (!localInfo || !nameDraft.trim()) {
      setRenaming(false);
      return;
    }
    // A live rename, not a token re-mint/reconnect — LiveKit lets a
    // participant's own display name change in place
    // (LocalParticipant.setName), so choosing a name for this session
    // doesn't need a new backend call at all, just like Lounge's own
    // display-name choice serves the same real need (plenty of Watch
    // Party's own visitors have never set a real owners.display_name).
    await localInfo.localParticipant.setName(nameDraft.trim());
    setRenaming(false);
  }

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

  const fetchToken = useCallback(() => {
    let cancelled = false;
    setError(null);
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

  useEffect(() => fetchToken(), [fetchToken]);

  function handleRejoin() {
    setConnectError(null);
    setTokenData(null);
    leavingRef.current = false;
    fetchToken();
  }

  if (connectError) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black px-6 text-center text-white">
        <p className="text-sm text-red-400">{connectError}</p>
        <div className="flex gap-2">
          <button
            onClick={handleRejoin}
            className="rounded-full px-4 py-2 text-sm font-semibold text-white"
            style={{ background: "var(--user-accent, var(--wl-accent))" }}
          >
            Rejoin
          </button>
          <button onClick={onClose} className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold">
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div
        className="flex items-center justify-between gap-2 px-4 py-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.75rem)" }}
      >
        {renaming ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitRename();
            }}
            className="flex min-w-0 flex-1 items-center gap-1.5"
          >
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={submitRename}
              maxLength={40}
              placeholder="Your display name"
              className="min-w-0 flex-1 rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-sm text-white placeholder:text-white/40"
            />
          </form>
        ) : (
          <button
            onClick={() => {
              setNameDraft(localInfo?.localParticipant.name ?? "");
              setRenaming(true);
            }}
            className="min-w-0 flex-1 truncate text-left"
            title="Choose a display name for this room"
          >
            <span className="font-display truncate text-sm font-bold">{room.name}</span>
            {localInfo && <span className="ml-2 text-xs text-white/40">✎ {localInfo.localParticipant.name || "Set your name"}</span>}
          </button>
        )}
        <button onClick={handleLeaveClick} className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold">
          Leave
        </button>
      </div>

      {tokenData && (
        <div className="flex flex-col gap-1.5 px-4 pb-2">
          <div className="flex flex-wrap items-center gap-2">
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
            <button
              onClick={() => setPanel((p) => (p === "scores" ? "none" : "scores"))}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold ${panel === "scores" ? "bg-white text-black" : "bg-white/15"}`}
            >
              🏈 Scores
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
          onDisconnected={handleDisconnected}
          onError={(err) => setConnectError(err.message || "Couldn't connect to the video call.")}
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
          {panel === "scores" && (
            <div className="absolute inset-x-0 bottom-0 z-30 flex max-h-[65%] flex-col rounded-t-2xl bg-[var(--background)] shadow-2xl">
              <div className="flex items-center justify-between border-b border-black/10 px-4 py-3 dark:border-white/10">
                <span className="text-sm font-bold" style={{ color: "var(--wl-text)" }}>
                  NFL Scores
                </span>
                <button
                  onClick={() => setPanel("none")}
                  aria-label="Close scores"
                  className="rounded-full p-1 text-black/50 hover:bg-black/5 dark:text-white/50 dark:hover:bg-white/10"
                >
                  ✕
                </button>
              </div>
              <LoungeNflSidebar />
            </div>
          )}
        </LiveKitRoom>
      )}
    </div>
  );
}
