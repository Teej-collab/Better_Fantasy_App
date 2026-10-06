import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { TabFrame } from '@/components/TabFrame';
import { SeasonTabs } from '@/components/league/LeagueUI';
import { RulesSection } from '@/components/league/RulesSection';
import {
  ActivitySection,
  HistorySection,
  LeagueOverview,
  PowerRankingsSection,
  RivalriesSection,
  StandingsSection,
} from '@/components/league/Sections';
import { Text } from '@/components/Text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { LEAGUE_SECTION_ROUTES, trackPageView } from '@/lib/analytics';
import { useAppearance } from '@/lib/appearance';
import { queryClient, useActiveLeagueName, useSeasons } from '@/lib/queries';

// The web's LEAGUE_SUBNAV_ORDER (frontend/src/lib/navDestinations.ts).
const LEAGUE_SECTIONS = [
  { key: 'league', label: 'League' },
  { key: 'standings', label: 'Standings' },
  { key: 'powerRankings', label: 'Power Rankings' },
  { key: 'rivalries', label: 'Rivalries' },
  { key: 'rules', label: 'Rules' },
  { key: 'history', label: 'History' },
  { key: 'activity', label: 'Activity' },
] as const;

type LeagueSectionKey = (typeof LEAGUE_SECTIONS)[number]['key'];

// Sections whose content changes by season get season tabs.
const SEASONAL: LeagueSectionKey[] = ['league', 'standings', 'powerRankings'];

function LeagueScreenContent() {
  const params = useLocalSearchParams<{ section?: string }>();
  const accent = useAppearance().accent;
  const leagueName = useActiveLeagueName().data;
  const seasons = useSeasons().data ?? [];
  const latest = seasons[0] ?? null;
  // A link from Home (?section=…) picks the section until you tap
  // another pill; a newer link wins again.
  const linked = LEAGUE_SECTIONS.find((s) => s.key === params.section)?.key ?? null;
  const [choice, setChoice] = useState<{ forLink: string | null; key: LeagueSectionKey }>({ forLink: null, key: 'league' });
  const section: LeagueSectionKey = linked && choice.forLink !== linked ? linked : choice.key;
  const setSection = (key: LeagueSectionKey) => setChoice({ forLink: linked, key });
  // Each section is its own page on the web, so it's logged as one.
  const sectionRoute = LEAGUE_SECTION_ROUTES[section];
  useFocusEffect(useCallback(() => trackPageView(sectionRoute), [sectionRoute]));
  const [season, setSeason] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const shownSeason = season ?? latest;

  async function onRefresh() {
    setRefreshing(true);
    await queryClient.invalidateQueries();
    setRefreshing(false);
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent} />}>
      {leagueName && <Text style={styles.leagueName}>{leagueName}</Text>}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.subnav}>
        {LEAGUE_SECTIONS.map((s) => {
          const active = s.key === section;
          return (
            <View key={s.key} style={styles.pillGroup}>
              <Pressable
                onPress={() => {
                  haptics.select();
                  setSection(s.key);
                }}
                style={[styles.pill, active && { borderColor: accent, backgroundColor: `${accent}22` }]}>
                <Text style={[styles.pillText, active && { color: accent }]}>{s.label}</Text>
              </Pressable>
              {/* The Bracket is its own screen (3D cards, the full
                  bracket, Your Path, What-If) — the web's sub-nav has
                  it right after Standings too. */}
              {s.key === 'standings' && (
                <Pressable
                  onPress={() => {
                    haptics.tap();
                    router.push('/bracket' as Href);
                  }}
                  style={[styles.pill, styles.bracketPill]}
                  accessibilityRole="button"
                  accessibilityLabel="Open the playoff bracket">
                  <Text style={[styles.pillText, styles.bracketPillText]}>Bracket</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </ScrollView>

      {SEASONAL.includes(section) && seasons.length > 1 && (
        <SeasonTabs seasons={seasons} active={shownSeason} onSelect={setSeason} />
      )}

      <View>
        {section === 'league' && <LeagueOverview season={shownSeason} />}
        {section === 'standings' && <StandingsSection season={shownSeason} />}
        {section === 'powerRankings' && <PowerRankingsSection season={shownSeason} />}
        {section === 'rivalries' && <RivalriesSection />}
        {section === 'rules' && <RulesSection scrollTo={(y) => scrollRef.current?.scrollTo({ y, animated: true })} />}
        {section === 'history' && <HistorySection latestSeason={latest} />}
        {section === 'activity' && <ActivitySection season={latest} />}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.lg },
  leagueName: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  subnav: { gap: Spacing.sm },
  pillGroup: { flexDirection: 'row', gap: Spacing.sm },
  bracketPill: { borderColor: 'rgba(245,197,66,0.5)' },
  bracketPillText: { color: '#f5c542' },
  pill: { backgroundColor: Colors.surface, borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md, paddingVertical: 7 },
  pillText: { color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '600' },
});

export default function LeagueScreen() {
  return (
    <TabFrame ticker>
      <LeagueScreenContent />
    </TabFrame>
  );
}
