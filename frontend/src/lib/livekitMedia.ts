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
  // The sharer stops hearing the shared tab straight from that tab, so
  // the game can't drown out everyone's voices; the room plays it back
  // to them at their own volume instead (WebLoungeRoom.tsx's
  // SharerGameVolume). Chrome/Edge, and only when sharing a tab.
  suppressLocalAudioPlayback: true,
};

const GAME_PUBLISH: TrackPublishOptions = {
  screenShareEncoding: { maxBitrate: 6_000_000, maxFramerate: 30 },
  // Lower layers for viewers on a weak connection, so they drop to a
  // lighter picture instead of freezing. All 30fps: adaptiveStream picks
  // a viewer's layer by how big the TV is drawn, and when the web TV was
  // capped small, everyone got the 360p layer — at 15fps, which read as
  // a choppy stream (2026-10-11).
  screenShareSimulcastLayers: [
    new VideoPreset(1280, 720, 2_500_000, 30),
    new VideoPreset(640, 360, 900_000, 30),
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
  // Phones' browsers (every iPhone/iPad browser, and in-app web views)
  // have no screen capture at all, and LiveKit's own error for that is
  // a bare "getDisplayMedia not supported" (2026-10-14, from a phone).
  if (enabled && !navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Phones can't share their screen from the browser. Open the Lounge on a computer to put the game up.");
  }
  await localParticipant.setScreenShareEnabled(enabled, GAME_CAPTURE, GAME_PUBLISH);
}

export const SHARED_GAME_AUDIO = Track.Source.ScreenShareAudio;
