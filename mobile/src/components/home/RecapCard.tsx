import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { NeonPanel } from '@/components/NeonPanel';
import { Text } from '@/components/Text';
import { Colors, Radius, SectionColors, Spacing } from '@/constants/theme';
import { trackRecapOpened } from '@/lib/analytics';
import { recapIsFresh } from '@/lib/livingHome';
import type { WeeklyNarrative } from '@/lib/types';

// The week's recap on Home. The weekly awards grid that used to sit
// under it left Home on 2026-10-16 (it was skimmed past; the awards are
// in the recap itself). In full on recap day — Tuesday from the noon PT
// drop — then a slim "Missed the recap?" card whose pill opens the
// recap's own screen. A commissioner's pre-release preview stays full.
export function RecapCard({ recap, week, season }: { recap: WeeklyNarrative; week: number; season: number }) {
  if (recap.released !== false && !recapIsFresh()) return <MissedRecap week={week} season={season} />;
  return <RecapTeaser recap={recap} week={week} season={season} />;
}

function MissedRecap({ week, season }: { week: number; season: number }) {
  return (
    <NeonPanel color={SectionColors.awards} contentStyle={styles.missed}>
      <View style={styles.missedText}>
        <Text style={[styles.recapKicker, { color: SectionColors.awards }]}>📰 Missed the recap?</Text>
        <Text style={styles.missedSub} numberOfLines={1}>
          Week {week}&apos;s story, awards and all
        </Text>
      </View>
      <Pressable
        onPress={() => router.push({ pathname: '/recap/[season]/[week]', params: { season: String(season), week: String(week) } })}
        accessibilityRole="button"
        accessibilityLabel={`Read the Week ${week} recap`}
        style={({ pressed }) => [styles.recapButton, styles.missedPill, { backgroundColor: `${SectionColors.awards}2e` }, pressed && styles.pressed]}>
        <Text style={styles.recapButtonText}>Read Week {week} →</Text>
      </Pressable>
    </NeonPanel>
  );
}

const RECAP_TEASER_MAX_CHARS = 220;

// The full card (port of the web's WeeklyRecapTeaser): a 220-character preview that
// expands in place to the full AI recap.
function RecapTeaser({ recap, week, season }: { recap: WeeklyNarrative; week: number; season: number }) {
  const [expanded, setExpanded] = useState(false);
  // Expanding it is reading it — counted once per visit for Admin > Recaps.
  const tracked = useRef(false);
  function toggle() {
    if (!expanded && !tracked.current) {
      tracked.current = true;
      trackRecapOpened(season, week, 'home');
    }
    setExpanded((v) => !v);
  }
  const full = recap.text.trim();
  const flat = full.replace(/\s+/g, ' ');
  const truncatable = flat.length > RECAP_TEASER_MAX_CHARS;
  const snippet = truncatable ? flat.slice(0, RECAP_TEASER_MAX_CHARS).replace(/\s+\S*$/, '') : flat;

  return (
    <NeonPanel color={SectionColors.awards} contentStyle={styles.recap}>
      <Text style={[styles.recapKicker, { color: SectionColors.awards }]}>📰 Week {week} Recap</Text>
      {recap.released === false && <Text style={styles.recapPreview}>Commissioner preview — goes live for the league at the Tuesday flip.</Text>}
      <Pressable onPress={toggle} style={styles.recapBody}>
        <Text style={styles.recapText}>{expanded ? full : `${snippet}${truncatable ? '…' : ''}`}</Text>
        <View style={[styles.recapButton, { backgroundColor: `${SectionColors.awards}2e` }]}>
          <Text style={styles.recapButtonText}>{expanded ? 'Show less ↑' : 'Read the full recap →'}</Text>
        </View>
      </Pressable>
    </NeonPanel>
  );
}

const styles = StyleSheet.create({
  recap: { gap: Spacing.sm },
  recapPreview: { color: '#fbbf24', fontSize: 12, borderRadius: 8, backgroundColor: 'rgba(245,158,11,0.1)', paddingHorizontal: 10, paddingVertical: 6 },
  recapKicker: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  recapBody: { gap: Spacing.sm },
  recapText: { color: 'rgba(255,255,255,0.8)', fontSize: 16, lineHeight: 24 },
  recapButton: { alignSelf: 'flex-start', borderRadius: Radius.pill, paddingHorizontal: 12, paddingVertical: 4, marginTop: 4 },
  recapButtonText: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  missed: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  missedText: { flex: 1, minWidth: 0, gap: 2 },
  missedSub: { color: Colors.textSecondary, fontSize: 13 },
  missedPill: { alignSelf: 'center', marginTop: 0 },
  pressed: { opacity: 0.7 },
});
