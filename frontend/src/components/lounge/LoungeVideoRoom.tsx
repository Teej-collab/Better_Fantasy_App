"use client";

import { useState } from "react";
import { LiveKitRoom, VideoConference } from "@livekit/components-react";
import "@livekit/components-styles";

/**
 * Trimmed sibling of components/watchparty/WatchPartyRoom.tsx — Lounge
 * is video-only (no chat overlay, no fantasy digest, no per-participant
 * volume panel, no screen-share-with-audio toolbar), so this is just
 * LiveKit's own prebuilt <VideoConference/> plus a leave button and an
 * invite-link copy button (anyone already in the call can pull more
 * friends in — the password still has to be shared separately, out of
 * band, same as when joining the first time).
 */
export function LoungeVideoRoom({
  roomName,
  token,
  url,
  shareUrl,
  onLeave,
}: {
  roomName: string;
  token: string;
  url: string;
  shareUrl?: string;
  onLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function copyShareUrl() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div
        className="flex items-center justify-between gap-2 px-4 py-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.75rem)" }}
      >
        <span className="font-display truncate text-sm font-bold">{roomName}</span>
        <div className="flex shrink-0 items-center gap-2">
          {shareUrl && (
            <button onClick={copyShareUrl} className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold">
              {copied ? "Link copied!" : "Copy invite link"}
            </button>
          )}
          <button onClick={onLeave} className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold">
            Leave
          </button>
        </div>
      </div>

      <LiveKitRoom
        token={token}
        serverUrl={url}
        video
        audio
        data-lk-theme="default"
        style={{ flex: 1, minHeight: 0, position: "relative" }}
        onDisconnected={onLeave}
      >
        <VideoConference />
      </LiveKitRoom>
    </div>
  );
}
