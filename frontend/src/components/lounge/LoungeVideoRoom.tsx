"use client";

import { useEffect, useRef, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useTracks,
  useLocalParticipant,
  VideoTrack,
  ParticipantTile,
  Chat,
  useMediaDeviceSelect,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import "@livekit/components-styles";
import { buildNflTickerItems, getNflScoreboard, type TickerItem } from "@/lib/api";
import { LiveTicker } from "@/components/LiveTicker";
import { ParticipantVolumePanel } from "@/components/watchparty/ParticipantVolumePanel";

/**
 * Custom Lounge layout — built from LiveKit's own primitives
 * (useTracks/VideoTrack/ParticipantTile/Chat) rather than the
 * prebuilt <VideoConference/> components/watchparty/WatchPartyRoom.tsx
 * uses, because this needs a specific shape VideoConference doesn't
 * offer: one big shared "TV" (whoever's screen-sharing, not a grid of
 * every camera), the app's own NFL ticker alongside it, and a real
 * chat panel rather than a toggled overlay.
 *
 * Screen sharing is still a custom toggle rather than LiveKit's own
 * built-in one for the same reason components/watchparty/
 * WatchPartyRoom.tsx's is: the built-in button never requests system/
 * tab audio (confirmed against livekit-client's own
 * createLocalScreenTracks) and is hidden app-wide by globals.css's
 * data-lk-source targeting.
 *
 * "Single TV" scope, not the full multi-game grid: if more than one
 * person shares at once, the TV shows whichever share LiveKit lists
 * first — good enough for "the host puts a game on," not yet "everyone
 * shares their own game with independently selectable audio," which is
 * a real future phase (see docs/LOUNGE_ARCHITECTURE.md), not this one.
 */
function TvScreen() {
  const screenShareTracks = useTracks([Track.Source.ScreenShare]);
  const track = screenShareTracks[0];

  if (!track) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-black px-6 text-center">
        <span className="text-4xl" aria-hidden>
          📺
        </span>
        <p className="text-sm font-semibold text-white">Nothing on the TV yet</p>
        <p className="text-xs text-white/50">Whoever's hosting can hit &ldquo;Share screen&rdquo; to put the game up.</p>
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1 bg-black">
      <VideoTrack trackRef={track} className="h-full w-full object-contain" />
    </div>
  );
}

function ParticipantStrip() {
  const cameraTracks = useTracks([Track.Source.Camera]);
  if (cameraTracks.length === 0) return null;
  return (
    <div className="flex shrink-0 gap-2 overflow-x-auto px-3 py-2">
      {cameraTracks.map((track) => (
        <div
          key={`${track.participant.identity}-${track.source}`}
          className="h-24 w-32 shrink-0 overflow-hidden rounded-lg bg-white/5"
        >
          <ParticipantTile trackRef={track} className="h-full w-full" />
        </div>
      ))}
    </div>
  );
}

// The app's own site-wide NFL ticker (AppTickerBar.tsx's own strip,
// same component/data), not a bespoke scores sidebar — replaces an
// earlier version of this room that built its own vertical scoreboard
// list, which the product owner asked to drop in favor of reusing what
// the rest of the app already has.
function NflTickerStrip() {
  const [items, setItems] = useState<TickerItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    function load() {
      getNflScoreboard()
        .then((games) => {
          if (!cancelled) setItems(buildNflTickerItems(games));
        })
        .catch(() => {
          if (!cancelled) setItems([]);
        });
    }
    load();
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!items || items.length === 0) return null;
  return (
    <div className="shrink-0 px-3 pb-2">
      <LiveTicker items={items} />
    </div>
  );
}

// Built on the raw hook rather than LiveKit's own <MediaDeviceSelect/>
// for two reasons: that component's onActiveDeviceChange fires once
// immediately on mount to report the CURRENT device (not only on a
// real selection), which was closing this menu the instant it opened;
// and it has no empty-state message, just a blank list when
// enumerateDevices() finds nothing.
function DeviceList({ kind, onSelect }: { kind: MediaDeviceKind; onSelect: () => void }) {
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind });
  if (devices.length === 0) {
    return <p className="px-1 py-1 text-white/40">No devices found</p>;
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {devices.map((d) => (
        <li key={d.deviceId}>
          <button
            onClick={() => {
              setActiveMediaDevice(d.deviceId);
              onSelect();
            }}
            className={`w-full truncate rounded px-1.5 py-1 text-left ${d.deviceId === activeDeviceId ? "bg-white/15 font-semibold" : ""}`}
          >
            {d.deviceId === activeDeviceId ? "✓ " : ""}
            {d.label || kind}
          </button>
        </li>
      ))}
    </ul>
  );
}

function ControlsBar({
  shareUrl,
  onToggleVolume,
  volumeOpen,
}: {
  shareUrl?: string;
  onToggleVolume: () => void;
  volumeOpen: boolean;
}) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant();
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);

  function copyShareUrl() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function toggleShare() {
    setShareError(null);
    try {
      await localParticipant.setScreenShareEnabled(!isScreenShareEnabled, {
        audio: true,
        // Hints Chrome to actually offer a system/tab audio source in
        // its picker — without this some browsers only surface the
        // video-only path even with audio: true set (same fix as
        // components/watchparty/WatchPartyRoom.tsx's own share button).
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

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-white/10 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
          className={`rounded-full px-3.5 py-2 text-xs font-semibold ${isMicrophoneEnabled ? "bg-white/10" : "bg-red-500"}`}
        >
          {isMicrophoneEnabled ? "🎤 Mute" : "🎤 Unmute"}
        </button>
        <button
          onClick={() => localParticipant.setCameraEnabled(!isCameraEnabled)}
          className={`rounded-full px-3.5 py-2 text-xs font-semibold ${isCameraEnabled ? "bg-white/10" : "bg-red-500"}`}
        >
          {isCameraEnabled ? "📷 Camera on" : "📷 Camera off"}
        </button>
        <button
          onClick={toggleShare}
          className={`rounded-full px-3.5 py-2 text-xs font-semibold ${isScreenShareEnabled ? "bg-red-500" : "bg-white/10"}`}
        >
          {isScreenShareEnabled ? "🖥 Stop sharing" : "🖥 Share screen"}
        </button>
        <button
          onClick={onToggleVolume}
          className={`rounded-full px-3.5 py-2 text-xs font-semibold ${volumeOpen ? "bg-white text-black" : "bg-white/10"}`}
        >
          🔊 Volume
        </button>
        <div className="relative">
          <button
            onClick={() => setDeviceMenuOpen((v) => !v)}
            className="rounded-full bg-white/10 px-3.5 py-2 text-xs font-semibold"
          >
            🎚 Devices
          </button>
          {deviceMenuOpen && (
            <div className="absolute bottom-full left-0 z-40 mb-2 max-h-[60vh] w-64 overflow-y-auto rounded-lg bg-[#0f1420] p-2 text-xs shadow-lg">
              <p className="px-1 pb-1 text-white/50">Microphone</p>
              <DeviceList kind="audioinput" onSelect={() => setDeviceMenuOpen(false)} />
              <p className="px-1 pt-2 pb-1 text-white/50">Camera</p>
              <DeviceList kind="videoinput" onSelect={() => setDeviceMenuOpen(false)} />
              <button
                onClick={() => setDeviceMenuOpen(false)}
                className="mt-2 w-full rounded-full bg-white/10 py-1.5 text-center font-semibold"
              >
                Done
              </button>
            </div>
          )}
        </div>
        {shareUrl && (
          <button onClick={copyShareUrl} className="rounded-full bg-white/10 px-3.5 py-2 text-xs font-semibold">
            {copied ? "Link copied!" : "🔗 Copy invite link"}
          </button>
        )}
      </div>
      {shareError && <p className="text-xs text-red-400">{shareError}</p>}
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
  const [connectError, setConnectError] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"none" | "chat">("none");
  const [volumeOpen, setVolumeOpen] = useState(false);
  // Distinguishes "the visitor clicked Leave" (call onLeave right away)
  // from "LiveKit dropped the connection on its own" (show why, and
  // let them decide whether to back out or rejoin) — onDisconnected
  // alone can't tell the two apart.
  const leavingRef = useRef(false);

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
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0b0f18] text-white" data-lk-theme="default">
      <LiveKitRoom
        token={token}
        serverUrl={url}
        video
        audio
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, position: "relative" }}
        onDisconnected={handleDisconnected}
        onError={(err) => setConnectError(err.message || "Couldn't connect to the video call.")}
      >
        <div
          className="flex shrink-0 items-center justify-between gap-2 px-4 py-3"
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.75rem)" }}
        >
          <span className="min-w-0 flex-1 truncate font-display text-sm font-bold">{roomName}</span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setMobilePanel((p) => (p === "chat" ? "none" : "chat"))}
              className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold lg:hidden"
            >
              💬 Chat
            </button>
            {/* Leave lives in the header, not the wrapping controls row
                below — that row already crowds several buttons onto a
                narrow phone screen, and Leave landing alone on its own
                wrapped line (via a now-removed ml-auto) looked broken
                (2026-09 reported alongside the controls-disappearing
                bug). The header never wraps or competes for that space. */}
            <button onClick={handleLeaveClick} className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold">
              Leave
            </button>
          </div>
        </div>

        <NflTickerStrip />

        <div className="flex min-h-0 flex-1">
          {/* min-h-0, not just min-w-0 — without it this flex column's
              content (specifically TvScreen's video, which can carry a
              large intrinsic size) can grow past its allotted height and
              push ControlsBar below the visible viewport once a screen
              share starts, reading as "the controls disappeared"
              (2026-09 reported, reproduced: happened to whoever was
              looking at the newly-large shared screen). */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <TvScreen />
            <ParticipantStrip />
            <ControlsBar
              shareUrl={shareUrl}
              onToggleVolume={() => setVolumeOpen((v) => !v)}
              volumeOpen={volumeOpen}
            />
          </div>

          {/* Direct <Chat/>, not wrapped in a custom flex column with our
              own header label — a prior version put a "Live Chat" label
              and a Close button as siblings before <Chat/>, and BOTH
              silently failed to render at all (confirmed via clipped
              screenshots, not just visual inspection), most likely
              LiveKit's own .lk-chat internal CSS grid (display:grid,
              align-items:end, its own fixed-height header/input rows)
              conflicting with the extra flex nesting around it. A plain
              <Chat/> sized to 100% avoids that fight entirely — see the
              mobile panel below for how Close is added without it. */}
          <aside className="hidden w-72 shrink-0 overflow-hidden border-l border-white/10 lg:flex">
            <Chat style={{ height: "100%", width: "100%", maxWidth: "100%" }} />
          </aside>
        </div>

        {/* Required when building a custom layout from LiveKit's own
            primitives instead of <VideoConference/> (which includes this
            internally) — without it, remote microphones AND screen-share
            audio are never actually played back at all, which is also
            why per-participant volume had no real effect (2026-09
            reported "no control over video volume" — there was nothing
            for that control to adjust). */}
        <RoomAudioRenderer />
        <ParticipantVolumePanel open={volumeOpen} onClose={() => setVolumeOpen(false)} />

        {mobilePanel === "chat" && (
          <div className="fixed inset-x-0 bottom-0 top-1/3 z-40 overflow-hidden rounded-t-2xl bg-[#0f1420] shadow-2xl lg:hidden">
            {/* Close as an absolutely-positioned overlay on top of <Chat/>,
                not a sibling row before it — a sibling header row here is
                exactly what silently failed to render at all (see the
                comment on the desktop aside above). This can't be pushed
                out by anything inside <Chat/>'s own layout since it isn't
                part of that flow. */}
            <button
              onClick={() => setMobilePanel("none")}
              className="absolute top-2 right-2 z-50 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold backdrop-blur"
            >
              Close
            </button>
            <Chat style={{ height: "100%", width: "100%", maxWidth: "100%" }} />
          </div>
        )}
      </LiveKitRoom>
    </div>
  );
}
