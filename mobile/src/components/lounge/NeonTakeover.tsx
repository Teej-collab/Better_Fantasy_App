import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { GlowBox, GlowText } from '@/components/fx/Glow';
import type { RoomMoment } from '@/components/lounge/RoomMoments';
import { Text } from '@/components/Text';
import { Fonts } from '@/constants/theme';
import { nflTeamColor } from '@/lib/nflTeams';

// The big moment on the TV (2026-10-29 "Neon Takeover", the pick from the
// Scoring Moments mockups): the picture dims, a neon frame lights around
// the TV, the word catches letter by letter like a neon tube, then who
// did it and what it's worth to you. Green when it's good for you, red
// when it's not, orange for a turnover, the scoring team's color when
// it's somebody else in the room's. Tap to put it away; it fades by
// itself after TAKEOVER_MS.

export const TAKEOVER_MS = 5200;
const LETTER_AT = 350;
const LETTER_STEP = 60;

function toneFor(m: RoomMoment): { neon: string; core: string } {
  if (m.kind === 'turnover') return { neon: '#ff8a2a', core: '#fff1e0' };
  if (m.myPoints !== undefined && m.myPoints > 0) return { neon: '#39ff14', core: '#eaffdf' };
  if (m.myPoints !== undefined && m.myPoints < 0) return { neon: '#ff3b5c', core: '#ffe1e6' };
  const team = nflTeamColor(m.teamAbbr ?? '') ?? '#ffb612';
  return { neon: team, core: '#ffffff' };
}

function fmt(n: number) {
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}`;
}

export function NeonTakeover({ moment, onDismiss }: { moment: RoomMoment; onDismiss: () => void }) {
  const { neon, core } = toneFor(moment);
  const word = moment.title.toUpperCase();
  const veil = useSharedValue(0);
  const frame = useSharedValue(0);
  const who = useSharedValue(0);
  const pill = useSharedValue(0);
  const halo = useSharedValue(0);
  const out = useSharedValue(1);

  useEffect(() => {
    veil.set(withTiming(1, { duration: 300 }));
    // The frame flickers on like a tube catching.
    frame.set(withDelay(150, withSequence(withTiming(1, { duration: 90 }), withTiming(0.2, { duration: 70 }), withTiming(1, { duration: 120 }))));
    halo.set(withDelay(LETTER_AT + word.length * LETTER_STEP + 200, withTiming(1, { duration: 400 })));
    who.set(withDelay(1050, withTiming(1, { duration: 450, easing: Easing.out(Easing.cubic) })));
    pill.set(withDelay(1350, withSpring(1, { damping: 9, stiffness: 180 })));
    out.set(withDelay(TAKEOVER_MS - 600, withTiming(0, { duration: 500 })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moment.id]);

  const outStyle = useAnimatedStyle(() => ({ opacity: out.get() }));
  const veilStyle = useAnimatedStyle(() => ({ opacity: veil.get() }));
  const frameStyle = useAnimatedStyle(() => ({ opacity: frame.get() }));
  const haloStyle = useAnimatedStyle(() => ({ opacity: halo.get() }));
  const whoStyle = useAnimatedStyle(() => ({ opacity: who.get(), transform: [{ translateY: 10 * (1 - who.get()) }] }));
  const pillStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, pill.get()), transform: [{ scale: 0.6 + 0.4 * pill.get() }] }));

  return (
    <Animated.View style={[styles.wrap, outStyle]}>
      <Pressable onPress={onDismiss} style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel={`${moment.title}. ${moment.detail}. Dismiss`}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.veil, veilStyle]} />
        <Animated.View style={[StyleSheet.absoluteFill, frameStyle]} pointerEvents="none">
          <GlowBox color={neon} radius={14} intensity={0.85} spread={12} style={StyleSheet.absoluteFill}>
            <View style={[StyleSheet.absoluteFill, styles.frame, { borderColor: neon }]} />
          </GlowBox>
        </Animated.View>
        <View style={styles.stage} pointerEvents="none">
          <View style={styles.wordWrap}>
            {/* The real glow, once every letter has caught. */}
            <Animated.View style={[styles.halo, haloStyle]}>
              <GlowText style={[styles.word, { color: 'transparent', textShadowColor: neon, textShadowRadius: 22 }]}>{word}</GlowText>
            </Animated.View>
            <View style={styles.letters}>
              {word.split('').map((ch, i) => (
                <Letter key={`${moment.id}-${i}`} ch={ch} delay={LETTER_AT + i * LETTER_STEP} color={core} glow={neon} />
              ))}
            </View>
          </View>
          <Animated.View style={[styles.who, whoStyle]}>
            <Text style={styles.detail} numberOfLines={2} maxFontSizeMultiplier={1.15}>
              {moment.detail}
            </Text>
            {moment.score && (
              <Text style={styles.score} maxFontSizeMultiplier={1.1}>
                {moment.score.scorer} {moment.score.scorerScore ?? ''} · {moment.score.other} {moment.score.otherScore ?? ''}
              </Text>
            )}
          </Animated.View>
          {moment.myPoints !== undefined && (
            <Animated.View style={[styles.pill, { borderColor: neon, backgroundColor: `${neon}24`, shadowColor: neon }, pillStyle]}>
              <Text style={[styles.pillText, { color: neon }]} maxFontSizeMultiplier={1.1}>
                {fmt(moment.myPoints)} for you
              </Text>
            </Animated.View>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

function Letter({ ch, delay, color, glow }: { ch: string; delay: number; color: string; glow: string }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.set(withDelay(delay, withSequence(withTiming(0.9, { duration: 120 }), withTiming(0.15, { duration: 70 }), withTiming(1, { duration: 140 }))));
  }, [v, delay]);
  const style = useAnimatedStyle(() => ({ opacity: v.get() }));
  return (
    <Animated.Text style={[styles.letter, { color, textShadowColor: glow }, style]} maxFontSizeMultiplier={1}>
      {ch}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 10, right: 10, top: 0, bottom: 0, zIndex: 20 },
  veil: { borderRadius: 14, backgroundColor: 'rgba(3,4,8,0.78)' },
  frame: { borderRadius: 14, borderWidth: 2.5 },
  stage: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 14 },
  wordWrap: { alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute' },
  word: { fontFamily: 'Anton_400Regular', fontSize: 46, letterSpacing: 1 },
  letters: { flexDirection: 'row' },
  letter: { fontFamily: 'Anton_400Regular', fontSize: 46, letterSpacing: 1, textShadowRadius: 14, textShadowOffset: { width: 0, height: 0 } },
  who: { alignItems: 'center', gap: 2 },
  detail: { color: '#f2f5fa', fontFamily: Fonts.displayBold, fontSize: 16, textAlign: 'center', letterSpacing: 0.3 },
  score: { color: '#c9d2e0', fontFamily: Fonts.monoBold, fontSize: 12 },
  pill: { marginTop: 4, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 4, shadowOpacity: 0.8, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } },
  pillText: { fontFamily: Fonts.monoBold, fontSize: 20 },
});
