import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { Text } from '@/components/Text';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { driveStartYardsToGoal, ordinal } from '@/lib/gamecast';
import { nflTeamColor } from '@/lib/nflTeams';
import type { LiveGame } from '@/lib/types';

// A top-down field: the offense always drives left → right, so the left
// end zone is theirs and the right one is where they're headed (same
// orientation rule as the web's FieldVisualization). On it: the drive so
// far shaded in the offense's color, the line of scrimmage, the yellow
// first-down line, and the ball, which slides to each new spot.
const ENDZONE = 0.08;
const YARD_NUMBERS = [10, 20, 30, 40, 50, 40, 30, 20, 10];
const MOVE_MS = 700;

export function GamecastField({ game }: { game: LiveGame }) {
  const [width, setWidth] = useState(0);
  const reduceMotion = useReducedMotion();
  const offense = game.possession_team_abbr;
  const defense = offense === game.home_team.abbr ? game.away_team.abbr : offense === game.away_team.abbr ? game.home_team.abbr : null;
  const hasBall = game.status === 'in_progress' && game.yards_to_goal !== null && offense !== null;
  const ytg = game.yards_to_goal ?? 50;
  const offenseColor = nflTeamColor(offense) ?? Colors.accent;
  const defenseColor = nflTeamColor(defense) ?? Colors.border;

  const playWidth = width * (1 - 2 * ENDZONE);
  const xFor = (yardsToGoal: number) => width * ENDZONE + playWidth * ((100 - yardsToGoal) / 100);

  const driveStart = game.current_drive ? driveStartYardsToGoal(game.current_drive) : null;
  const goalToGo = game.distance !== null && game.distance >= ytg;
  const firstDownYtg = hasBall && game.distance !== null && !goalToGo ? Math.max(0, ytg - game.distance) : null;

  const ballX = useSharedValue(0);
  const firstX = useSharedValue(0);
  const trailX = useSharedValue(0);
  useEffect(() => {
    if (width === 0) return;
    const to = (v: number) => (reduceMotion ? v : withTiming(v, { duration: MOVE_MS }));
    ballX.set(to(xFor(ytg)));
    firstX.set(to(firstDownYtg !== null ? xFor(firstDownYtg) : -10));
    trailX.set(to(driveStart !== null ? xFor(driveStart) : xFor(ytg)));
    // xFor only depends on width, which is in the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, ytg, firstDownYtg, driveStart, reduceMotion]);

  const ballStyle = useAnimatedStyle(() => ({ transform: [{ translateX: ballX.get() - 11 }] }));
  const losStyle = useAnimatedStyle(() => ({ transform: [{ translateX: ballX.get() - 1 }] }));
  const firstStyle = useAnimatedStyle(() => ({ transform: [{ translateX: firstX.get() - 1.5 }] }));
  const trailStyle = useAnimatedStyle(() => ({
    left: Math.min(trailX.get(), ballX.get()),
    width: Math.abs(ballX.get() - trailX.get()),
  }));

  const downText = game.down ? `${ordinal(game.down)} & ${goalToGo ? 'Goal' : (game.distance ?? '?')}` : null;
  const a11y = hasBall
    ? `${offense} ball${game.field_position_label ? ` at ${game.field_position_label}` : ''}${downText ? `, ${downText}` : ''}${game.is_redzone ? ', in the red zone' : ''}.`
    : game.status === 'final'
      ? 'Game complete.'
      : 'No ball in play.';

  return (
    <View style={styles.card} accessible accessibilityRole="image" accessibilityLabel={a11y}>
      <View style={styles.top}>
        <Text style={styles.title}>Field position</Text>
        {game.is_redzone && hasBall && (
          <View style={styles.redzonePill}>
            <Text style={styles.redzoneText}>Red zone</Text>
          </View>
        )}
      </View>

      <View style={styles.field} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <LinearGradient colors={['#1f5e2c', '#18491f']} style={StyleSheet.absoluteFill} />
        {/* Mowing stripes every 10 yards. */}
        {width > 0 &&
          Array.from({ length: 10 }, (_, i) =>
            i % 2 === 0 ? null : (
              <View key={`s${i}`} style={[styles.stripe, { left: xFor(100 - i * 10), width: playWidth / 10 }]} />
            ),
          )}
        {hasBall && game.is_redzone && width > 0 && <View style={[styles.redzone, { left: xFor(20), width: xFor(0) - xFor(20) }]} />}

        {/* End zones: the offense's own on the left, its target on the right. */}
        <View style={[styles.endzone, styles.endzoneLeft, { backgroundColor: hasBall ? offenseColor : '#123d1a' }]}>
          {hasBall && <Text style={[styles.endzoneText, styles.endzoneTextLeft]} maxFontSizeMultiplier={1}>{offense}</Text>}
        </View>
        <View style={[styles.endzone, styles.endzoneRight, { backgroundColor: hasBall ? defenseColor : '#123d1a' }]}>
          {hasBall && defense && <Text style={[styles.endzoneText, styles.endzoneTextRight]} maxFontSizeMultiplier={1}>{defense}</Text>}
        </View>

        {width > 0 &&
          Array.from({ length: 11 }, (_, i) => (
            <View key={`l${i}`} style={[styles.yardLine, i === 5 && styles.midfield, { left: xFor(100 - i * 10) }]} />
          ))}
        {width > 0 &&
          YARD_NUMBERS.map((n, i) => (
            <Text key={`n${i}`} style={[styles.yardNumber, { left: xFor(90 - i * 10) - 12 }]} maxFontSizeMultiplier={1}>
              {n}
            </Text>
          ))}

        {hasBall && width > 0 && (
          <>
            <Animated.View style={[styles.trail, { backgroundColor: offenseColor }, trailStyle]} />
            {firstDownYtg !== null && <Animated.View style={[styles.firstDown, firstStyle]} />}
            <Animated.View style={[styles.los, losStyle]} />
            <Animated.View style={[styles.ball, ballStyle]}>
              <Text style={styles.ballEmoji} maxFontSizeMultiplier={1}>
                🏈
              </Text>
            </Animated.View>
          </>
        )}

        {!hasBall && (
          <View style={styles.overlay}>
            <Text style={styles.overlayText}>
              {game.status === 'final'
                ? 'Game complete'
                : game.status === 'halftime'
                  ? 'Halftime'
                  : game.status === 'scheduled'
                    ? `Kickoff ${new Date(game.scheduled_start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
                    : '—'}
            </Text>
          </View>
        )}
      </View>

      {hasBall && (
        <View style={styles.bottom}>
          <Text style={styles.situation}>
            <Text style={[styles.situationTeam, { color: lighten(offenseColor) }]}>{offense}</Text> ball
            {game.field_position_label ? ` · ${game.field_position_label}` : ''}
          </Text>
          {downText && <Text style={styles.down}>{downText}</Text>}
        </View>
      )}
      {hasBall && game.current_drive && (
        <Text style={styles.drive}>
          This drive: {game.current_drive.play_count} plays · {game.current_drive.yards} yds · {game.current_drive.duration}
        </Text>
      )}
    </View>
  );
}

// Team colors are often deep navies; lift them so the abbreviation reads
// on the dark card.
export function lighten(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * 0.35);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

const FIELD_HEIGHT = 128;

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  redzonePill: { backgroundColor: 'rgba(239,68,68,0.18)', borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  redzoneText: { color: Colors.live, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  field: { height: FIELD_HEIGHT, borderRadius: Radius.md, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  stripe: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.035)' },
  redzone: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(239,68,68,0.16)' },
  endzone: { position: 'absolute', top: 0, bottom: 0, width: `${ENDZONE * 100}%`, alignItems: 'center', justifyContent: 'center', opacity: 0.9 },
  endzoneLeft: { left: 0 },
  endzoneRight: { right: 0 },
  endzoneText: { color: '#fff', fontFamily: Fonts.displayBold, fontSize: 13, letterSpacing: 2, width: FIELD_HEIGHT, textAlign: 'center' },
  endzoneTextLeft: { transform: [{ rotate: '-90deg' }] },
  endzoneTextRight: { transform: [{ rotate: '90deg' }] },
  yardLine: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.28)' },
  midfield: { width: 2, backgroundColor: 'rgba(255,255,255,0.45)' },
  yardNumber: {
    position: 'absolute',
    bottom: 6,
    width: 24,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.45)',
    fontFamily: Fonts.displayBold,
    fontSize: 11,
  },
  trail: { position: 'absolute', top: FIELD_HEIGHT * 0.32, height: FIELD_HEIGHT * 0.36, opacity: 0.45, borderRadius: 3 },
  los: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, backgroundColor: '#60a5fa' },
  firstDown: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: '#facc15' },
  ball: { position: 'absolute', left: 0, top: FIELD_HEIGHT / 2 - 13, width: 22, alignItems: 'center' },
  ballEmoji: { fontSize: 20 },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  overlayText: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '600' },
  bottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  situation: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  situationTeam: { fontWeight: '800' },
  down: { color: Colors.text, fontSize: 16, fontFamily: Fonts.monoBold },
  drive: { color: Colors.textSecondary, fontSize: 12 },
});
