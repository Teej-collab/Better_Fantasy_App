import { VideoTrack, type TrackReference } from "@livekit/react-native";
import Slider from "@react-native-community/slider";
import { LinearGradient } from "expo-linear-gradient";
import { Track, type RemoteParticipant } from "livekit-client";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { Text } from "@/components/Text";
import { Fonts } from "@/constants/theme";
import { useAppearance } from "@/lib/appearance";
import { haptics } from "@/lib/haptics";
import { clockLabel, downLabel } from "@/lib/loungeLive";
import { nflTeamColor } from "@/lib/nflTeams";
import type { LiveGame } from "@/lib/types";

// The room's TV (mockup 1): whoever's sharing the game, a LIVE badge,
// and an ESPN-style scorebug for the game on the TV — shown at the
// room's delay, so it matches the picture — with your own volume for
// the game on the right.
export function LoungeTv({
  share,
  game,
  catchingUp,
  height = 216,
  compact = false,
  onPressScorebug,
}: {
  share: TrackReference | undefined;
  game: LiveGame | null;
  catchingUp: boolean;
  height?: number;
  compact?: boolean;
  onPressScorebug?: () => void;
}) {
  const sharer = share?.participant;
  return (
    <View
      style={[styles.tv, { height }]}
      accessibilityLabel={
        game
          ? `${game.away_team.abbr} at ${game.home_team.abbr} on the TV`
          : "The TV"
      }
    >
      <LinearGradient
        colors={["#1d3a24", "#0f1f14", "#070b08"]}
        style={StyleSheet.absoluteFill}
      />
      {share ? (
        <VideoTrack
          trackRef={share}
          style={StyleSheet.absoluteFill}
          objectFit="contain"
        />
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nothing on the TV yet</Text>
          <Text style={styles.emptyHint}>
            {"Whoever's hosting shares the game from a computer."}
          </Text>
        </View>
      )}
      {share && !compact && (
        <View style={styles.badges}>
          <Text style={styles.live}>LIVE</Text>
          <Text style={styles.sharedBy}>
            Shared by {sharer?.isLocal ? "you" : sharer?.name || "someone"}
          </Text>
        </View>
      )}
      {!compact && sharer && !sharer.isLocal && (
        <GameVolume participant={sharer as RemoteParticipant} />
      )}
      {/* A compact score block in the corner (not a full-width bar over the
          picture): scores, and the quarter and clock under them. */}
      {game && (
        <Pressable
          style={[styles.bug, compact && styles.bugCompact]}
          onPress={onPressScorebug}
          disabled={!onPressScorebug}
          accessibilityRole={onPressScorebug ? "button" : undefined}
        >
          <View style={styles.bugScores}>
            <View
              style={[
                styles.team,
                {
                  backgroundColor:
                    nflTeamColor(game.away_team.abbr) ?? "#2b2d31",
                },
              ]}
            >
              <Text style={styles.teamAbbr}>{game.away_team.abbr}</Text>
              <Text style={styles.teamScore}>{game.away_team.score}</Text>
            </View>
            <View
              style={[
                styles.team,
                {
                  backgroundColor:
                    nflTeamColor(game.home_team.abbr) ?? "#2b2d31",
                },
              ]}
            >
              <Text style={styles.teamAbbr}>{game.home_team.abbr}</Text>
              <Text style={styles.teamScore}>{game.home_team.score}</Text>
            </View>
          </View>
          {!compact && (
            <View style={styles.situation}>
              <Text style={styles.situationText} numberOfLines={1}>
                {clockLabel(game)}
                {catchingUp ? " · syncing" : ""}
              </Text>
              {downLabel(game) && (
                <Text style={styles.down} numberOfLines={1}>
                  {downLabel(game)}
                </Text>
              )}
            </View>
          )}
        </Pressable>
      )}
    </View>
  );
}

/** The game's volume, only for you. */
function GameVolume({ participant }: { participant: RemoteParticipant }) {
  const accent = useAppearance().accent;
  const [volume, setVolume] = useState(
    () => participant.getVolume(Track.Source.ScreenShareAudio) ?? 1,
  );
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
        accessibilityLabel={
          volume > 0 ? "Mute the game for you" : "Unmute the game for you"
        }
      >
        <Svg
          width={16}
          height={16}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#f3f4f6"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <Path d="M11 5L6 9H2v6h4l5 4V5z" />
          {volume > 0 ? (
            <Path d="M15.5 8.5a5 5 0 010 7" />
          ) : (
            <Path d="M22 9l-6 6M16 9l6 6" />
          )}
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
  tv: {
    marginHorizontal: 10,
    marginTop: 10,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "#070b08",
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 24,
  },
  emptyTitle: { color: "#f3f4f6", fontSize: 14, fontWeight: "700" },
  emptyHint: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    textAlign: "center",
  },
  badges: {
    position: "absolute",
    top: 10,
    left: 10,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },
  live: {
    backgroundColor: "#dc143c",
    color: "#fff",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
    overflow: "hidden",
  },
  sharedBy: {
    backgroundColor: "rgba(0,0,0,0.6)",
    color: "#f3f4f6",
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    overflow: "hidden",
  },
  bug: {
    position: "absolute",
    left: 10,
    bottom: 10,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "rgba(8,10,16,0.85)",
  },
  bugCompact: { left: 8, bottom: 8 },
  bugScores: { flexDirection: "row" },
  team: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  teamAbbr: { color: "#fff", fontFamily: Fonts.displayBold, fontSize: 13 },
  teamScore: { color: "#fff", fontFamily: Fonts.monoBold, fontSize: 16 },
  situation: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  situationText: { color: "#f3f4f6", fontFamily: Fonts.mono, fontSize: 11 },
  down: { color: "#facc15", fontFamily: Fonts.mono, fontSize: 11 },
  volume: {
    position: "absolute",
    top: 10,
    right: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  slider: { width: 70, height: 30 },
});
