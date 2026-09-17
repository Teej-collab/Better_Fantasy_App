"use client";

import { useEffect, useState } from "react";
import { LiveKitRoom, VideoConference } from "@livekit/components-react";
import "@livekit/components-styles";
import { getWatchPartyToken, type WatchPartyRoom as WatchPartyRoomInfo } from "@/lib/api";
import { FantasyTicker } from "@/components/watchparty/FantasyTicker";

// Phase 1 of the approved Watch Party plan (confirmed working on real
// devices): LiveKit's own prebuilt <VideoConference/> — mic/camera
// controls, tile grid, screen share — is deliberately used as-is here
// rather than rebuilt from useTracks/useParticipants primitives, since
// a battle-tested call UI was the right thing to validate the actual
// media path against first. Phase 2 (this pass) layers the live
// fantasy digest (FantasyTicker) on top via its own WebSocket — the
// fully custom tile grid from the original mockup is still a later
// phase, once there's a real reason to move off the prebuilt one.
export function WatchPartyRoom({ room, onClose }: { room: WatchPartyRoomInfo; onClose: () => void }) {
  const [tokenData, setTokenData] = useState<{ token: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        className="flex items-center justify-between px-4 py-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.75rem)" }}
      >
        <span className="font-display truncate text-sm font-bold">{room.name}</span>
        <button onClick={onClose} className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold">
          Leave
        </button>
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
            style={{ flex: 1, minHeight: 0 }}
            onDisconnected={onClose}
          >
            <VideoConference />
          </LiveKitRoom>
        </>
      )}
    </div>
  );
}
