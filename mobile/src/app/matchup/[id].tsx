import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { MatchupDetail } from '@/components/matchup/MatchupDetail';
import { Text } from '@/components/Text';
import { LoadingState, MessageState, TeamAvatar } from '@/components/ui';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useAppearance } from '@/lib/appearance';
import { orientMatchupForViewer } from '@/lib/matchups';
import { useMatchup, useMatchupContext, useMe, useSeasonWeek } from '@/lib/queries';
import type { WeekMatchupContextItem } from '@/lib/types';

const MAX_WEEK = 17;

// Port of the web's matchup page (MatchupWeekBrowser + MatchupCarousel):
// a week stepper, a row of matchup chips, and every matchup that week
// as a swipeable page, the viewer's own team always on the left.
export default function MatchupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const appearance = useAppearance();
  const me = useMe().data;
  const start = useMatchup(Number(id));
  const currentWeek = useSeasonWeek().data?.week ?? null;

  const season = start.data?.season ?? null;
  const [week, setWeek] = useState<number | null>(null);
  const shownWeek = week ?? start.data?.week ?? null;
  const context = useMatchupContext(season, shownWeek);
  const myOwnerId = me?.owner_id ?? null;
  const matchups = useMemo(
    () => (context.data?.matchups ?? []).map((m) => orientMatchupForViewer(m, myOwnerId)),
    [context.data, myOwnerId],
  );

  // Which team to stay with when the week changes: the one whose
  // matchup was on screen (the web's focusOwnerIdRef).
  const focusOwner = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<FlatList<WeekMatchupContextItem>>(null);
  const positionedFor = useRef<string | null>(null);

  useEffect(() => {
    if (matchups.length === 0 || shownWeek === null) return;
    const key = `${shownWeek}`;
    if (positionedFor.current === key) return;
    positionedFor.current = key;
    const byId = matchups.findIndex((m) => m.matchup_id === Number(id));
    const byOwner = matchups.findIndex((m) => m.home.owner_id === focusOwner.current || m.away.owner_id === focusOwner.current);
    const index = week === null ? Math.max(0, byId) : Math.max(0, byOwner);
    setActiveIndex(index);
    requestAnimationFrame(() => listRef.current?.scrollToIndex({ index, animated: false }));
  }, [matchups, shownWeek, week, id]);

  useEffect(() => {
    const active = matchups[activeIndex];
    if (active) focusOwner.current = active.home.owner_id;
  }, [activeIndex, matchups]);

  function goTo(next: number) {
    if (next < 1 || next > MAX_WEEK || next === shownWeek) return;
    setWeek(next);
  }

  function onScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    setActiveIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  }

  function select(index: number) {
    setActiveIndex(index);
    listRef.current?.scrollToIndex({ index, animated: true });
  }

  if (start.isPending) return <LoadingState />;
  if (start.isError || !start.data || shownWeek === null) return <MessageState message="Couldn't load this matchup." />;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.stepper}>
          <Pressable
            onPress={() => goTo(shownWeek - 1)}
            disabled={shownWeek <= 1}
            style={[styles.stepButton, shownWeek <= 1 && styles.disabled]}
            hitSlop={6}>
            <Text style={styles.stepArrow}>‹</Text>
          </Pressable>
          <View style={styles.weekLabel}>
            <Text style={styles.season}>{season}</Text>
            <Text style={styles.week}>Week {shownWeek}</Text>
          </View>
          <Pressable
            onPress={() => goTo(shownWeek + 1)}
            disabled={shownWeek >= MAX_WEEK}
            style={[styles.stepButton, shownWeek >= MAX_WEEK && styles.disabled]}
            hitSlop={6}>
            <Text style={styles.stepArrow}>›</Text>
          </Pressable>
        </View>
        {currentWeek !== null &&
          (shownWeek === currentWeek ? (
            <View style={[styles.statusPill, { backgroundColor: `${appearance.accent}24` }]}>
              <View style={[styles.statusDot, { backgroundColor: appearance.accent }]} />
              <Text style={[styles.statusText, { color: appearance.accent }]}>Current week</Text>
            </View>
          ) : (
            <View style={styles.statusCol}>
              <View style={styles.statusPillMuted}>
                <Text style={styles.statusTextMuted}>{shownWeek < currentWeek ? 'Past week' : 'Upcoming week'}</Text>
              </View>
              <Pressable onPress={() => goTo(currentWeek)} hitSlop={6}>
                <Text style={[styles.back, { color: appearance.accent }]}>Back to Week {currentWeek} →</Text>
              </Pressable>
            </View>
          ))}
      </View>

      {context.isPending ? (
        <LoadingState />
      ) : context.isError ? (
        <MessageState message={`Couldn't load Week ${shownWeek} — pull to try again.`} />
      ) : matchups.length === 0 ? (
        <MessageState message="No matchups for this week." />
      ) : (
        <>
          {matchups.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {matchups.map((m, i) => {
                const active = i === activeIndex;
                return (
                  <Pressable key={m.matchup_id} onPress={() => select(i)} style={[styles.chip, active && styles.chipActive]}>
                    <TeamAvatar name={m.home.owner_name} logoUrl={m.home.logo_url} size={32} />
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {active ? 'vs' : `${(m.home.score ?? 0).toFixed(0)}-${(m.away.score ?? 0).toFixed(0)}`}
                    </Text>
                    <TeamAvatar name={m.away.owner_name} logoUrl={m.away.logo_url} size={32} />
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
          <FlatList
            ref={listRef}
            data={matchups}
            keyExtractor={(m) => String(m.matchup_id)}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onScrollEnd}
            getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
            renderItem={({ item }) => (
              <ScrollView
                style={{ width }}
                contentContainerStyle={styles.page}
                refreshControl={
                  <RefreshControl refreshing={context.isRefetching} onRefresh={() => context.refetch()} tintColor={appearance.accent} />
                }>
                <MatchupDetail matchup={item} />
              </ScrollView>
            )}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  stepButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  disabled: { opacity: 0.25 },
  stepArrow: { color: Colors.text, fontSize: 22, lineHeight: 24 },
  weekLabel: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm, paddingHorizontal: Spacing.md },
  season: { fontFamily: Fonts.display, color: 'rgba(255,255,255,0.5)', fontSize: 12, textTransform: 'uppercase' },
  week: { fontFamily: Fonts.display, color: Colors.text, fontSize: 18, textTransform: 'uppercase', letterSpacing: 0.5 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 2 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  statusCol: { alignItems: 'flex-end', gap: 4 },
  statusPillMuted: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 2 },
  statusTextMuted: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  back: { fontSize: 12, fontWeight: '600' },
  chips: { gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: Colors.tileRaised,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
  },
  chipActive: { borderColor: 'rgba(255,255,255,0.4)', backgroundColor: 'rgba(255,255,255,0.1)' },
  chipText: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  chipTextActive: { color: 'rgba(255,255,255,0.4)' },
  page: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2 },
});
