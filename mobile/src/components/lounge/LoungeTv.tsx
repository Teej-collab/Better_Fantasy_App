import { VideoTrack, type TrackReference } from '@livekit/react-native';
import Slider from '@react-native-community/slider';
import { LinearGradient } from 'expo-linear-gradient';
import { Track, type RemoteParticipant } from 'livekit-client';
import { useState } from 'react';
import { Modal, Pressable, StatusBar, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Text } from '@/components/Text';
import { Fonts } from '@/constants/theme';
import { useAppearance } from '@/lib/appearance';
import { haptics } from '@/lib/haptics';
import { clockLabel, downLabel } from '@/lib/loungeLive';
import { nflTeamColor } from '@/lib/nflTeams';
import type { LiveGame } from '@/lib/types';

// The room's TV (mockup 1): whoever's sharing the game, a LIVE badge,
// and an ESPN-style scorebug for the game on the TV — shown at the
// room's delay, so it matches the picture — with your own volume for
// the game on the right. Full screen turns the picture sideways to fill
// the phone (the app itself stays portrait), so you just turn the phone.
export function LoungeTv({
  share,
  game,
  catchingUp,
  height = 216,
  compact = false,
  onPressScorebug,
  onExitFullScreen,
}: {
  share: TrackReference | undefined;
  game: LiveGame | null;
  catchingUp: boolean;
  height?: number;
  compact?: boolean;
  onPressScorebug?: () => void;
  // Set when this is the full-screen TV: its own way back out.
  onExitFullScreen?: () => void;
}) {
  const sharer = share?.participant;
  const fullScreen = !!onExitFullScreen;
  const [full, setFull] = useState(false);
  return (
    <View style={[styles.tv, fullScreen ? styles.tvFull : { height }]} accessibilityLabel={game ? `${game.away_team.abbr} at ${game.home_team.abbr} on the TV` : 'The TV'}>
      <LinearGradient colors={['#1d3a24', '#0f1f14', '#070b08']} style={StyleSheet.absoluteFill} />
      {share ? (
        <VideoTrack trackRef={share} style={StyleSheet.absoluteFill} objectFit="contain" />
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nothing on the TV yet</Text>
          <Text style={styles.emptyHint}>{"Whoever's hosting shares the game from a computer."}</Text>
        </View>
      )}
      {/* Everything over the picture; full screen keeps it clear of the
          notch and home bar, which end up on its left and right. */}
      <View style={[StyleSheet.absoluteFill, fullScreen && styles.fullInset]} pointerEvents="box-none">
      {share && !compact && (
        <View style={styles.badges}>
          <Text style={styles.live}>LIVE</Text>
          <Text style={styles.sharedBy}>Shared by {sharer?.isLocal ? 'you' : sharer?.name || 'someone'}</Text>
        </View>
      )}
      {!compact && sharer && !sharer.isLocal && <GameVolume participant={sharer as RemoteParticipant} />}
      {(share || fullScreen) && !compact && (
        <Pressable
          onPress={() => {
            haptics.tap();
            if (fullScreen) onExitFullScreen();
            else setFull(true);
          }}
          hitSlop={10}
          style={styles.fullBtn}
          accessibilityRole="button"
          accessibilityLabel={fullScreen ? 'Exit full screen' : 'Full screen'}>
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#f3f4f6" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <Path d={fullScreen ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'} />
          </Svg>
        </Pressable>
      )}
      {!fullScreen && full && (
        <FullScreenTv onClose={() => setFull(false)}>
          <LoungeTv share={share} game={game} catchingUp={catchingUp} onPressScorebug={onPressScorebug} onExitFullScreen={() => setFull(false)} />
        </FullScreenTv>
      )}
      {/* A broadcast-style bug in the corner, only as wide as the scores:
          quarter and clock on top, the score (a dot for who has the ball),
          down and distance underneath. */}
      {game && (
        <Pressable style={[styles.bug, compact && styles.bugCompact]} onPress={onPressScorebug} disabled={!onPressScorebug} accessibilityRole={onPressScorebug ? 'button' : undefined}>
          {!compact && (
            <View style={styles.clockRow}>
              <Text style={styles.clockText} numberOfLines={1}>
                {clockLabel(game)}
              </Text>
              {catchingUp && <View style={styles.syncDot} accessibilityLabel="Syncing to the TV" />}
            </View>
          )}
          <View style={styles.bugScores}>
            {[game.away_team, game.home_team].map((t) => {
              const ball = game.status === 'in_progress' && game.possession_team_abbr === t.abbr;
              return (
                <View key={t.abbr} style={[styles.team, { backgroundColor: nflTeamColor(t.abbr) ?? '#2b2d31' }]}>
                  <Text style={styles.teamAbbr}>{t.abbr}</Text>
                  <Text style={styles.teamScore}>{t.score}</Text>
                  <View style={[styles.ball, ball && styles.ballOn]} accessibilityLabel={ball ? `${t.abbr} has the ball` : undefined} />
                </View>
              );
            })}
          </View>
          {!compact && downLabel(game) && (
            <Text style={styles.down} numberOfLines={1}>
              {downLabel(game)}
            </Text>
          )}
        </Pressable>
      )}
      </View>
    </View>
  );
}

/** The TV across the whole phone, turned sideways. */
function FullScreenTv({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const { width, height } = useWindowDimensions();
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} presentationStyle="overFullScreen" transparent>
      <StatusBar hidden />
      <View style={styles.fullScreen}>
        <View style={{ width: height, height: width, transform: [{ rotate: '90deg' }] }}>{children}</View>
      </View>
    </Modal>
  );
}

/** The game's volume, only for you. */
function GameVolume({ participant }: { participant: RemoteParticipant }) {
  const accent = useAppearance().accent;
  const [volume, setVolume] = useState(() => participant.getVolume(Track.Source.ScreenShareAudio) ?? 1);
  const [restore, setRestore] = useState(1);
  function change(next: number) {
    setVolume(next);
    participant.setVolume(next, Track.Source.ScreenShareAudio);
  }
  return (
    <View style={styles.volume}>
      <Pressable
        hitSlop={10}
        onPress={() => {
          haptics.tap();
          if (volume > 0) {
            setRestore(volume);
            change(0);
          } else change(restore || 1);
        }}
        accessibilityLabel={volume > 0 ? 'Mute the game for you' : 'Unmute the game for you'}>
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#f3f4f6" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M11 5L6 9H2v6h4l5 4V5z" />
          {volume > 0 ? <Path d="M15.5 8.5a5 5 0 010 7" /> : <Path d="M22 9l-6 6M16 9l6 6" />}
        </Svg>
      </Pressable>
      <Slider
        style={styles.slider}
        minimumValue={0}
        maximumValue={2}
        value={volume}
        onValueChange={change}
        minimumTrackTintColor={accent}
        maximumTrackTintColor="rgba(255,255,255,0.25)"
        thumbTintColor="#fff"
        accessibilityLabel="Game volume, only for you"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tv: { marginHorizontal: 10, marginTop: 10, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: '#070b08' },
  tvFull: { flex: 1, margin: 0, marginTop: 0, marginHorizontal: 0, borderRadius: 0, borderWidth: 0, backgroundColor: '#000' },
  fullInset: { left: 44, right: 44 },
  fullScreen: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  fullBtn: { position: 'absolute', right: 10, bottom: 10, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 24 },
  emptyTitle: { color: '#f3f4f6', fontSize: 14, fontWeight: '700' },
  emptyHint: { color: 'rgba(255,255,255,0.5)', fontSize: 12, textAlign: 'center' },
  badges: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', gap: 6, alignItems: 'center' },
  live: { backgroundColor: '#dc143c', color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 1, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4, overflow: 'hidden' },
  sharedBy: { backgroundColor: 'rgba(0,0,0,0.6)', color: '#f3f4f6', fontSize: 11, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, overflow: 'hidden' },
  bug: { position: 'absolute', left: 10, bottom: 10, borderRadius: 8, overflow: 'hidden', backgroundColor: 'rgba(8,10,16,0.85)' },
  bugCompact: { left: 8, bottom: 8 },
  bugScores: { flexDirection: 'row' },
  team: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3 },
  teamAbbr: { color: '#fff', fontFamily: Fonts.displayBold, fontSize: 13 },
  teamScore: { color: '#fff', fontFamily: Fonts.monoBold, fontSize: 16 },
  ball: { width: 6, height: 6, borderRadius: 3 },
  ballOn: { backgroundColor: '#facc15' },
  clockRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 2 },
  clockText: { color: 'rgba(255,255,255,0.85)', fontFamily: Fonts.mono, fontSize: 10 },
  syncDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#9aa3b2' },
  down: { color: '#facc15', fontFamily: Fonts.mono, fontSize: 10, textAlign: 'center', paddingVertical: 2, paddingHorizontal: 6 },
  volume: { position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.6)' },
  slider: { width: 70, height: 30 },
});
