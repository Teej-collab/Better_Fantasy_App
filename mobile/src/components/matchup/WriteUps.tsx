import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Elite, EliteCard, eliteText, SATISFY } from '@/components/elite/Elite';
import { ShareableCard } from '@/components/ShareableCard';
import { Text } from '@/components/Text';
import { Radius, Spacing } from '@/constants/theme';
import { trackTap } from '@/lib/analytics';
import { haptics } from '@/lib/haptics';

// A matchup's write-ups (2026-10-22), right under the score card:
// `narrative` is the current one (the preview before kickoff, the recap
// once the week is final, none mid-game) and `preview` is the pre-game
// one, kept for good. Each is a slim card like Home's "Missed the
// recap?" that opens in place, and opening one is counted (Admin > Taps).
// Elite pass (2026-10-31): a script title, like the booth's.

export function MatchupWriteUps({ narrative, preview, week }: { narrative: string | null; preview: string | null; week: number }) {
  const previewIsCurrent = !!narrative && narrative === preview;
  const pregame = preview ?? (previewIsCurrent ? narrative : null);
  const recap = narrative && !previewIsCurrent ? narrative : null;
  return (
    <>
      {pregame ? (
        <WriteUpCard
          title="The Preview"
          sub={previewIsCurrent ? 'The hype before kickoff' : 'How it looked before kickoff'}
          text={pregame}
          target="matchup.pregame_open"
        />
      ) : null}
      {recap ? <WriteUpCard title={`The Week ${week} Recap`} sub="How it went down" text={recap} target="matchup.recap_open" /> : null}
    </>
  );
}

function WriteUpCard({ title, sub, text, target }: { title: string; sub: string; text: string; target: string }) {
  const [open, setOpen] = useState(false);
  const panel = (
    <EliteCard style={styles.card}>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.title}>{title}</Text>
          <Text style={eliteText.small} numberOfLines={1}>
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
          accessibilityLabel={open ? `Hide ${title.toLowerCase()}` : `Read ${title.toLowerCase()}`}
          style={({ pressed }) => [styles.pill, pressed && styles.pressed]}>
          <Text style={styles.pillText}>{open ? 'Hide ↑' : 'Read it →'}</Text>
        </Pressable>
      </View>
      {open ? <Text style={styles.text}>{text.trim()}</Text> : null}
    </EliteCard>
  );
  // Opened, it can go to the group chat as an image (2026-10-24).
  return open ? <ShareableCard title={`${title} · ${sub}`}>{panel}</ShareableCard> : panel;
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: Spacing.sm },
  title: { fontFamily: SATISFY, fontSize: 22, lineHeight: 28, color: Elite.peach },
  text: { color: 'rgba(245,244,236,0.85)', fontSize: 15, lineHeight: 22 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  rowText: { flex: 1, minWidth: 0 },
  pill: { minHeight: 36, justifyContent: 'center', borderRadius: Radius.pill, borderWidth: 1, borderColor: 'rgba(57,255,20,0.45)', backgroundColor: 'rgba(57,255,20,0.08)', paddingHorizontal: 12 },
  pillText: { color: Elite.green, fontSize: 14, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});
