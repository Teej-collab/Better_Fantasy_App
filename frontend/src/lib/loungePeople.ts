"use client";

// One person can be in a room from more than one device (the game
// streaming from a PC, watching along on a phone). Each device joins
// with its own LiveKit identity, "<person>#<device tag>": the backend
// (routers/watch_party.py, routers/lounge.py) mints it that way because
// LiveKit drops whoever already holds an identity. The same model as the
// native app's mobile/src/lib/loungePeople.ts, keep the two in step.
import { useEffect, useMemo, useRef } from "react";
import { useLocalParticipant, useParticipants } from "@livekit/components-react";
import { Track, type Participant, type RemoteParticipant } from "livekit-client";

/** The person behind a device: an owner_id in league rooms. */
export function personOf(identity: string): string {
  return identity.split("#")[0];
}

/**
 * Everyone in the room, one entry per person. Your own entry is this
 * device; anyone else on two devices shows as the one with its camera
 * on (else the one that joined first).
 */
export function useRoomPeople(): Participant[] {
  const participants = useParticipants();
  return useMemo(() => {
    const byPerson = new Map<string, Participant>();
    for (const p of participants) {
      const key = personOf(p.identity);
      const held = byPerson.get(key);
      if (!held || (!held.isLocal && (p.isLocal || (p.isCameraEnabled && !held.isCameraEnabled)))) byPerson.set(key, p);
    }
    return [...byPerson.values()];
  }, [participants]);
}

/**
 * Your other devices in the room: never play their mic here (you'd
 * hear yourself, or feed back between them), and if one was already in
 * the room when this one joined, start this one muted. Their shared
 * game's sound still plays.
 */
export function useOwnDevices() {
  const participants = useParticipants();
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const me = personOf(localParticipant.identity);
  const mineElsewhere = participants.filter(
    (p): p is RemoteParticipant => !p.isLocal && !!me && personOf(p.identity) === me
  );
  const key = mineElsewhere.map((p) => p.identity).join(",");
  useEffect(() => {
    // Not 0: livekit-client drops a falsy volume when a track re-attaches
    // (MUTED in lib/loungeVolume.ts), and you'd hear yourself again.
    for (const p of mineElsewhere) p.setVolume(0.0001, Track.Source.Microphone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // Decided once, when the room first turns this device's mic on: a
  // device that joins later is the one that starts muted, not this one.
  const checked = useRef(false);
  useEffect(() => {
    if (!isMicrophoneEnabled || checked.current) return;
    checked.current = true;
    if (mineElsewhere.length > 0) void localParticipant.setMicrophoneEnabled(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMicrophoneEnabled, localParticipant]);
}
