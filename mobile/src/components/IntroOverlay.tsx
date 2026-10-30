import { setAudioModeAsync, createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { GlowText } from '@/components/fx/Glow';
import { IntroSeasonDecor } from '@/components/IntroSeasonDecor';
import { haptics } from '@/lib/haptics';
import { takeFullIntro } from '@/lib/introSound';
import { currentSeason } from '@/lib/seasonal';
import { hasSkia } from '@/lib/skia';
import { Text } from '@/components/Text';
import { Brand, Colors } from '@/constants/theme';

// Port of the web's "Welcome Back" boot sequence (HomeWelcomeBackEntry.tsx
// + useWeekendIntro.ts + useIntroSound.ts + the .wl-* rules in
// globals.css), played on a cold launch: a dark beat, then WELCOME / TO /
// THE igniting one at a time like stadium lights (a light-switch click
// each), then the WEEKEND neon with "The" in script above it, a can
// cracking open and a pour, "Welcome Back", and finally the scene
// rushing away into a bloom of light that reveals the app. With Skia
// (build 10 on) the can opening lands the Hive Toss instead of the
// WEEKEND wordmark, so the full show ends like every quick open.
//
// mode "enter" is the signed-out front door (the web's
// OpeningExperience.tsx): the same build-up, but the final beat is the
// tagline and a neon Enter Here sign, with `footer` (the scores ticker)
// along the bottom; tapping Enter Here plays the bloom and calls onDone.

const WORDS = ['WELCOME', 'TO', 'THE'];
// Each word ignites a little quicker than the last.
const WORD_INTERVALS_MS = [1300, 1150, 1000];
const WORD_FLICKER_MS = [1150, 1000, 850];
const INITIAL_DARK_BEAT_MS = 300;
const HOLD_MS = 3600;
const FAST_HOLD_MS = 150;
const REVEAL_MS = 900;
const CAN_OPENING_MS = 1100;
const HANDOFF_MS = 450;

// The brand green, never the user's accent: the opening looks the same
// for everyone, whatever their theme (2026-10-28).
const ACCENT = Brand.green;
const THE_BLUE = '#5cc6ff';

// 'toss': the full intro's finale is the Hive Toss (2026-10-30), on
// builds with Skia; others keep the WEEKEND wordmark ('final').
type Stage = 'dark' | 'word' | 'final' | 'toss';

// A neon tube "igniting": flicker, surge, settle — the web's
// wl-word-power-on keyframes as opacity steps over `duration`.
function flickerOn(duration: number) {
  const at = (pct: number, prev: number) => ((pct - prev) / 100) * duration;
  return withSequence(
    withTiming(0.55, { duration: at(6, 0) }),
    withTiming(0.05, { duration: at(10, 6) }),
    withTiming(0.9, { duration: at(18, 10) }),
    withTiming(0.2, { duration: at(24, 18) }),
    withTiming(1, { duration: at(35, 24) }),
  );
}

// The web's wl-weekend-power-on (1.8s), then wl-neon-buzz forever.
function weekendPowerOn() {
  const d = 1800;
  const at = (pct: number, prev: number) => ((pct - prev) / 100) * d;
  return withSequence(
    withTiming(0.6, { duration: at(8, 0) }),
    withTiming(0.05, { duration: at(13, 8) }),
    withTiming(0.95, { duration: at(22, 13) }),
    withTiming(0.3, { duration: at(30, 22) }),
    withTiming(1, { duration: at(42, 30) }),
    withTiming(0.8, { duration: at(55, 42) }),
    withTiming(1, { duration: at(70, 55) }),
    withDelay(
      at(100, 70),
      withRepeat(
        withSequence(
          withDelay(4600, withTiming(0.86, { duration: 50 })),
          withTiming(1, { duration: 50 }),
          withTiming(0.9, { duration: 100 }),
          withTiming(1, { duration: 200 }),
        ),
        -1,
      ),
    ),
  );
}

function useIntroSounds(enabled: boolean) {
  const players = useRef<{ light: AudioPlayer[]; can: AudioPlayer; pour: AudioPlayer } | null>(null);
  const lightIndex = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    // Respects the ringer switch (App Store pass, 2026-10: a beer can
    // cracking open at work or in church was the wrong surprise), and
    // never stops whatever music is already playing.
    setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => {});
    // One click player per word: replaying a finished player meant a
    // seekTo(0) that hadn't landed before play(), so TO was silent
    // (2026-10-30).
    players.current = {
      light: WORDS.map(() => createAudioPlayer(require('@/assets/audio/light-switch.m4a'))),
      can: createAudioPlayer(require('@/assets/audio/can-opening.m4a')),
      pour: createAudioPlayer(require('@/assets/audio/intro-pour.m4a')),
    };
    return () => {
      const p = players.current;
      players.current = null;
      p?.light.forEach((l) => l.remove());
      p?.can.remove();
      p?.pour.remove();
    };
  }, [enabled]);

  function play(which: 'light' | 'can' | 'pour') {
    const set = players.current;
    if (!set) return;
    const p = which === 'light' ? set.light[lightIndex.current++ % set.light.length] : set[which];
    p.seekTo(0).catch(() => {});
    // iOS refuses the audio session now and then (a call, Siri, another
    // app holding it): "Session activation failed" (2026-10-22). The
    // intro goes on silently.
    try {
      p.play();
    } catch {
      // No sound this time.
    }
  }
  return {
    // Each light switching on lands as a firm tap; the can cracking open as a success buzz.
    playLightSwitch: () => {
      haptics.thud();
      play('light');
    },
    playCanThenPour: () => {
      haptics.success();
      play('can');
      setTimeout(() => play('pour'), CAN_OPENING_MS);
    },
  };
}

type IntroProps = {
  displayName?: string | null;
  onDone: () => void;
  mode?: 'welcome' | 'enter';
  footer?: ReactNode;
};

export function IntroOverlay(props: IntroProps) {
  const reduceMotion = useReducedMotion();
  // The full show (about 8 seconds, with sound) plays on the first open
  // of the day, or per Settings > Appearance > Intro Sound. Every other
  // Welcome Back is the Hive Toss (HiveTossSkia.tsx, on builds with
  // Skia); the front door's quick version, Reduce Motion and older builds
  // keep the plain wordmark.
  const [full] = useState(() => !reduceMotion && takeFullIntro());
  if ((props.mode ?? 'welcome') === 'welcome' && !full && !reduceMotion && hasSkia) {
    // Required here, not imported: older builds have no Skia to load.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { HiveTossSkia } = require('@/components/HiveTossSkia') as typeof import('@/components/HiveTossSkia');
    return <HiveTossSkia displayName={props.displayName ?? null} onDone={props.onDone} />;
  }
  return <WordmarkIntro {...props} full={full} />;
}

// Required, not imported: older builds have no Skia to load.
function loadHiveToss(): typeof import('@/components/HiveTossSkia') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@/components/HiveTossSkia') as typeof import('@/components/HiveTossSkia');
}

function WordmarkIntro({ displayName = null, onDone, mode = 'welcome', footer, full }: IntroProps & { full: boolean }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [stage, setStage] = useState<Stage>('dark');
  const [wordIndex, setWordIndex] = useState(0);
  const [revealing, setRevealing] = useState(false);
  // The toss's canvas takes a frame or two to paint; until it has, this
  // gate stays opaque under it so the app never flashes through.
  const [tossPainted, setTossPainted] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const sounds = useIntroSounds(full);

  const ambient = useSharedValue(0);
  const word = useSharedValue(0);
  const handoff = useSharedValue(0); // THE shrinking into the coin
  const weekend = useSharedValue(0);
  const league = useSharedValue(0);
  const welcome = useSharedValue(0);
  const scene = useSharedValue(0); // 0 → 1 as the scene rushes away
  const bloom = useSharedValue(0);
  const enterSign = useSharedValue(0);
  const enterGlow = useSharedValue(0);

  function after(ms: number, fn: () => void) {
    timers.current.push(setTimeout(fn, ms));
  }

  function showFinal(fast: boolean) {
    if (!fast && mode === 'welcome' && hasSkia) {
      // The Hive Mark flips up on the can opening and the pour plays
      // under it; the toss opens the app itself.
      setStage('toss');
      sounds.playCanThenPour();
      after(400, () => setTossPainted(true));
      return;
    }
    setStage('final');
    weekend.set(fast ? withTiming(1, { duration: 200 }) : weekendPowerOn());
    league.set(withDelay(fast ? 0 : 500, withTiming(1, { duration: fast ? 200 : 1200, easing: Easing.out(Easing.quad) })));
    welcome.set(withDelay(fast ? 0 : 600, withTiming(1, { duration: fast ? 200 : 900 })));
    if (!fast) sounds.playCanThenPour();
    if (mode === 'enter') {
      // The sign rises in after the wordmark, then breathes like neon.
      enterSign.set(withDelay(fast ? 300 : 1000, withTiming(1, { duration: 700 })));
      enterGlow.set(
        withDelay(
          fast ? 1000 : 1700,
          withRepeat(
            withSequence(
              withTiming(0.4, { duration: 830 }),
              withTiming(0.1, { duration: 180 }),
              withTiming(0.55, { duration: 830 }),
              withTiming(0.15, { duration: 1060 }),
              withTiming(0.5, { duration: 320 }),
              withTiming(0, { duration: 1380 }),
            ),
            -1,
          ),
        ),
      );
      return;
    }
    after(fast ? FAST_HOLD_MS : HOLD_MS, reveal);
  }

  function reveal() {
    setRevealing(true);
    scene.set(withTiming(1, { duration: REVEAL_MS, easing: Easing.bezier(0.6, 0, 0.9, 0.4) }));
    bloom.set(withTiming(1, { duration: REVEAL_MS, easing: Easing.bezier(0.5, 0, 0.75, 0) }));
    after(REVEAL_MS, onDone);
  }

  function skip() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (mode === 'enter') {
      // Skips to the Enter Here sign, not past it.
      if (stage !== 'final') showFinal(true);
      return;
    }
    if (stage !== 'final') showFinal(true);
    timers.current.forEach(clearTimeout);
    timers.current = [];
    reveal();
  }

  useEffect(() => {
    // Load the toss now, not on the can opening, so the switch doesn't
    // stall a frame.
    if (full && mode === 'welcome' && hasSkia) loadHiveToss();
    after(INITIAL_DARK_BEAT_MS, () => {
      ambient.set(withTiming(1, { duration: 1400 }));
      if (!full) {
        showFinal(true);
        return;
      }
      setStage('word');
      word.set(flickerOn(WORD_FLICKER_MS[0]));
      sounds.playLightSwitch(); // WELCOME
      let i = 0;
      const advance = () => {
        i++;
        if (i < WORDS.length) {
          setWordIndex(i);
          word.set(0);
          word.set(flickerOn(WORD_FLICKER_MS[i]));
          sounds.playLightSwitch(); // TO, then THE
          after(WORD_INTERVALS_MS[i], advance);
        } else {
          const last = WORD_INTERVALS_MS[WORDS.length - 1];
          if (mode === 'welcome' && hasSkia) {
            // THE pulls back and shrinks away, like it becomes the coin.
            after(last - HANDOFF_MS, () => handoff.set(withTiming(1, { duration: HANDOFF_MS, easing: Easing.in(Easing.quad) })));
          }
          after(last, () => showFinal(false));
        }
      };
      after(WORD_INTERVALS_MS[0], advance);
    });
    // Absolute backstop: the app is never stuck behind the welcome
    // intro. (The front door waits for Enter Here instead.)
    const failsafe = mode === 'welcome' ? setTimeout(onDone, 12000) : undefined;
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      clearTimeout(failsafe);
    };
    // Mount-only: the whole sequence is driven by its own timers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ambientStyle = useAnimatedStyle(() => ({ opacity: ambient.get() }));
  const wordStyle = useAnimatedStyle(() => ({
    opacity: word.get() * (1 - handoff.get()),
    transform: [{ translateY: -40 * handoff.get() }, { scale: (0.97 + 0.03 * Math.min(1, word.get())) * (1 - 0.6 * handoff.get()) }],
  }));
  const weekendStyle = useAnimatedStyle(() => ({ opacity: weekend.get() }));
  const theStyle = useAnimatedStyle(() => ({
    opacity: league.get(),
    transform: [{ translateY: 8 * (1 - league.get()) }, { rotate: `${-10 + 3 * league.get()}deg` }],
  }));
  // Orange in October, ice blue in winter, like the logo.
  const season = currentSeason();
  const seasonTint = season === 'Halloween' ? styles.theHalloween : season === 'Winter' ? styles.theWinter : null;
  const welcomeStyle = useAnimatedStyle(() => ({
    opacity: welcome.get(),
    transform: [{ translateY: 10 * (1 - welcome.get()) }],
  }));
  const sceneStyle = useAnimatedStyle(() => ({
    opacity: 1 - scene.get(),
    transform: [{ translateY: -0.06 * height * scene.get() }, { scale: 1 + 0.6 * scene.get() }],
  }));
  const signStyle = useAnimatedStyle(() => ({ opacity: enterSign.get(), transform: [{ translateY: 8 * (1 - enterSign.get()) }] }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: enterGlow.get() }));
  const bloomSize = Math.max(width, height) * 0.4;
  const bloomStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, bloom.get() * 4),
    transform: [{ scale: 0.1 + 8.9 * bloom.get() }],
  }));

  if (stage === 'toss') {
    const { HiveTossSkia } = loadHiveToss();
    return (
      <View style={[styles.gate, tossPainted && styles.clear]} pointerEvents="box-none">
        <HiveTossSkia displayName={displayName} onDone={onDone} full />
      </View>
    );
  }

  return (
    <View style={styles.gate}>
      {/* Floodlight spill: soft green pools, brightening once the lights start. */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, ambientStyle]}>
        <Svg width={width} height={height}>
          <Defs>
            <RadialGradient id="a" cx="20%" cy="0%" r="70%">
              <Stop offset="0" stopColor={ACCENT} stopOpacity={0.09} />
              <Stop offset="1" stopColor={ACCENT} stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id="b" cx="50%" cy="115%" r="80%">
              <Stop offset="0" stopColor={ACCENT} stopOpacity={0.07} />
              <Stop offset="1" stopColor={ACCENT} stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id="c" cx="85%" cy="2%" r="65%">
              <Stop offset="0" stopColor={ACCENT} stopOpacity={0.08} />
              <Stop offset="1" stopColor={ACCENT} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width={width} height={height} fill="url(#a)" />
          <Rect width={width} height={height} fill="url(#b)" />
          <Rect width={width} height={height} fill="url(#c)" />
        </Svg>
      </Animated.View>

      <IntroSeasonDecor />

      {!revealing && (mode === 'welcome' || stage === 'word') && (
        <Pressable onPress={skip} hitSlop={12} style={[styles.skip, { top: insets.top + 8 }]}>
          <Text style={styles.skipText}>{mode === 'enter' ? 'Skip intro →' : 'Skip →'}</Text>
        </Pressable>
      )}

      <Animated.View style={[styles.scene, sceneStyle]}>
        {stage === 'word' && (
          <Animated.View key={wordIndex} style={wordStyle}>
            <GlowText style={styles.word}>{WORDS[wordIndex]}</GlowText>
          </Animated.View>
        )}
        {stage === 'final' && (
          <>
            {/* The Weekend: "The" in script settles in above the WEEKEND neon,
                just after it lights — the lit THE word turning into it. */}
            <Animated.View style={[styles.theWrap, theStyle]}>
              <GlowText style={[styles.the, seasonTint]}>The</GlowText>
            </Animated.View>
            <Animated.View style={weekendStyle}>
              <GlowText style={styles.weekend}>WEEKEND</GlowText>
            </Animated.View>
            {mode === 'welcome' ? (
              <Animated.View style={welcomeStyle}>
                <GlowText style={styles.welcome}>{`Welcome Back${displayName ? `, ${displayName}` : ''}`}</GlowText>
              </Animated.View>
            ) : (
              <>
                <Animated.View style={welcomeStyle}>
                  <Text style={styles.tagline}>Sit back. Relax. Dive into The Weekend.</Text>
                </Animated.View>
                <Animated.View style={[styles.signWrap, signStyle]}>
                  <Animated.View pointerEvents="none" style={[styles.signGlow, glowStyle]} />
                  <Pressable
                    onPress={() => {
                      if (!revealing) reveal();
                    }}
                    style={({ pressed }) => [styles.sign, pressed && styles.signPressed]}>
                    <GlowText style={styles.signText}>ENTER HERE</GlowText>
                  </Pressable>
                </Animated.View>
              </>
            )}
          </>
        )}
      </Animated.View>

      {footer && !revealing && <View style={[styles.footer, { paddingBottom: insets.bottom + 8 }]}>{footer}</View>}

      {revealing && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.bloom,
            { width: bloomSize, height: bloomSize, left: width / 2 - bloomSize / 2, top: height * 0.62 - bloomSize / 2 },
            bloomStyle,
          ]}>
          <Svg width={bloomSize} height={bloomSize}>
            <Defs>
              <RadialGradient id="bloom" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor="#f5f4ec" stopOpacity={0.95} />
                <Stop offset="0.28" stopColor={ACCENT} stopOpacity={0.55} />
                <Stop offset="0.68" stopColor={ACCENT} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={bloomSize / 2} cy={bloomSize / 2} r={bloomSize / 2} fill="url(#bloom)" />
          </Svg>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  gate: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 100, backgroundColor: Brand.bg },
  clear: { backgroundColor: 'transparent' },
  scene: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 24, transformOrigin: 'center 62%' },
  skip: { position: 'absolute', right: 20, zIndex: 10 },
  skipText: { color: 'rgba(245,244,236,0.4)', fontSize: 12 },
  word: {
    fontFamily: 'Anton_400Regular',
    fontSize: 40,
    letterSpacing: 3,
    color: '#f5f4ec',
    textShadowColor: 'rgba(57,255,20,0.6)',
    textShadowRadius: 18,
  },
  weekend: {
    fontFamily: 'Anton_400Regular',
    fontSize: 54,
    letterSpacing: 1.5,
    color: ACCENT,
    textShadowColor: 'rgba(57,255,20,0.9)',
    textShadowRadius: 22,
  },
  theWrap: { alignSelf: 'center', marginLeft: -150, marginBottom: -22 },
  the: {
    fontFamily: 'Satisfy_400Regular',
    fontSize: 52,
    lineHeight: 64,
    color: '#eaf6ff',
    textShadowColor: THE_BLUE,
    textShadowRadius: 18,
  },
  theHalloween: { color: '#ffd2a6', textShadowColor: '#ff7a1a' },
  theWinter: { color: '#eaf8ff', textShadowColor: '#5fb4ff' },
  welcome: {
    fontFamily: 'Anton_400Regular',
    fontSize: 26,
    color: ACCENT,
    textShadowColor: 'rgba(57,255,20,0.85)',
    textShadowRadius: 12,
    textAlign: 'center',
  },
  bloom: { position: 'absolute', zIndex: 20 },
  tagline: { maxWidth: 260, color: Colors.textSecondary, fontSize: 15, textAlign: 'center' },
  signWrap: { marginTop: 14 },
  signGlow: {
    position: 'absolute',
    top: -6,
    right: -6,
    bottom: -6,
    left: -6,
    borderRadius: 18,
    backgroundColor: 'rgba(57,255,20,0.08)',
    shadowColor: ACCENT,
    shadowOpacity: 1,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 },
  },
  sign: {
    borderRadius: 12,
    borderWidth: 2,
    borderColor: ACCENT,
    backgroundColor: 'rgba(6,10,7,0.85)',
    paddingHorizontal: 32,
    paddingVertical: 14,
    shadowColor: ACCENT,
    shadowOpacity: 0.8,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  signPressed: { transform: [{ scale: 0.97 }] },
  signText: {
    color: ACCENT,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 2,
    textShadowColor: ACCENT,
    textShadowRadius: 8,
  },
  footer: { position: 'absolute', left: 12, right: 12, bottom: 0, zIndex: 5 },
});
