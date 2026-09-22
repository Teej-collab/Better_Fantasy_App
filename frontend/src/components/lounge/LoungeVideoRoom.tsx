"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LiveKitRoom, VideoConference, useLocalParticipant } from "@livekit/components-react";
import type { LocalParticipant } from "livekit-client";
import "@livekit/components-styles";
import { buildNflTickerItems, getNflScoreboard, type TickerItem } from "@/lib/api";
import { LiveTicker } from "@/components/LiveTicker";

/**
 * Trimmed sibling of components/watchparty/WatchPartyRoom.tsx — Lounge
 * is video-only (no chat overlay, no fantasy digest, no per-participant
 * volume panel), so this is LiveKit's own prebuilt <VideoConference/>
 * plus a leave button, an invite-link copy button, a screen-share
 * toggle, and a slim NFL score strip.
 *
 * Screen share is custom rather than VideoConference's own built-in
 * button for the exact reason WatchPartyRoom.tsx's is: that built-in
 * button is hidden globally by globals.css's data-lk-source targeting
 * (it never requests system/tab audio, confirmed against
 * livekit-client's own createLocalScreenTracks — see that file's
 * comment) and this app never wanted a silent screen-share-with-no-
 * sound. LocalParticipantBridge exists to get the local participant
 * out of <LiveKitRoom>'s own React context, since the toggle button
 * lives in the header row above it, outside that context.
 *
 * The NFL strip is deliberately its own row between the header and the
 * video area, never floating over the tile grid — Watch Party's own
 * FantasyTicker overlay was pulled after real usage found it landing
 * dead center over faces (see watchparty/WatchPartyRoom.tsx's
 * comment); this avoids that mistake by taking its own space instead
 * of overlapping anything.
 *
 * onError/unexpected-onDisconnected surface real LiveKit failures (bad
 * token, connection rejected, camera/mic permission denial, etc.)
 * directly on screen — added after a live test silently bounced back
 * to the join form with no visible reason why, which looked like the
 * whole feature doing nothing rather than a specific, diagnosable
 * failure.
 */
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

function NflScoreStrip() {
  const [items, setItems] = useState<TickerItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getNflScoreboard()
      .then((games) => {
        if (!cancelled) setItems(buildNflTickerItems(games));
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!items || items.length === 0) return null;
  return (
    <div className="px-2 pb-2">
      <LiveTicker items={items} />
    </div>
  );
}

export function LoungeVideoRoom({
  roomName,
  token,
  url,
  shareUrl,
  onLeave,
  onRejoin,
}: {
  roomName: string;
  token: string;
  url: string;
  shareUrl?: string;
  onLeave: () => void;
  onRejoin?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [localInfo, setLocalInfo] = useState<{ localParticipant: LocalParticipant; isScreenShareEnabled: boolean } | null>(
    null
  );
  const [shareError, setShareError] = useState<string | null>(null);
  const onLocalUpdate = useCallback(
    (info: { localParticipant: LocalParticipant; isScreenShareEnabled: boolean }) => setLocalInfo(info),
    []
  );
  // Distinguishes "the visitor clicked Leave" (call onLeave right away)
  // from "LiveKit dropped the connection on its own" (show why, and
  // let them decide whether to back out or rejoin) — onDisconnected
  // alone can't tell the two apart.
  const leavingRef = useRef(false);

  function copyShareUrl() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
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

  function handleLeaveClick() {
    leavingRef.current = true;
    onLeave();
  }

  function handleDisconnected() {
    if (leavingRef.current) {
      onLeave();
      return;
    }
    setConnectError((current) => current ?? "Disconnected from the call unexpectedly.");
  }

  if (connectError) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black px-6 text-center text-white">
        <p className="text-sm text-red-400">{connectError}</p>
        <div className="flex gap-2">
          {onRejoin && (
            <button
              onClick={() => {
                setConnectError(null);
                onRejoin();
              }}
              className="rounded-full px-4 py-2 text-sm font-semibold text-white"
              style={{ background: "var(--user-accent, var(--wl-accent))" }}
            >
              Rejoin
            </button>
          )}
          <button onClick={onLeave} className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold">
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
        <span className="font-display truncate text-sm font-bold">{roomName}</span>
        <div className="flex shrink-0 items-center gap-2">
          {shareUrl && (
            <button onClick={copyShareUrl} className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold">
              {copied ? "Link copied!" : "Copy invite link"}
            </button>
          )}
          {localInfo && (
            <button
              onClick={toggleShare}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${localInfo.isScreenShareEnabled ? "bg-red-500" : "bg-white/10"}`}
            >
              {localInfo.isScreenShareEnabled ? "Stop sharing" : "Share screen"}
            </button>
          )}
          <button onClick={handleLeaveClick} className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold">
            Leave
          </button>
        </div>
      </div>

      {shareError && <p className="px-4 pb-1 text-xs text-red-400">{shareError}</p>}

      <NflScoreStrip />

      <LiveKitRoom
        token={token}
        serverUrl={url}
        video
        audio
        data-lk-theme="default"
        style={{ flex: 1, minHeight: 0, position: "relative" }}
        onDisconnected={handleDisconnected}
        onError={(err) => setConnectError(err.message || "Couldn't connect to the video call.")}
      >
        <LocalParticipantBridge onUpdate={onLocalUpdate} />
        <VideoConference />
      </LiveKitRoom>
    </div>
  );
}
