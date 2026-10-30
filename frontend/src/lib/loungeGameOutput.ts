"use client";

import { useRoomContext, useTracks } from "@livekit/components-react";
import { Track, type RemoteAudioTrack } from "livekit-client";
import { useEffect, useSyncExternalStore } from "react";

// Split audio (2026-10-29, for PCs with a mixer like a GoXLR): the game
// on the TV can play to a different output than everyone's voices, so
// the stream and the chat sit on separate channels. The room plays all
// remote audio through one Web Audio context on the Speakers device
// (webAudioMix, lib/livekitMedia.ts); the game's track is moved onto a
// context of its own on the chosen device. Chrome and Edge only:
// elsewhere an AudioContext can't pick its output, so there's no picker.

const KEY = "wl:lounge-game-output";

/** Whether this browser can send the game somewhere else. */
export const canSplitGameAudio = typeof window !== "undefined" && typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype;

let current: string | null = null;
try {
  current = typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null;
} catch {
  current = null;
}
const listeners = new Set<() => void>();

/** The output the game plays to, or null for the same as Speakers. */
export function useGameOutput(): string | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
    () => null,
  );
}

export function setGameOutput(deviceId: string | null) {
  current = deviceId;
  try {
    if (deviceId) window.localStorage.setItem(KEY, deviceId);
    else window.localStorage.removeItem(KEY);
  } catch {
    // Not remembered; still applies now.
  }
  listeners.forEach((fn) => fn());
}

// "default" means the system's default device, which an AudioContext
// spells as an empty string.
const sinkFor = (deviceId: string) => (deviceId === "default" ? "" : deviceId);

const contextOf = (t: RemoteAudioTrack) => (t as unknown as { audioContext?: AudioContext }).audioContext;

type SinkContext = AudioContext & { setSinkId: (id: string) => Promise<void> };
let gameContext: SinkContext | null = null;

/** Mounted once in the room: keeps every incoming game track on the
 *  right output. */
export function useApplyGameOutput() {
  const room = useRoomContext();
  const output = useGameOutput();
  const gameTracks = useTracks([Track.Source.ScreenShareAudio])
    .filter((t) => !t.participant.isLocal)
    .map((t) => t.publication?.track as RemoteAudioTrack | undefined)
    .filter((t): t is RemoteAudioTrack => !!t);
  const key = gameTracks.map((t) => t.sid).join(",");

  useEffect(() => {
    if (!canSplitGameAudio) return;
    // The room's own context: where everything plays by default.
    const roomContext = (room as unknown as { audioContext?: AudioContext }).audioContext;
    if (output === null) {
      // Back with everyone else: only tracks this moved, and only once
      // the room's context exists (without one a track would go silent).
      if (roomContext) gameTracks.filter((t) => contextOf(t) === gameContext).forEach((t) => t.setAudioContext(roomContext));
      return;
    }
    let live = true;
    gameContext ??= new AudioContext() as SinkContext;
    const ctx = gameContext;
    void ctx
      .setSinkId(sinkFor(output))
      .then(() => {
        if (!live) return;
        gameTracks.forEach((t) => t.setAudioContext(ctx));
        if (ctx.state !== "running") void ctx.resume().catch(() => {});
      })
      .catch(() => {
        // The device went away: back with everyone else.
        setGameOutput(null);
      });
    return () => {
      live = false;
    };
    // gameTracks is keyed by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, output, key]);
}
