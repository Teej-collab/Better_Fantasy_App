// Shared LiveKit settings for the Lounge (LoungeVideoRoom.tsx) and Watch
// Party (WatchPartyRoom.tsx) — both are "someone shares a live game,
// everyone else watches and talks," so they want the same thing from the
// call: a smooth shared picture, full-quality game audio, and volume
// controls that actually work on every device.
import {
  AudioPresets,
  Track,
  VideoPreset,
  type LocalParticipant,
  type RoomOptions,
  type ScreenShareCaptureOptions,
  type TrackPublishOptions,
} from "livekit-client";

/**
 * - webAudioMix: plays every remote track through Web Audio. Without it
 *   the per-person volume sliders (ParticipantVolumePanel) do nothing on
 *   an iPhone — iOS Safari ignores an <audio> element's volume entirely,
 *   and the native app opens these rooms in Safari's in-app browser.
 * - adaptiveStream: each viewer receives the video layer that fits how
 *   big it's shown and what their connection can take, instead of
 *   everyone pulling full 1080p and stalling on a weak signal.
 * - dynacast: the sharer stops encoding layers nobody is watching,
 *   freeing their upload for the one that is.
 */
export const LIVEKIT_ROOM_OPTIONS: Partial<RoomOptions> = {
  webAudioMix: true,
  adaptiveStream: true,
  dynacast: true,
};

// LiveKit's screen-share defaults are tuned for slides on a work call:
// 1080p at 15fps, and the shared tab's audio sent as 48kbps mono with
// DTX (audio dropped whenever it goes quiet) and speech processing.
// For a football broadcast that reads as choppy video and thin,
// cutting-out sound — the 2026-10 "stream quality didn't look great"
// report. These settings are for live sports instead.
const GAME_CAPTURE: ScreenShareCaptureOptions = {
  // The game's own sound, untouched — echo cancellation, noise
  // suppression and auto gain are for voices and mangle crowd noise
  // and commentary.
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, voiceIsolation: false },
  // Offer the tab/system audio choice in Chrome's picker.
  systemAudio: "include",
  resolution: { width: 1920, height: 1080, frameRate: 30 },
  // Prioritize smooth motion over pin-sharp stills when bandwidth is tight.
  contentHint: "motion",
};

const GAME_PUBLISH: TrackPublishOptions = {
  screenShareEncoding: { maxBitrate: 6_000_000, maxFramerate: 30 },
  // Lower layers for viewers on a weak connection, so they drop to a
  // lighter picture instead of freezing.
  screenShareSimulcastLayers: [
    new VideoPreset(1280, 720, 2_500_000, 30),
    new VideoPreset(640, 360, 600_000, 15),
  ],
  // When the sharer's upload can't keep up, keep the frame rate and
  // soften the picture rather than stutter.
  degradationPreference: "maintain-framerate",
  audioPreset: AudioPresets.musicHighQualityStereo,
  dtx: false,
  forceStereo: true,
};

/** Starts or stops sharing a game (screen + its audio) with the
 *  broadcast-quality settings above. */
export async function toggleGameShare(localParticipant: LocalParticipant, enabled: boolean): Promise<void> {
  await localParticipant.setScreenShareEnabled(enabled, GAME_CAPTURE, GAME_PUBLISH);
}

export const SHARED_GAME_AUDIO = Track.Source.ScreenShareAudio;
