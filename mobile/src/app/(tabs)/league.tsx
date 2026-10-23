import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { TabFrame, useTabScrollRef } from '@/components/TabFrame';
import { LeagueHub } from '@/components/league/LeagueHub';
import { SeasonTabs } from '@/components/league/LeagueUI';
import { SwipeBack } from '@/components/league/SwipeBack';
import { RulesSection } from '@/components/league/RulesSection';
import { ScoringSection } from '@/components/league/ScoringSection';
import {
  ActivitySection,
  HistorySection,
  LeagueOverview,
  PowerRankingsSection,
  RivalriesSection,
  StandingsSection,
} from '@/components/league/Sections';
import { Text } from '@/components/Text';
import { Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { LEAGUE_SECTION_ROUTES, trackPageView, trackTap } from '@/lib/analytics';
import { useAppearance } from '@/lib/appearance';
import { queryClient, useActiveLeagueName, useSeasons } from '@/lib/queries';
import { useTabBarScroll } from '@/lib/tabBar';

// The web's LEAGUE_SUBNAV_ORDER (frontend/src/lib/navDestinations.ts),
// opened from the hub's cards (2026-10-22, League page mockup C) rather
// than a chip row that scrolled two of them off screen.
const LEAGUE_SECTIONS = [
  { key: 'league', label: 'Teams' },
  { key: 'standings', label: 'Standings' },
  { key: 'powerRankings', label: 'Power Rankings' },
  { key: 'rivalries', label: 'Rivalries' },
  { key: 'scoring', label: 'Scoring' },
  { key: 'rules', label: 'Rules' },
  { key: 'history', label: 'History' },
  { key: 'activity', label: 'Activity' },
] as const;

type LeagueSectionKey = (typeof LEAGUE_SECTIONS)[number]['key'] | 'hub';

// Sections whose content changes by season get season tabs.
const SEASONAL: LeagueSectionKey[] = ['league', 'standings', 'powerRankings'];

function LeagueScreenContent() {
  // ?view=playoffs (+ a shared what-if's w) opens Standings → Playoffs.
  const params = useLocalSearchParams<{ section?: string; view?: string; w?: string }>();
  const accent = useAppearance().accent;
  const leagueName = useActiveLeagueName().data;
  const seasons = useSeasons().data ?? [];
  const latest = seasons[0] ?? null;
  // A link from Home (?section=…) picks the section until you tap
  // another pill; a newer link wins again.
  const linked = LEAGUE_SECTIONS.find((s) => s.key === params.section)?.key ?? null;
  const [choice, setChoice] = useState<{ forLink: string | null; key: LeagueSectionKey }>({ forLink: null, key: 'hub' });
  const section: LeagueSectionKey = linked && choice.forLink !== linked ? linked : choice.key;
  const setSection = (key: LeagueSectionKey) => setChoice({ forLink: linked, key });
  // Each section is its own page on the web, so it's logged as one.
  const sectionRoute = LEAGUE_SECTION_ROUTES[section === 'hub' ? 'league' : section];
  useFocusEffect(useCallback(() => trackPageView(sectionRoute), [sectionRoute]));
  const [season, setSeason] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useTabScrollRef<ScrollView>();
  const tabBarScroll = useTabBarScroll();
  const shownSeason = season ?? latest;
  // Back to the hub, from "‹ League" or a swipe from the left edge.
  const backToHub = useCallback(() => {
    setChoice({ forLink: linked, key: 'hub' });
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [linked, scrollRef]);
  const swipedBack = useCallback(() => {
    haptics.select();
    trackTap('league.swipe_back');
    backToHub();
  }, [backToHub]);

  async function onRefresh() {
    setRefreshing(true);
    await queryClient.invalidateQueries();
    setRefreshing(false);
  }

  return (
    <SwipeBack enabled={section !== 'hub'} onBack={swipedBack}>
      <ScrollView
        ref={scrollRef}
        {...tabBarScroll}
        style={styles.screen}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent} />}>
        {leagueName && <Text style={styles.leagueName}>{leagueName}</Text>}
        {section !== 'hub' && (
          <View style={styles.sectionHead}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to League"
              hitSlop={12}
              onPress={() => {
                haptics.select();
                backToHub();
              }}>
              <Text style={[styles.back, { color: accent }]}>‹ League</Text>
            </Pressable>
            <Text style={styles.sectionTitle}>{LEAGUE_SECTIONS.find((s) => s.key === section)?.label}</Text>
          </View>
        )}

        {SEASONAL.includes(section) && seasons.length > 1 && (
          <SeasonTabs seasons={seasons} active={shownSeason} onSelect={setSeason} />
        )}

        <View>
          {section === 'hub' && (
            <LeagueHub
              season={latest}
              onOpen={(key) => {
                setSection(key);
                scrollRef.current?.scrollTo({ y: 0, animated: false });
              }}
            />
          )}
          {section === 'league' && <LeagueOverview season={shownSeason} />}
          {section === 'standings' && <StandingsSection key={params.w ?? params.view ?? 'standings'} season={shownSeason} initialView={params.view} whatIf={params.w} />}
          {section === 'powerRankings' && <PowerRankingsSection season={shownSeason} />}
          {section === 'rivalries' && <RivalriesSection />}
          {section === 'scoring' && <ScoringSection />}
          {section === 'rules' && <RulesSection scrollTo={(y) => scrollRef.current?.scrollTo({ y, animated: true })} />}
          {section === 'history' && <HistorySection latestSeason={latest} />}
          {section === 'activity' && <ActivitySection season={latest} />}
        </View>
      </ScrollView>
    </SwipeBack>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.lg },
  leagueName: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  sectionHead: { gap: Spacing.xs },
  back: { fontSize: 15, fontWeight: '600' },
  sectionTitle: { fontSize: 28, fontWeight: '800' },
});

export default function LeagueScreen() {
  return (
    <TabFrame ticker>
      <LeagueScreenContent />
    </TabFrame>
  );
}
