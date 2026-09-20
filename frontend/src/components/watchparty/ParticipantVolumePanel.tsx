"use client";

import { useState } from "react";
import type { RemoteParticipant } from "livekit-client";
import { useRemoteParticipants } from "@livekit/components-react";

// Per-participant playback volume — real mics vary a lot more than
// people expect (a phone mic three feet away vs. a headset an inch
// from someone's mouth), so "everyone comes in at the same level" is
// often wrong. This only ever affects what YOU hear locally
// (RemoteParticipant.setVolume — a client-side gain on the incoming
// audio element, confirmed against livekit-client's own type
// definitions), never anyone else's actual mic or what they hear —
// there's no server-side concept of "muted for the room" here.
export function ParticipantVolumePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const participants = useRemoteParticipants();

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
            {participants.map((p) => (
              <ParticipantVolumeRow key={p.sid} participant={p} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ParticipantVolumeRow({ participant }: { participant: RemoteParticipant }) {
  // getVolume() returns undefined until a mic track has actually
  // arrived for this participant — 1 (100%, unchanged) is the right
  // default to show for that gap, matching setVolume's own documented
  // "applied once the track shows up" behavior.
  const [volume, setVolume] = useState(() => participant.getVolume() ?? 1);

  function handleChange(next: number) {
    setVolume(next);
    participant.setVolume(next);
  }

  const label = participant.name || participant.identity;

  return (
    <li className="flex items-center gap-3">
      <span className="w-24 shrink-0 truncate text-sm" style={{ color: "var(--wl-text)" }}>
        {label}
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
    </li>
  );
}
