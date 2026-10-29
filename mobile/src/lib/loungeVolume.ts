import { useLocalParticipant, useRemoteParticipants, useTracks } from '@livekit/react-native';
import { Track } from 'livekit-client';
import { useEffect, useSyncExternalStore } from 'react';

import { personOf } from '@/lib/loungePeople';

// What you hear in the Lounge, on this phone only (the web twin is
// frontend/src/lib/loungeVolume.ts, keep the two in step). The old
// sliders were straight lines from 0 to 2x gain, but ears hear loudness
// in decibels: most of a linear slider sounds the same and all the quiet
// is crammed into the last sliver, so the game felt "either loud or
// off". Now the game has ten 3 dB steps and each person has five levels.
//
// Settings belong to the person, not the LiveKit participant, so they
// carry over to a second device, a rejoin, or a new screen share. They
// last until the app closes.

/** A mute that reads back as a mute. livekit-client treats a 0 volume
 *  as unset (getVolume says 100%, a re-attached track plays at full),
 *  so mutes were "hit or miss". −80 dB is silent. */
export const MUTED = 0.0001;

export const GAME_STEPS = 10;
/** Step 8 is the broadcast as sent (0 dB); 10 is +6 dB, 1 is −21 dB. */
export const GAME_NORMAL = 8;

export function gameGain(step: number): number {
  if (step <= 0) return MUTED;
  return 10 ** (((step - GAME_NORMAL) * 3) / 20);
}

export function gameLabel(step: number): string {
  if (step <= 0) return 'Off';
  if (step <= 3) return 'Background';
  if (step <= GAME_NORMAL) return 'Normal';
  return 'Loud';
}

export const PERSON_LEVELS = [
  { key: 'mute', label: 'Mute', gain: MUTED },
  { key: 'quiet', label: 'Quiet', gain: 0.4 },
  { key: 'normal', label: 'Normal', gain: 1 },
  { key: 'loud', label: 'Loud', gain: 1.6 },
  { key: 'boost', label: 'Boost', gain: 2.5 },
] as const;
export type PersonLevel = (typeof PERSON_LEVELS)[number]['key'];

function levelGain(level: PersonLevel | undefined): number {
  return PERSON_LEVELS.find((l) => l.key === level)?.gain ?? 1;
}

type VolumeState = { game: number; people: Record<string, PersonLevel> };

let state: VolumeState = { game: GAME_NORMAL, people: {} };
const listeners = new Set<() => void>();
function update(next: VolumeState) {
  state = next;
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useLoungeVolume(): VolumeState {
  return useSyncExternalStore(subscribe, () => state);
}

export function setGameStep(step: number) {
  update({ ...state, game: Math.max(0, Math.min(GAME_STEPS, Math.round(step))) });
}

export function setPersonLevel(person: string, level: PersonLevel) {
  update({ ...state, people: { ...state.people, [person]: level } });
}

/** Applies the settings to everyone in the room: each person's mic on
 *  all their devices, and the game on whoever shares it. Mount once
 *  per room, next to useOwnDevices (which keeps your own other devices'
 *  mics silent, so they're skipped here). */
export function useApplyLoungeVolume() {
  const { game, people } = useLoungeVolume();
  const remotes = useRemoteParticipants();
  const shares = useTracks([Track.Source.ScreenShareAudio]);
  const { localParticipant } = useLocalParticipant();
  const me = personOf(localParticipant.identity);
  const key = `${remotes.map((p) => p.identity).join(',')}|${shares.map((t) => t.participant.identity).join(',')}`;
  useEffect(() => {
    for (const p of remotes) {
      p.setVolume(gameGain(game), Track.Source.ScreenShareAudio);
      const person = personOf(p.identity);
      if (person !== me) p.setVolume(levelGain(people[person]), Track.Source.Microphone);
    }
    // remotes/shares change identity every render; `key` is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, game, people, me]);
}
