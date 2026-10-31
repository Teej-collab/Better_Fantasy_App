import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { AppRefreshControl } from '@/components/AppRefreshControl';
import { Elite } from '@/components/elite/Elite';
import { WeekPlate } from '@/components/league/Sections';
import { MatchupDetail } from '@/components/matchup/MatchupDetail';
import { Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { Spacing } from '@/constants/theme';
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
  const me = useMe().data;
  const start = useMatchup(Number(id));
  const currentWeek = useSeasonWeek().data?.week ?? null;

  const season = start.data?.season ?? null;
  const [week, setWeek] = useState<number | null>(null);
  const shownWeek = week ?? start.data?.week ?? null;
  const context = useMatchupContext(season, shownWeek);
  const myOwnerId = me?.owner_id ?? null;
  // Your own game is always the first chip and page; the rest follow in
  // the league's order.
  const matchups = useMemo(() => {
    const all = (context.data?.matchups ?? []).map((m) => orientMatchupForViewer(m, myOwnerId));
    const mine = (m: WeekMatchupContextItem) => myOwnerId !== null && (m.home.owner_id === myOwnerId || m.away.owner_id === myOwnerId);
    return [...all.filter(mine), ...all.filter((m) => !mine(m))];
  }, [context.data, myOwnerId]);

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
        <WeekPlate
          week={shownWeek}
          label={`${season ?? ''} · WEEK ${shownWeek}`}
          status={currentWeek === null ? '' : shownWeek === currentWeek ? '● CURRENT WEEK' : shownWeek < currentWeek ? 'PAST WEEK' : 'UPCOMING WEEK'}
          live={shownWeek === currentWeek}
          onStep={goTo}
        />
        {currentWeek !== null && shownWeek !== currentWeek && (
          <Pressable onPress={() => goTo(currentWeek)} hitSlop={6} accessibilityRole="button">
            <Text style={styles.back}>Back to Week {currentWeek} →</Text>
          </Pressable>
        )}
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
                  <Pressable
                    key={m.matchup_id}
                    onPress={() => select(i)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`${m.home.team_name} ${(m.home.score ?? 0).toFixed(1)}, ${m.away.team_name} ${(m.away.score ?? 0).toFixed(1)}`}
                    style={[styles.mini, active && styles.miniActive]}>
                    {[m.home, m.away].map((side) => (
                      <View key={side.team_id} style={styles.miniLine}>
                        <Text style={styles.miniName} numberOfLines={1}>
                          {side.team_name}
                        </Text>
                        <Text style={styles.miniScore}>{(side.score ?? 0).toFixed(1)}</Text>
                      </View>
                    ))}
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
                refreshControl={<AppRefreshControl />}>
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
  header: { alignItems: 'center', gap: 6, paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  back: { color: Elite.green, fontSize: 12, fontWeight: '600' },
  chips: { gap: 8, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  mini: { width: 128, gap: 2, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: Elite.card },
  miniActive: { borderColor: Elite.orange, shadowColor: Elite.orange, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  miniLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  miniName: { flex: 1, color: Elite.cream, fontSize: 11.5, fontWeight: '700' },
  miniScore: { color: Elite.cream, fontSize: 11.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  page: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2 },
});
