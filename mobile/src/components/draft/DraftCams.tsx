import {
  LiveKitRoom,
  registerGlobals,
  useIsSpeaking,
  useLocalParticipant,
  useTracks,
  VideoTrack,
  type TrackReference,
} from '@livekit/react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { Track, VideoPresets } from 'livekit-client';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { HexFrame } from '@/components/lounge/HexFrame';
import { Text } from '@/components/Text';
import { Colors, Fonts } from '@/constants/theme';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { personOf } from '@/lib/loungePeople';

// The draft room's cameras (2026-10-28, for leagues drafting from far
// apart): one LiveKit room per league and season (backend POST
// /draft/video-token), the Lounge's video setup and honeycomb frames.
// Nobody's on camera until they tap Join; the room is always mounted so
// joining doesn't reset the draft screen under it.

// LiveKit's WebRTC globals; safe to call again after the Lounge has.
registerGlobals();

const ROOM_OPTIONS = {
  adaptiveStream: true,
  dynacast: true,
  videoCaptureDefaults: { resolution: VideoPresets.h360.resolution },
};

type Video = { joined: boolean; joining: boolean; join: () => void; leave: () => void };
const VideoContext = createContext<Video>({ joined: false, joining: false, join: () => {}, leave: () => {} });
const TracksContext = createContext<Map<string, TrackReference>>(new Map());

export function useDraftVideo(): Video {
  return useContext(VideoContext);
}

function KeepAwake() {
  useKeepAwake();
  return null;
}

/** Everyone's camera, by owner id (one per person, their first device with one on). */
function TrackMap({ children }: { children: ReactNode }) {
  const tracks = useTracks([Track.Source.Camera]) as TrackReference[];
  const map = useMemo(() => {
    const m = new Map<string, TrackReference>();
    for (const t of tracks) {
      if (t.publication?.isMuted) continue;
      const owner = personOf(t.participant.identity);
      if (!m.has(owner) || t.participant.isLocal) m.set(owner, t);
    }
    return m;
  }, [tracks]);
  return <TracksContext.Provider value={map}>{children}</TracksContext.Provider>;
}

export function DraftVideoProvider({ children }: { children: ReactNode }) {
  const [creds, setCreds] = useState<{ token: string; url: string } | null>(null);
  const [joining, setJoining] = useState(false);

  async function join() {
    setJoining(true);
    try {
      const { token, url } = await api.draftVideoToken();
      setCreds({ token, url });
      haptics.success();
    } catch (e) {
      Alert.alert("Couldn't join the cameras", e instanceof Error ? e.message : 'Try again.');
    } finally {
      setJoining(false);
    }
  }

  const value = useMemo<Video>(() => ({ joined: creds !== null, joining, join: () => void join(), leave: () => setCreds(null) }), [creds, joining]);

  return (
    <VideoContext.Provider value={value}>
      <LiveKitRoom
        serverUrl={creds?.url}
        token={creds?.token}
        connect={creds !== null}
        audio={creds !== null}
        video={creds !== null}
        options={ROOM_OPTIONS}
        onError={(e) => Alert.alert('Camera trouble', e.message || "Couldn't connect the cameras.")}>
        {creds && <KeepAwake />}
        <TrackMap>{children}</TrackMap>
      </LiveKitRoom>
    </VideoContext.Provider>
  );
}

const FACES = ['#2f3a4d', '#33304a', '#2d4038', '#3d3328', '#283a44', '#3a2d3a'];

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? parts[0]?.[1] ?? '')).toUpperCase() || '?';
}

function Speaking({ track, color }: { track: TrackReference; color: string }) {
  const speaking = useIsSpeaking(track.participant);
  return speaking ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.speaking, { borderColor: color }]} /> : null;
}

/** One manager's tile: their camera when it's on, else their initials,
 *  in a honeycomb frame; a colored ring for whoever's on the clock (or you). */
export function CamTile({
  ownerId,
  name,
  width,
  height,
  ring,
  dim,
  index,
  small,
}: {
  ownerId: number;
  name: string;
  width: number;
  height: number;
  ring?: string | null;
  dim?: boolean;
  index: number;
  small?: boolean;
}) {
  const track = useContext(TracksContext).get(String(ownerId));
  return (
    <View style={{ opacity: dim ? 0.45 : 1 }} accessible accessibilityLabel={`${name}${dim ? ', not here' : ''}`}>
      <HexFrame width={width} height={height} hit={undefined} fallback={Colors.accent} rail={small}>
        <View style={[StyleSheet.absoluteFill, styles.face, { backgroundColor: FACES[index % FACES.length] }]}>
          {track ? (
            <VideoTrack trackRef={track} style={StyleSheet.absoluteFill} objectFit="cover" mirror={track.participant.isLocal} />
          ) : (
            <Text style={[styles.initials, { fontSize: Math.max(12, Math.round(height * 0.32)) }]} maxFontSizeMultiplier={1}>
              {initialsOf(name)}
            </Text>
          )}
        </View>
        {track && <Speaking track={track} color={Colors.accent} />}
        {ring && <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.ring, { borderColor: ring }]} />}
      </HexFrame>
    </View>
  );
}

function LocalControls() {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  return (
    <>
      <Pressable
        onPress={() => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
        accessibilityRole="button"
        accessibilityLabel={isMicrophoneEnabled ? 'Mute your mic' : 'Unmute your mic'}
        style={[styles.ctrl, !isMicrophoneEnabled && styles.ctrlOff]}>
        <Text style={styles.ctrlText}>{isMicrophoneEnabled ? 'Mic on' : 'Muted'}</Text>
      </Pressable>
      <Pressable
        onPress={() => void localParticipant.setCameraEnabled(!isCameraEnabled)}
        accessibilityRole="button"
        accessibilityLabel={isCameraEnabled ? 'Turn your camera off' : 'Turn your camera on'}
        style={[styles.ctrl, !isCameraEnabled && styles.ctrlOff]}>
        <Text style={styles.ctrlText}>{isCameraEnabled ? 'Cam on' : 'Cam off'}</Text>
      </Pressable>
    </>
  );
}

/** Join the cameras, or once in: mic, camera and leave. */
export function CamControls() {
  const video = useDraftVideo();
  if (!video.joined) {
    return (
      <Pressable onPress={video.join} disabled={video.joining} accessibilityRole="button" style={[styles.ctrl, styles.join]}>
        <Text style={[styles.ctrlText, { color: '#0d1016' }]}>{video.joining ? 'Joining…' : 'Join on camera'}</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.ctrlRow}>
      <LocalControls />
      <Pressable onPress={video.leave} accessibilityRole="button" accessibilityLabel="Leave the cameras" style={styles.ctrl}>
        <Text style={[styles.ctrlText, { color: Colors.loss }]}>Leave</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  face: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initials: { color: '#dfe4ea', fontFamily: Fonts.display },
  ring: { borderWidth: 2.5, borderRadius: 12 },
  speaking: { borderWidth: 2, borderRadius: 12 },
  ctrlRow: { flexDirection: 'row', gap: 6 },
  ctrl: { minHeight: 34, borderRadius: 999, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, paddingHorizontal: 12, justifyContent: 'center' },
  ctrlOff: { borderColor: Colors.loss },
  ctrlText: { color: Colors.text, fontSize: 12, fontWeight: '700' },
  join: { backgroundColor: Colors.accent, borderColor: Colors.accent },
});
