import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeOutUp, SlideInUp } from 'react-native-reanimated';

import { GlowBox, GlowText } from '@/components/fx/Glow';
import { LiveDot, OB } from '@/components/ob/Ob';
import { lighten } from '@/components/gamecast/GamecastField';
import { Text } from '@/components/Text';
import { Colors, Fonts, OwnersBox, Radius, Spacing } from '@/constants/theme';
import { bigMomentFor, type BigMoment } from '@/lib/gamecast';
import { nflTeamColor } from '@/lib/nflTeams';
import type { GamecastPlay, LiveGame, PlayFantasyPlayer } from '@/lib/types';

const SHOW_MS = 5000;

export type Moment = BigMoment & { kind: 'score' | 'turnover' | 'fantasy'; color: string; points?: number };

// Watches the live game for the plays worth stopping for — scores,
// turnovers, and your own players' points — and returns the one to show.
// Only plays that arrive while you're watching count: opening a game
// mid-way doesn't replay its last touchdown at you.
export function useGameMoments(game: LiveGame | undefined, lastPlay: GamecastPlay | null, lastPlayFantasy: PlayFantasyPlayer[] | undefined) {
  const [moment, setMoment] = useState<Moment | null>(null);
  const seenPlay = useRef<string | null>(null);
  const seenFantasy = useRef<string | null>(null);

  useEffect(() => {
    if (!game || !lastPlay) return;
    if (seenPlay.current === null) {
      seenPlay.current = lastPlay.play_id;
      seenFantasy.current = lastPlay.play_id;
      return;
    }
    if (seenPlay.current === lastPlay.play_id) return;
    seenPlay.current = lastPlay.play_id;
    const big = bigMomentFor(lastPlay);
    if (!big) return;
    const turnover = !lastPlay.is_scoring_play;
    // A turnover belongs to the defense that took the ball away.
    const team = turnover
      ? lastPlay.team_abbr === game.home_team.abbr
        ? game.away_team.abbr
        : game.home_team.abbr
      : big.team;
    const color = nflTeamColor(team) ?? Colors.accent;
    // Shown from a callback (not the effect body) so the banner's render
    // doesn't cascade off this one; the play is already marked seen, so
    // it's never cancelled.
    setTimeout(() => {
      void Haptics.notificationAsync(turnover ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success);
      AccessibilityInfo.announceForAccessibility(`${big.title}, ${team ?? ''}. ${big.detail}`);
      setMoment({ ...big, team, color, kind: turnover ? 'turnover' : 'score' });
    }, 0);
  }, [game, lastPlay]);

  // Your player on the play: a smaller nudge once ESPN has attached the
  // players (that fantasy lookup lands a few seconds after the play).
  useEffect(() => {
    if (!lastPlay || !lastPlayFantasy || seenFantasy.current === lastPlay.play_id || seenPlay.current !== lastPlay.play_id) return;
    const mine = lastPlayFantasy.filter((p) => p.is_mine && p.points !== 0);
    if (mine.length === 0) return;
    seenFantasy.current = lastPlay.play_id;
    const points = mine.reduce((sum, p) => sum + p.points, 0);
    const playId = lastPlay.play_id;
    const fantasyMoment: Moment = {
      key: playId,
      kind: 'fantasy',
      title: points > 0 ? 'Points for you' : 'Points off your board',
      team: null,
      detail: mine.map((p) => `${p.player_name} ${p.points > 0 ? '+' : ''}${p.points.toFixed(1)}`).join(' · '),
      color: points > 0 ? Colors.accent : Colors.loss,
      points,
    };
    setTimeout(() => {
      void Haptics.impactAsync(points > 0 ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
      // A score banner for the same play stays up, with your points added.
      setMoment((current) => (current && current.key === playId ? { ...current, points } : fantasyMoment));
    }, 0);
  }, [lastPlay, lastPlayFantasy]);

  useEffect(() => {
    if (!moment) return;
    const id = setTimeout(() => setMoment(null), SHOW_MS);
    return () => clearTimeout(id);
  }, [moment]);

  return { moment, dismiss: () => setMoment(null) };
}

export function MomentBanner({ moment, onDismiss }: { moment: Moment | null; onDismiss: () => void }) {
  if (!moment) return null;
  const color = lighten(moment.color);
  // Owners Box: a dark glass alert dropping from the top, lit green when
  // it's points for you.
  if (OwnersBox) {
    const good = moment.points === undefined ? moment.kind !== 'turnover' : moment.points >= 0;
    return (
      <Animated.View key={moment.key} entering={SlideInUp.springify().damping(16)} exiting={FadeOutUp} style={styles.wrap} pointerEvents="box-none">
        <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel={`${moment.title}. Dismiss`} style={[styles.obBanner, !good && styles.obBannerQuiet]}>
          <View style={styles.obDot}>
            <LiveDot color={good ? OB.lamp : OB.warn} />
          </View>
          <View style={styles.obText}>
            <Text style={[styles.obKicker, !good && { color: OB.warn }]} numberOfLines={1}>
              {`${moment.title}${moment.team ? ` · ${moment.team}` : ''}`.toUpperCase()}
            </Text>
            <Text style={styles.obDetail} numberOfLines={2}>
              {moment.detail}
            </Text>
          </View>
          {moment.points !== undefined && (
            <Text style={[styles.obPoints, moment.points < 0 && { color: OB.ink2 }]} maxFontSizeMultiplier={1.2}>
              {moment.points > 0 ? '+' : ''}
              {moment.points.toFixed(1)}
            </Text>
          )}
        </Pressable>
      </Animated.View>
    );
  }
  return (
    <Animated.View key={moment.key} entering={SlideInUp.springify().damping(16)} exiting={FadeOutUp} style={styles.wrap} pointerEvents="box-none">
      <GlowBox color={color} radius={Radius.lg} intensity={0.55} spread={16}>
      <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel={`${moment.title}. Dismiss`} style={[styles.banner, { borderColor: color }]}>
        <View style={[styles.glow, { backgroundColor: moment.color }]} />
        <View style={styles.row}>
          <GlowText style={[styles.title, { color, textShadowColor: color }]}>{`${moment.title}${moment.team ? ` · ${moment.team}` : ''}`.toUpperCase()}</GlowText>
          {moment.points !== undefined && (
            <Text style={[styles.points, { color: moment.points >= 0 ? Colors.accent : Colors.loss }]} maxFontSizeMultiplier={1.2}>
              {moment.points > 0 ? '+' : ''}
              {moment.points.toFixed(1)} you
            </Text>
          )}
        </View>
        <Text style={styles.detail} numberOfLines={2}>
          {moment.detail}
        </Text>
      </Pressable>
      </GlowBox>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: Spacing.lg, right: Spacing.lg, top: Spacing.sm, zIndex: 10 },
  banner: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 2,
    padding: Spacing.md,
    gap: 4,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  glow: { ...StyleSheet.absoluteFill, opacity: 0.18 },
  row: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: Spacing.sm },
  title: { flexShrink: 1, fontFamily: Fonts.displayBold, fontSize: 22, letterSpacing: 1.5, textShadowRadius: 10 },
  points: { fontFamily: Fonts.monoBold, fontSize: 16 },
  detail: { color: Colors.text, fontSize: 13, lineHeight: 18 },
  obBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    paddingRight: 16,
    borderRadius: 24,
    backgroundColor: 'rgba(10,12,15,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(57,255,20,0.4)',
    shadowColor: OB.lamp,
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
  },
  obBannerQuiet: { borderColor: OB.rim2, shadowOpacity: 0 },
  obDot: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: OB.rim2 },
  obText: { flex: 1, minWidth: 0, gap: 2 },
  obKicker: { color: OB.lamp, fontFamily: Fonts.mono, fontSize: 10, letterSpacing: 1.6 },
  obDetail: { color: OB.ink, fontSize: 13.5, lineHeight: 18, fontFamily: Fonts.bodySemiBold },
  obPoints: { color: OB.lamp, fontFamily: OB.displayBlack, fontSize: 28 },
});
