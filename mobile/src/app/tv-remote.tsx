import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useAppearance } from '@/lib/appearance';
import { haptics } from '@/lib/haptics';
import { sendToTv } from '@/lib/tv';
import type { TvKey, TvScreen } from '@/lib/types';

// The phone as The Weekend TV's remote (2026-11-14): a D-pad that presses
// the TV's buttons in any app (the TV's remote service does the pressing),
// the Overlay button for the overlay's menu over a game, and one-tap
// "open on TV" for the screens you'd otherwise click your way to.

const SCREENS: { screen: TvScreen; label: string }[] = [
  { screen: 'home', label: 'Home' },
  { screen: 'redzone', label: 'Red Zone' },
  { screen: 'matchup', label: 'Matchup' },
  { screen: 'lounge', label: 'Lounge' },
  { screen: 'scores', label: 'Scores' },
  { screen: 'league', label: 'League' },
];

export default function TvRemoteScreen() {
  const accent = useAppearance().accent;
  const [note, setNote] = useState<string | null>(null);

  async function press(key: TvKey) {
    haptics.select();
    setNote(await sendToTv({ kind: 'key', key }));
  }

  async function open(screen: TvScreen) {
    haptics.tap();
    setNote(await sendToTv({ kind: 'open', screen }));
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
      <Stack.Screen options={{ title: 'TV remote' }} />

      <View style={styles.pad}>
        <Key label="▲" style={styles.arrow} accent={accent} onPress={() => void press('up')} />
        <View style={styles.middle}>
          <Key label="◀" style={styles.arrow} accent={accent} onPress={() => void press('left')} />
          <Pressable
            onPress={() => void press('ok')}
            accessibilityRole="button"
            accessibilityLabel="OK"
            style={({ pressed }) => [styles.ok, { borderColor: accent }, pressed && { backgroundColor: accent }]}>
            {({ pressed }) => <Text style={[styles.okText, pressed && styles.keyTextOn]}>OK</Text>}
          </Pressable>
          <Key label="▶" style={styles.arrow} accent={accent} onPress={() => void press('right')} />
        </View>
        <Key label="▼" style={styles.arrow} accent={accent} onPress={() => void press('down')} />
      </View>

      <View style={styles.row}>
        <Key label="Back" style={styles.wide} accent={accent} onPress={() => void press('back')} />
        <Key label="Home" style={styles.wide} accent={accent} onPress={() => void press('home')} />
        <Key label="Play / Pause" style={styles.wide} accent={accent} onPress={() => void press('playpause')} />
      </View>
      <Key label="Overlay menu" style={styles.overlay} accent={accent} onPress={() => void press('menu')} />
      <Text style={styles.muted}>The overlay menu over a game: score bug or Gamecast panel, which game, stream delay, sync to the snap.</Text>

      {note && <Text style={styles.note}>{note}</Text>}

      <View style={styles.gap}>
        <Text style={styles.section}>OPEN ON TV</Text>
        <View style={styles.grid}>
          {SCREENS.map((s) => (
            <Pressable
              key={s.screen}
              onPress={() => void open(s.screen)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${s.label} on TV`}
              style={({ pressed }) => [styles.chip, pressed && { borderColor: accent }]}>
              <Text style={styles.chipText}>{s.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.muted}>A game&apos;s Gamecast has its own Watch on TV button.</Text>
      </View>
    </ScrollView>
  );
}

function Key({ label, style, accent, onPress }: { label: string; style?: object; accent: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.key, style, pressed && { backgroundColor: accent }]}>
      {({ pressed }) => <Text style={[styles.keyText, pressed && styles.keyTextOn]}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.lg },
  pad: { alignItems: 'center', gap: 10, paddingVertical: Spacing.md },
  middle: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  key: {
    minHeight: 54,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrow: { width: 84, height: 64 },
  ok: { width: 96, height: 96, borderRadius: 48, borderWidth: 2, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  okText: { color: Colors.text, fontSize: 22, fontWeight: '900' },
  keyText: { color: Colors.text, fontSize: 18, fontWeight: '800' },
  keyTextOn: { color: '#06110a' },
  row: { flexDirection: 'row', gap: 10 },
  wide: { flex: 1 },
  overlay: { minHeight: 50 },
  gap: { gap: Spacing.sm },
  section: { color: '#9aa3b2', fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999, backgroundColor: Colors.surface, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  chipText: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  muted: { color: '#9aa3b2', fontSize: 12, lineHeight: 17 },
  note: { color: Colors.loss, fontSize: 14, fontWeight: '600', textAlign: 'center' },
});
