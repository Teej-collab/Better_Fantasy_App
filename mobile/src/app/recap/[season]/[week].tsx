import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ShareableCard } from '@/components/ShareableCard';
import { AppRefreshControl } from '@/components/AppRefreshControl';
import { NeonPanel } from '@/components/NeonPanel';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { SectionColors, Spacing } from '@/constants/theme';
import { trackRecapOpened } from '@/lib/analytics';
import { api } from '@/lib/api';

// One week's recap in full — the web's /seasons/[season]/weeks/[week]/
// recap, where the Tuesday-flip "Week N Recap LIVE NOW" push lands
// (`from=push`). Every visit is recorded for Admin > Recaps.
export default function RecapScreen() {
  const params = useLocalSearchParams<{ season: string; week: string; from?: string }>();
  const season = Number(params.season);
  const week = Number(params.week);
  const q = useQuery({ queryKey: ['weekly-recap-page', season, week], queryFn: () => api.weeklyRecap(season, week) });
  const recap = q.data?.narrative?.kind === 'recap' ? q.data.narrative : null;
  const source = params.from === 'push' ? 'push' : 'page';
  const color = SectionColors.awards;

  useEffect(() => {
    if (recap) trackRecapOpened(season, week, source);
  }, [recap, season, week, source]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" refreshControl={<AppRefreshControl />}>
      <Stack.Screen options={{ title: `Week ${week} Recap` }} />
      <View style={styles.weekRow}>
        <Text style={[styles.kicker, { color }]}>📰 Week {week} Recap</Text>
        {/* Step through the season's recaps (2026-10 navigation pass). */}
        <View style={styles.weekNav}>
          {week > 1 && (
            <Pressable
              onPress={() => router.setParams({ week: String(week - 1) })}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Week ${week - 1} recap`}>
              <Text style={[styles.link, { color }]}>← Wk {week - 1}</Text>
            </Pressable>
          )}
          {week < 17 && (
            <Pressable
              onPress={() => router.setParams({ week: String(week + 1) })}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Week ${week + 1} recap`}>
              <Text style={[styles.link, { color }]}>Wk {week + 1} →</Text>
            </Pressable>
          )}
        </View>
      </View>
      {q.isPending ? (
        <LoadingState />
      ) : !recap ? (
        <NeonPanel color={color} contentStyle={styles.gap}>
          <Text style={styles.heading}>Not out yet</Text>
          <Text style={styles.soft}>
            The Week {week} recap goes live when the league flips on Tuesday. You&apos;ll get a notification the moment it does.
          </Text>
          <Pressable onPress={() => router.navigate('/')} hitSlop={8}>
            <Text style={[styles.link, { color }]}>← Back to Home</Text>
          </Pressable>
        </NeonPanel>
      ) : (
        <ShareableCard title={`Week ${week} Recap`}>
        <NeonPanel color={color} contentStyle={styles.gap}>
          {recap.released === false && (
            <View style={styles.preview}>
              <Text style={styles.previewText}>Commissioner preview — this goes live for the league at the Tuesday flip.</Text>
            </View>
          )}
          <Text style={styles.body} selectable>
            {recap.text.trim()}
          </Text>
        </NeonPanel>
        </ShareableCard>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.md },
  gap: { gap: Spacing.md },
  kicker: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  weekRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  weekNav: { flexDirection: 'row', gap: Spacing.lg },
  heading: { color: '#eceef1', fontSize: 18, fontWeight: '600' },
  soft: { color: 'rgba(255,255,255,0.6)', fontSize: 14, lineHeight: 20 },
  link: { fontSize: 14, fontWeight: '500' },
  body: { color: 'rgba(255,255,255,0.85)', fontSize: 16, lineHeight: 25 },
  preview: { borderRadius: 8, backgroundColor: 'rgba(245,158,11,0.1)', paddingHorizontal: 10, paddingVertical: 6 },
  previewText: { color: '#fbbf24', fontSize: 12 },
});
