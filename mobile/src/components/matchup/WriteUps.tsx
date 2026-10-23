import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { NeonPanel } from '@/components/NeonPanel';
import { Text } from '@/components/Text';
import { Colors, Radius, SectionColors, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';

// A matchup's write-ups (2026-10-22): `narrative` is the current one
// (the preview before kickoff, the recap once the week is final, none
// mid-game) and `preview` is the pre-game one, kept for good. Before
// kickoff the preview shows in full; after, it folds into a slim
// "Pre-game write-up" card like Home's "Missed the recap?".

const PREVIEW = SectionColors.matchups;
const RECAP = SectionColors.awards;

export function MatchupWriteUps({ narrative, preview, week }: { narrative: string | null; preview: string | null; week: number }) {
  const previewIsCurrent = !!narrative && narrative === preview;
  return (
    <>
      {narrative ? (
        <NeonPanel color={previewIsCurrent ? PREVIEW : RECAP} contentStyle={styles.card}>
          <Text style={[styles.kicker, { color: previewIsCurrent ? PREVIEW : RECAP }]}>
            {previewIsCurrent ? '🎙️ Pre-game write-up' : `📰 Week ${week} recap`}
          </Text>
          <Text style={styles.text}>{narrative.trim()}</Text>
        </NeonPanel>
      ) : null}
      {preview && !previewIsCurrent ? <PreGameCard text={preview} /> : null}
    </>
  );
}

function PreGameCard({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <NeonPanel color={PREVIEW} contentStyle={styles.card}>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={[styles.kicker, { color: PREVIEW }]}>🎙️ Pre-game write-up</Text>
          <Text style={styles.sub} numberOfLines={1}>
            How it looked before kickoff
          </Text>
        </View>
        <Pressable
          onPress={() => {
            haptics.select();
            setOpen((v) => !v);
          }}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={open ? 'Hide the pre-game write-up' : 'Read the pre-game write-up'}
          style={({ pressed }) => [styles.pill, pressed && styles.pressed]}>
          <Text style={styles.pillText}>{open ? 'Hide ↑' : 'Read it →'}</Text>
        </Pressable>
      </View>
      {open ? <Text style={styles.text}>{text.trim()}</Text> : null}
    </NeonPanel>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.sm },
  kicker: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  text: { color: 'rgba(255,255,255,0.82)', fontSize: 15, lineHeight: 22 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  sub: { color: Colors.textSecondary, fontSize: 13 },
  pill: { borderRadius: Radius.pill, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: `${PREVIEW}2e` },
  pillText: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
