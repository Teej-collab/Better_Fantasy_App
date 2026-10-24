import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { NeonPanel } from '@/components/NeonPanel';
import { ShareableCard } from '@/components/ShareableCard';
import { Text } from '@/components/Text';
import { Colors, Radius, SectionColors, Spacing } from '@/constants/theme';
import { trackTap } from '@/lib/analytics';
import { haptics } from '@/lib/haptics';

// A matchup's write-ups (2026-10-22), right under the score card:
// `narrative` is the current one (the preview before kickoff, the recap
// once the week is final, none mid-game) and `preview` is the pre-game
// one, kept for good. Each is a slim card like Home's "Missed the
// recap?" that opens in place, and opening one is counted (Admin > Taps).

const PREVIEW = SectionColors.matchups;
const RECAP = SectionColors.awards;

export function MatchupWriteUps({ narrative, preview, week }: { narrative: string | null; preview: string | null; week: number }) {
  const previewIsCurrent = !!narrative && narrative === preview;
  const pregame = preview ?? (previewIsCurrent ? narrative : null);
  const recap = narrative && !previewIsCurrent ? narrative : null;
  return (
    <>
      {pregame ? (
        <WriteUpCard
          color={PREVIEW}
          kicker="🎙️ Pre-game write-up"
          sub={previewIsCurrent ? 'The hype before kickoff' : 'How it looked before kickoff'}
          text={pregame}
          target="matchup.pregame_open"
        />
      ) : null}
      {recap ? <WriteUpCard color={RECAP} kicker={`📰 Week ${week} recap`} sub="How it went down" text={recap} target="matchup.recap_open" /> : null}
    </>
  );
}

function WriteUpCard({ color, kicker, sub, text, target }: { color: string; kicker: string; sub: string; text: string; target: string }) {
  const [open, setOpen] = useState(false);
  const panel = (
    <NeonPanel color={color} contentStyle={styles.card}>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={[styles.kicker, { color }]}>{kicker}</Text>
          <Text style={styles.sub} numberOfLines={1}>
            {sub}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            haptics.select();
            if (!open) trackTap(target);
            setOpen((v) => !v);
          }}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={open ? `Hide the ${kicker.slice(3)}` : `Read the ${kicker.slice(3)}`}
          style={({ pressed }) => [styles.pill, { backgroundColor: `${color}2e` }, pressed && styles.pressed]}>
          <Text style={styles.pillText}>{open ? 'Hide ↑' : 'Read it →'}</Text>
        </Pressable>
      </View>
      {open ? <Text style={styles.text}>{text.trim()}</Text> : null}
    </NeonPanel>
  );
  // Opened, it can go to the group chat as an image (2026-10-24).
  return open ? <ShareableCard title={`${kicker.replace(/^\W+/, '').trim()} · ${sub}`}>{panel}</ShareableCard> : panel;
}

const styles = StyleSheet.create({
  card: { gap: Spacing.sm },
  kicker: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  text: { color: 'rgba(255,255,255,0.82)', fontSize: 15, lineHeight: 22 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  sub: { color: Colors.textSecondary, fontSize: 13 },
  pill: { borderRadius: Radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  pillText: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
