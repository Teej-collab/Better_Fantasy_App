"use client";

import { useState } from "react";
import { Track, type RemoteParticipant } from "livekit-client";
import { useRemoteParticipants, useTracks } from "@livekit/components-react";

// Per-participant playback volume — real mics vary a lot more than
// people expect (a phone mic three feet away vs. a headset an inch
// from someone's mouth), so "everyone comes in at the same level" is
// often wrong. A screen share's own audio (someone sharing the actual
// game broadcast, with its own volume) is a genuinely SEPARATE track
// from that person's mic — LiveKit tracks them as two different
// sources (real report: the mic slider had no effect on the shared
// video's sound) — so each participant gets one slider per source
// they're actually publishing, not one slider assumed to cover both.
// Confirmed against livekit-client's own RemoteParticipant.setVolume
// signature, which explicitly takes a Track.Source.Microphone |
// Track.Source.ScreenShareAudio argument for exactly this reason.
// Everything here only ever affects what YOU hear locally, never
// anyone else's actual mic/share or what they hear.
export function ParticipantVolumePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const participants = useRemoteParticipants();
  // Reactive — updates the moment someone starts/stops sharing their
  // screen with audio, unlike a one-time getTrackPublication() check
  // that would go stale the instant a share starts after this panel
  // first renders.
  const screenShareAudioTracks = useTracks([Track.Source.ScreenShareAudio]);

  if (!open) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 flex max-h-[65%] flex-col rounded-t-2xl bg-[var(--background)] shadow-2xl">
      <div className="flex items-center justify-between border-b border-black/10 px-4 py-3 dark:border-white/10">
        <span className="text-sm font-bold" style={{ color: "var(--wl-text)" }}>
          Volume
        </span>
        <button
          onClick={onClose}
          aria-label="Close volume controls"
          className="rounded-full p-1 text-black/50 hover:bg-black/5 dark:text-white/50 dark:hover:bg-white/10"
        >
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <p className="mb-3 text-xs text-black/50 dark:text-white/50">
          Adjusts what you hear from each person — only on your device, not for anyone else.
        </p>
        {participants.length === 0 ? (
          <p className="mt-8 text-center text-sm text-black/50 dark:text-white/50">No one else is in the room yet.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {participants.map((p) => {
              const isSharingAudio = screenShareAudioTracks.some((t) => t.participant.sid === p.sid);
              const label = p.name || p.identity;
              return (
                <li key={p.sid} className="flex flex-col gap-2 border-b border-black/5 pb-4 last:border-0 dark:border-white/5">
                  <ParticipantVolumeRow
                    participant={p}
                    source={Track.Source.Microphone}
                    label={label}
                    icon="🎤"
                  />
                  {isSharingAudio && (
                    <ParticipantVolumeRow
                      participant={p}
                      source={Track.Source.ScreenShareAudio}
                      label={`${label}'s shared video`}
                      icon="🖥️"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function ParticipantVolumeRow({
  participant,
  source,
  label,
  icon,
}: {
  participant: RemoteParticipant;
  source: Track.Source.Microphone | Track.Source.ScreenShareAudio;
  label: string;
  icon: string;
}) {
  // getVolume(source) returns undefined until that source's track has
  // actually arrived — 1 (100%, unchanged) is the right default to
  // show for that gap, matching setVolume's own documented "applied
  // once the track shows up" behavior.
  const [volume, setVolume] = useState(() => participant.getVolume(source) ?? 1);

  function handleChange(next: number) {
    setVolume(next);
    participant.setVolume(next, source);
  }

  return (
    <div className="flex items-center gap-3">
      <span className="flex w-24 shrink-0 items-center gap-1 truncate text-sm" style={{ color: "var(--wl-text)" }}>
        <span aria-hidden>{icon}</span>
        <span className="truncate">{label}</span>
      </span>
      <button
        onClick={() => handleChange(volume > 0 ? 0 : 1)}
        aria-label={volume > 0 ? `Mute ${label} for you` : `Unmute ${label} for you`}
        className="shrink-0 text-sm"
      >
        {volume > 0 ? "🔊" : "🔇"}
      </button>
      <input
        type="range"
        min={0}
        max={2}
        step={0.05}
        value={volume}
        onChange={(e) => handleChange(Number(e.target.value))}
        className="h-1.5 flex-1 accent-[var(--wl-accent)]"
        aria-label={`${label}'s volume, only for you`}
      />
      <span className="w-10 shrink-0 text-right text-xs tabular-nums" style={{ color: "var(--wl-text-secondary)" }}>
        {Math.round(volume * 100)}%
      </span>
    </div>
  );
}
