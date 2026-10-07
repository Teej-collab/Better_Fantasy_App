import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg';

import { Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { Colors, Fonts, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { queryClient, useActiveLeague, usePunishmentWheel } from '@/lib/queries';
import type { PunishmentWheel } from '@/lib/types';

// The Punishment Wheel (2026-10). It turns slowly, game-show style, until
// a commissioner spins it; the server picks where it lands
// (backend/app/routers/punishment_wheel.py) and every phone animates to
// that same answer — live over the chat socket for anyone watching, and
// as a one-time replay for anyone opening it after the spin.

const COLORS = ['#1f9e0b', '#6d28d9', '#ea580c', '#0e7490', '#be123c', '#ca8a04', '#4338ca', '#15803d', '#9d174d', '#0369a1', '#7c2d12', '#155e75'];
const SIZE = 330;
const R = SIZE / 2;
const SPIN_MS = 5200;
const IDLE_LAP_MS = 45_000;

function slicePath(i: number, n: number): string {
  const a0 = ((i * 360) / n - 90) * (Math.PI / 180);
  const a1 = (((i + 1) * 360) / n - 90) * (Math.PI / 180);
  const large = 360 / n > 180 ? 1 : 0;
  return `M${R},${R} L${R + R * Math.cos(a0)},${R + R * Math.sin(a0)} A${R},${R} 0 ${large} 1 ${R + R * Math.cos(a1)},${R + R * Math.sin(a1)} Z`;
}

// A rotation past `from` (five or more full turns) that puts segment
// `index` under the pointer at the top.
function landing(from: number, index: number, count: number): number {
  const seg = 360 / count;
  const jitter = (Math.random() - 0.5) * seg * 0.6;
  const center = index * seg + seg / 2 + jitter;
  const base = Math.ceil((from + 5 * 360) / 360) * 360;
  return base + ((360 - (center % 360)) % 360);
}

function restingAngle(index: number, count: number): number {
  const seg = 360 / count;
  return (360 - ((index * seg + seg / 2) % 360)) % 360;
}

// Labels run from the hub out to the rim, wrapped onto up to three lines
// and sized by how many slices there are, so they stay readable.
const HUB_CLEAR = 44;
const RIM_CLEAR = 14;

function labelStyle(n: number): { fontSize: number; maxLines: number } {
  const fontSize = n <= 4 ? 14 : n <= 6 ? 13 : n <= 9 ? 12 : 11;
  // As many lines as fit across the slice near the hub, where it's narrowest.
  const chord = 2 * (HUB_CLEAR + 8) * Math.sin(Math.PI / Math.max(n, 2));
  const maxLines = Math.max(1, Math.min(4, Math.floor(chord / (fontSize * 1.15))));
  return { fontSize, maxLines };
}

function wrapLabel(text: string, maxChars: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.trim().split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  const clipped = lines.slice(0, maxLines).map((l) => (l.length > maxChars ? `${l.slice(0, maxChars - 1)}…` : l));
  if (lines.length > maxLines) {
    // Cut at a word break and drop trailing punctuation before the ellipsis.
    let last = clipped[maxLines - 1].replace(/…$/, '').slice(0, maxChars - 1);
    if (last.includes(' ')) last = last.slice(0, last.lastIndexOf(' '));
    clipped[maxLines - 1] = `${last.replace(/[\s.,;:!?-]+$/, '')}…`;
  }
  return clipped;
}

function WheelFace({ items }: { items: string[] }) {
  const n = Math.max(items.length, 1);
  const { fontSize, maxLines } = labelStyle(n);
  const band = R - HUB_CLEAR - RIM_CLEAR;
  const maxChars = Math.max(6, Math.floor(band / (fontSize * 0.6)));
  const lineHeight = fontSize * 1.15;
  const mid = HUB_CLEAR + band / 2;
  return (
    <Svg width={SIZE} height={SIZE}>
      {items.length === 0 ? <Circle cx={R} cy={R} r={R} fill="#191d23" /> : null}
      {items.map((text, i) => (
        <Path key={`s-${i}`} d={slicePath(i, n)} fill={COLORS[i % COLORS.length]} stroke="rgba(0,0,0,0.35)" strokeWidth={1.5} />
      ))}
      {items.map((text, i) => {
        const lines = wrapLabel(text, maxChars, maxLines);
        return (
          <G key={`t-${i}`} rotation={(i * 360) / n + 180 / n - 90} origin={`${R}, ${R}`}>
            {lines.map((line, k) => {
              const y = R + (k - (lines.length - 1) / 2) * lineHeight + fontSize * 0.35;
              // A dark outline copy underneath keeps white text legible on every color.
              return (
                <G key={k}>
                  <SvgText x={R + mid} y={y} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={3} strokeLinejoin="round" fontSize={fontSize} fontWeight="800" textAnchor="middle">
                    {line}
                  </SvgText>
                  <SvgText x={R + mid} y={y} fill="#ffffff" fontSize={fontSize} fontWeight="800" textAnchor="middle">
                    {line}
                  </SvgText>
                </G>
              );
            })}
          </G>
        );
      })}
    </Svg>
  );
}

export default function PunishmentWheelScreen() {
  const wheel = usePunishmentWheel();
  const leagueId = useActiveLeague().data?.id ?? null;
  const rotation = useSharedValue(0);
  const [phase, setPhase] = useState<'idle' | 'spinning' | 'replaying' | 'done'>('idle');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const handled = useRef<string | null>(null);
  const scroller = useRef<ScrollView>(null);
  const inputY = useRef(0);

  const data = wheel.data;
  const result = data?.result ?? null;
  const faceItems = result ? result.items : (data?.items.map((i) => i.text) ?? []);

  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.get()}deg` }] }));

  function onLanded(key: string) {
    haptics.success();
    setPhase('done');
    void AsyncStorage.setItem(key, '1').catch(() => {});
  }

  // Idle: a slow lap every 45 seconds until there's a result.
  useEffect(() => {
    if (result || phase !== 'idle') return;
    const start = rotation.get() % 360;
    rotation.set(start);
    rotation.set(withRepeat(withTiming(start + 360, { duration: IDLE_LAP_MS, easing: Easing.linear }), -1, false));
    return () => cancelAnimation(rotation);
  }, [result, phase, rotation]);

  // A result arrived: play the spin once for this phone (live, or the
  // replay for anyone opening it after), or just show where it landed.
  useEffect(() => {
    if (!result || leagueId === null) return;
    const key = `wl:wheel-seen:${leagueId}:${data?.season}:${result.spun_at}`;
    if (handled.current === key) return;
    handled.current = key;
    let cancelled = false;
    void (async () => {
      const seen = await AsyncStorage.getItem(key).catch(() => null);
      if (cancelled) return;
      const count = result.items.length;
      if (seen) {
        cancelAnimation(rotation);
        rotation.set(restingAngle(result.landed_index, count));
        setPhase('done');
        return;
      }
      const live = phase === 'spinning';
      if (!live) setPhase('replaying');
      const go = () => {
        cancelAnimation(rotation);
        const from = rotation.get();
        rotation.set(
          withTiming(landing(from, result.landed_index, count), { duration: SPIN_MS, easing: Easing.bezier(0.12, 0.62, 0.08, 1) }, (finished) => {
            if (finished) runOnJS(onLanded)(key);
          }),
        );
      };
      if (live) go();
      else setTimeout(go, 900);
    })();
    return () => {
      cancelled = true;
    };
    // Runs once per result; `phase` is read, not tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, leagueId]);

  async function run(action: () => Promise<PunishmentWheel>) {
    setBusy(true);
    try {
      queryClient.setQueryData(['punishment-wheel'], await action());
    } catch (e) {
      Alert.alert("Couldn't update the wheel", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  // Spinning is final for the season, so it asks first.
  function confirmSpin() {
    if (!data) return;
    Alert.alert(
      `Spin for ${data.season}?`,
      "Wherever it lands is locked in as this season's punishment. You can't re-spin or change the wheel after.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Spin it', style: 'destructive', onPress: () => void spin() },
      ],
    );
  }

  async function spin() {
    haptics.thud();
    setPhase('spinning');
    try {
      queryClient.setQueryData(['punishment-wheel'], await api.spinPunishmentWheel());
    } catch (e) {
      setPhase('idle');
      Alert.alert("Couldn't spin the wheel", e instanceof Error ? e.message : undefined);
    }
  }

  if (wheel.isPending) return <LoadingState />;
  if (!data) return <MessageState message="Couldn't load the wheel." />;
  const revealed = result && phase === 'done';

  return (
    <ScrollView
      ref={scroller}
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive">
      <Stack.Screen options={{ title: 'Punishment Wheel' }} />
      <View style={styles.head}>
        <Text style={styles.kicker}>{`${data.season} SEASON`}</Text>
        <Text style={styles.title}>PUNISHMENT WHEEL</Text>
      </View>

      <View style={styles.stage}>
        <View style={styles.pointer} />
        <View style={styles.tilt}>
          <View style={styles.depth} />
          <Animated.View style={[styles.face, spinStyle]}>
            <WheelFace items={faceItems} />
          </Animated.View>
          <View style={styles.hub}>
            <Text style={styles.hubText}>THE{'\n'}WEEKEND</Text>
          </View>
        </View>
      </View>

      {phase === 'replaying' && <Text style={styles.replayNote}>You missed the spin — here&apos;s how it went…</Text>}

      {revealed && result && (
        <View style={styles.result} accessibilityLiveRegion="polite">
          <Text style={styles.resultKicker}>{`THE WHEEL HAS SPOKEN · ${data.season} PUNISHMENT`}</Text>
          <Text style={styles.resultText}>{result.text}</Text>
          <Text style={styles.resultMeta}>
            {`Locked for the ${data.season} season${result.spun_by ? ` · spun by ${result.spun_by}` : ''} · the league loser owes it`}
          </Text>
        </View>
      )}

      {!result && data.is_commissioner && (
        <Pressable
          onPress={confirmSpin}
          disabled={!data.can_spin || phase === 'spinning'}
          style={({ pressed }) => [styles.spin, (!data.can_spin || phase === 'spinning') && styles.spinOff, pressed && styles.pressed]}>
          <Text style={[styles.spinText, (!data.can_spin || phase === 'spinning') && styles.spinTextOff]}>
            {phase === 'spinning' ? 'SPINNING…' : data.items.length < 2 ? 'ADD AT LEAST 2' : `SPIN FOR ${data.season}`}
          </Text>
        </Pressable>
      )}
      {!result && !data.is_commissioner && <Text style={styles.memberNote}>Only the commissioner can spin the wheel.</Text>}

      <View style={styles.listHead}>
        <Text style={styles.listTitle}>{`ON THE WHEEL (${faceItems.length})`}</Text>
        <Text style={styles.listNote}>{result ? `Locked for ${data.season}` : 'Anyone in the league can add one'}</Text>
      </View>
      {data.can_edit && (
        <View style={styles.addRow} onLayout={(e) => (inputY.current = e.nativeEvent.layout.y)}>
          <TextInput
            onFocus={() => setTimeout(() => scroller.current?.scrollTo({ y: Math.max(inputY.current - 160, 0), animated: true }), 250)}
            returnKeyType="done"
            value={draft}
            onChangeText={setDraft}
            placeholder="Add a punishment…"
            placeholderTextColor="#6b7280"
            maxLength={80}
            style={styles.input}
            accessibilityLabel="New punishment"
            onSubmitEditing={() => draft.trim() && void run(() => api.addPunishment(draft.trim())).then(() => setDraft(''))}
          />
          <Pressable
            onPress={() => void run(() => api.addPunishment(draft.trim())).then(() => setDraft(''))}
            disabled={!draft.trim() || busy}
            style={({ pressed }) => [styles.add, (!draft.trim() || busy) && styles.dim, pressed && styles.pressed]}>
            {busy ? <ActivityIndicator color="#06110a" /> : <Text style={styles.addText}>Add</Text>}
          </Pressable>
        </View>
      )}
      <View style={styles.list}>
        {(result ? result.items.map((text, i) => ({ id: i, text, can_remove: false })) : data.items).map((item, i) => (
          <View key={item.id} style={[styles.row, i > 0 && styles.divided]}>
            <View style={[styles.swatch, { backgroundColor: COLORS[i % COLORS.length] }]} />
            <Text style={styles.rowText} numberOfLines={1}>
              {item.text}
            </Text>
            {item.can_remove && (
              <Pressable onPress={() => void run(() => api.removePunishment(item.id))} hitSlop={8} accessibilityLabel={`Remove ${item.text}`} style={styles.remove}>
                <Text style={styles.removeText}>×</Text>
              </Pressable>
            )}
          </View>
        ))}
        {faceItems.length === 0 && <Text style={styles.empty}>Nothing on the wheel yet.</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0d1016' },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.md },
  head: { gap: 2 },
  kicker: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
  title: { color: Colors.text, fontFamily: Fonts.display, fontSize: 28, letterSpacing: 1 },
  stage: { height: 340, alignItems: 'center', justifyContent: 'center' },
  pointer: {
    position: 'absolute',
    top: 4,
    zIndex: 3,
    width: 0,
    height: 0,
    borderLeftWidth: 14,
    borderRightWidth: 14,
    borderTopWidth: 26,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#39ff14',
    shadowColor: '#39ff14',
    shadowOpacity: 0.9,
    shadowRadius: 8,
  },
  tilt: { width: SIZE, height: SIZE, transform: [{ perspective: 900 }, { rotateX: '16deg' }] },
  depth: { position: 'absolute', width: SIZE, height: SIZE, borderRadius: R, backgroundColor: '#05070a', top: 14, shadowColor: '#000', shadowOpacity: 0.7, shadowRadius: 24, shadowOffset: { width: 0, height: 20 } },
  face: {
    width: SIZE,
    height: SIZE,
    borderRadius: R,
    overflow: 'hidden',
    borderWidth: 6,
    borderColor: '#39ff14',
    shadowColor: '#39ff14',
    shadowOpacity: 0.5,
    shadowRadius: 14,
  },
  hub: {
    position: 'absolute',
    left: R - 32,
    top: R - 32,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#0b0d12',
    borderWidth: 3,
    borderColor: '#39ff14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hubText: { color: '#39ff14', fontFamily: Fonts.display, fontSize: 9, letterSpacing: 1, textAlign: 'center', lineHeight: 10 },
  replayNote: { color: '#e9d5ff', fontSize: 13, fontWeight: '600', textAlign: 'center', padding: 12, borderRadius: 14, borderWidth: 1, borderColor: '#a855f7', backgroundColor: '#1b1230', overflow: 'hidden' },
  result: { borderRadius: 18, borderWidth: 1, borderColor: 'rgba(57,255,20,0.5)', backgroundColor: '#13201a', padding: 16, gap: 6 },
  resultKicker: { color: '#39ff14', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  resultText: { color: Colors.text, fontFamily: Fonts.display, fontSize: 21, lineHeight: 26 },
  resultMeta: { color: Colors.textSecondary, fontSize: 12 },
  spin: { height: 56, borderRadius: 16, borderWidth: 2, borderColor: '#39ff14', backgroundColor: '#39ff14', alignItems: 'center', justifyContent: 'center', shadowColor: '#39ff14', shadowOpacity: 0.5, shadowRadius: 14 },
  spinOff: { backgroundColor: 'transparent', shadowOpacity: 0 },
  spinText: { color: '#06110a', fontFamily: Fonts.display, fontSize: 19, letterSpacing: 2 },
  spinTextOff: { color: '#39ff14', opacity: 0.7 },
  memberNote: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600', textAlign: 'center', padding: 14, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: '#2a303a' },
  listHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: Spacing.sm },
  listTitle: { color: Colors.textSecondary, fontFamily: Fonts.display, fontSize: 13, letterSpacing: 1.5 },
  listNote: { color: '#6b7280', fontSize: 11 },
  addRow: { flexDirection: 'row', gap: Spacing.sm },
  input: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1, borderColor: '#2a303a', backgroundColor: '#12161c', color: Colors.text, paddingHorizontal: 12, fontSize: 15 },
  add: { height: 44, paddingHorizontal: 18, borderRadius: 12, backgroundColor: '#39ff14', alignItems: 'center', justifyContent: 'center' },
  addText: { color: '#06110a', fontSize: 15, fontWeight: '700' },
  list: { borderRadius: 14, backgroundColor: '#12161c', borderWidth: 1, borderColor: '#1c2027', overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, minHeight: 44 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1c2027' },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  rowText: { flex: 1, color: Colors.text, fontSize: 14 },
  remove: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  removeText: { color: Colors.textSecondary, fontSize: 20 },
  empty: { color: Colors.textSecondary, fontSize: 13, padding: 14 },
  dim: { opacity: 0.5 },
  pressed: { opacity: 0.7 },
});
