"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LiveKitRoom } from "@livekit/components-react";
import { LIVEKIT_ROOM_OPTIONS } from "@/lib/livekitMedia";
import "@livekit/components-styles";
import { getWatchPartyToken, type ChatMember, type ChatMessage, type WatchPartyRoom as WatchPartyRoomInfo } from "@/lib/api";
import { WebLoungeRoom } from "@/components/lounge/WebLoungeRoom";

// A Watch Party's video call (League Lounge included), opened from Chat.
// This owns joining — the LiveKit token, and what happens if the call
// drops — and hands the room itself to WebLoungeRoom.tsx: the TV, both
// tickers, the gamecast of the TV's game on the room's delay, camera
// tiles, and the Chat / My Sweat / Plays panel (the Lounge mockups).
//
// The room's chat is still the league conversation Chat already loads,
// so its messages and send come in from ChatApp.tsx. Sharing a screen
// (with the game's audio) and per-person volume live in WebLoungeRoom.
export function WatchPartyRoom({
  room,
  onClose,
  messages,
  myOwnerId,
  onSend,
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
  // Separate from `error` — that one covers the initial token fetch.
  // This covers the call failing or dropping after it connected, which
  // gets an offer to Rejoin instead.
  const [connectError, setConnectError] = useState<string | null>(null);
  // Distinguishes "the visitor clicked Leave" from "LiveKit dropped the
  // connection on its own" — onDisconnected alone can't tell them apart.
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

  const fetchToken = useCallback(() => {
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

  useEffect(() => fetchToken(), [fetchToken]);

  function handleRejoin() {
    setConnectError(null);
    setError(null);
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
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0b0d14] text-white">
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
          options={LIVEKIT_ROOM_OPTIONS}
          data-lk-theme="default"
          style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }}
          onDisconnected={handleDisconnected}
          onError={(err) => setConnectError(err.message || "Couldn't connect to the video call.")}
        >
          <WebLoungeRoom room={room} messages={messages} myOwnerId={myOwnerId} onSend={onSend} onLeave={handleLeaveClick} />
        </LiveKitRoom>
      )}
    </div>
  );
}
