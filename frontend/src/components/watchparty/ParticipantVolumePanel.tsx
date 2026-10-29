"use client";

import { Track } from "livekit-client";
import { useLocalParticipant, useRemoteParticipants, useTracks } from "@livekit/components-react";
import { GameVolume } from "@/components/lounge/GameVolume";
import { personOf } from "@/lib/loungePeople";
import { PERSON_LEVELS, setPersonLevel, useLoungeVolume } from "@/lib/loungeVolume";

// The Lounge's sound board: the game, then a level for each person.
// Real mics vary a lot (a phone three feet away vs. a headset an inch
// from someone's mouth), so each person gets Mute / Quiet / Normal /
// Loud / Boost, applied to every device they're on. The game is the
// shared broadcast's own track, a separate source from the sharer's mic.
// lib/loungeVolume.ts applies all of it; only what YOU hear changes.
export function ParticipantVolumePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const participants = useRemoteParticipants();
  const sharing = useTracks([Track.Source.ScreenShareAudio]).length > 0;
  const { localParticipant } = useLocalParticipant();
  const { people } = useLoungeVolume();
  const me = personOf(localParticipant.identity);

  // One row per person, whatever number of devices they're on.
  const persons = new Map<string, string>();
  for (const p of participants) {
    const person = personOf(p.identity);
    if (person !== me && !persons.has(person)) persons.set(person, p.name || p.identity);
  }

  if (!open) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 flex max-h-[70%] flex-col rounded-t-2xl bg-[var(--background)] shadow-2xl">
      <div className="flex items-center justify-between border-b border-black/10 px-4 py-3 dark:border-white/10">
        <span className="text-sm font-bold" style={{ color: "var(--wl-text)" }}>
          Sound board
        </span>
        <button
          onClick={onClose}
          aria-label="Close the sound board"
          className="rounded-full p-1 text-black/50 hover:bg-black/5 dark:text-white/50 dark:hover:bg-white/10"
        >
          ✕
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
        <p className="text-xs text-black/50 dark:text-white/50">Only changes what you hear, on this device.</p>
        {sharing && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold tracking-wider uppercase" style={{ color: "var(--wl-text-secondary)" }}>
              The game
            </span>
            <GameVolume accent="var(--wl-accent)" className="self-start" />
          </div>
        )}
        {persons.size === 0 ? (
          <p className="mt-6 text-center text-sm text-black/50 dark:text-white/50">No one else is in the room yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {[...persons].map(([person, name]) => {
              const level = people[person] ?? "normal";
              return (
                <li key={person} className="flex flex-col gap-2 border-b border-black/5 pb-3 last:border-0 dark:border-white/5">
                  <span className="text-sm font-semibold wrap-break-word" style={{ color: "var(--wl-text)" }}>
                    {name}
                  </span>
                  <div role="radiogroup" aria-label={`${name}'s volume, only for you`} className="flex gap-1">
                    {PERSON_LEVELS.map((l) => (
                      <button
                        key={l.key}
                        role="radio"
                        aria-checked={level === l.key}
                        onClick={() => setPersonLevel(person, l.key)}
                        className="h-9 min-w-0 flex-1 rounded-lg text-xs font-bold"
                        style={
                          level === l.key
                            ? { background: "var(--wl-accent)", color: "#06110a" }
                            : { background: "rgba(127,127,127,0.14)", color: "var(--wl-text-secondary)" }
                        }
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
