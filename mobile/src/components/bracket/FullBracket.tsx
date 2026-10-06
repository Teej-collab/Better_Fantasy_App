import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import { GameCard, weeksLabel } from '@/components/bracket/GameCard';
import { Text } from '@/components/Text';
import { Fonts } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import type { BracketGame, PlayoffWorld, World, WorldTeam } from '@/lib/bracketEngine';

// The bracket on a phone, laid out by round (2026-10, the commissioner's
// call): Round 1 — the semis and the first ladder games — on one page,
// Round 2 — the title game, 3rd place, the placement games and the Toilet
// Bowl — a swipe away. Each card is the full GameCard, so its footer says
// where the winner and loser go.

const PAGES = [
  { title: 'Round 1', round: 1, winners: ['SF1', 'SF2'], ladder: ['C1', 'C2', 'C3', 'C4'], winnersTitle: "WINNER'S BRACKET" },
  { title: 'Round 2', round: 2, winners: ['F', '3RD'], ladder: ['C5', 'C6', 'C7', 'C8'], winnersTitle: 'CHAMPIONSHIP & 3RD' },
];

export function FullBracket({
  world,
  w,
  teams,
  records,
  me,
  onPick,
}: {
  world: PlayoffWorld;
  w: World;
  teams: Record<number, WorldTeam>;
  records: Record<number, string>;
  me: number | null;
  /** The What-If Lab: tap a team to pick them to win. */
  onPick?: (code: string, teamId: number) => void;
}) {
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const [scroller, setScroller] = useState<ScrollView | null>(null);
  const byCode: Record<string, BracketGame> = Object.fromEntries(w.games.map((g) => [g.code, g]));
  const standard = ['SF1', 'SF2', 'F', '3RD'].every((c) => byCode[c]);
  const weeksFor = (round: number) => {
    const g = w.games.find((x) => x.round === round);
    return g ? weeksLabel(g.weeks) : '';
  };
  const card = (code: string) =>
    byCode[code] ? (
      <GameCard
        key={code}
        game={byCode[code]}
        all={w.games}
        teams={teams}
        records={records}
        punishment={world.toilet_bowl_punishment}
        me={me}
        onPick={onPick ? (t) => onPick(code, t) : undefined}
      />
    ) : null;

  if (!standard) {
    return <View style={styles.page}>{w.games.map((g) => card(g.code))}</View>;
  }

  const go = (i: number) => {
    haptics.tap();
    scroller?.scrollTo({ x: i * width, animated: true });
    setPage(i);
  };
  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== page) {
      haptics.select();
      setPage(next);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.tabs}>
        {PAGES.map((pg, i) => (
          <Pressable key={pg.title} onPress={() => go(i)} style={[styles.tab, page === i && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: page === i }}>
            <Text style={[styles.tabText, page === i && styles.tabTextOn]}>
              {pg.title.toUpperCase()} · {weeksFor(pg.round)}
            </Text>
          </Pressable>
        ))}
      </View>
      <ScrollView ref={setScroller} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onEnd}>
        {PAGES.map((pg) => (
          <View key={pg.title} style={[styles.page, { width }]}>
            <Text style={[styles.sectionTitle, styles.green]}>{pg.winnersTitle}</Text>
            {pg.winners.map(card)}
            {pg.ladder.some((c) => byCode[c]) && (
              <>
                <View style={styles.line} />
                <Text style={styles.sectionTitle}>CONSOLATION LADDER</Text>
                {pg.ladder.map(card)}
              </>
            )}
          </View>
        ))}
      </ScrollView>
      <View style={styles.dots}>
        {PAGES.map((pg, i) => (
          <View key={pg.title} style={[styles.dot, page === i && styles.dotOn]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  tabs: { flexDirection: 'row', marginHorizontal: 16, padding: 4, gap: 4, borderRadius: 14, backgroundColor: '#12161c', borderWidth: 1, borderColor: '#1c2027' },
  tab: { flex: 1, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: '#eceef1' },
  tabText: { fontFamily: Fonts.display, fontSize: 13, letterSpacing: 1, color: '#9aa3b2' },
  tabTextOn: { color: '#0d1016' },
  page: { paddingHorizontal: 16, gap: 12 },
  sectionTitle: { fontFamily: Fonts.displayBold, fontSize: 18, letterSpacing: 1, color: '#eceef1' },
  green: { color: '#39ff14' },
  line: { height: 2, marginVertical: 4, backgroundColor: '#39ff14', shadowColor: '#39ff14', shadowOpacity: 1, shadowRadius: 8 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#2b3340' },
  dotOn: { backgroundColor: '#eceef1', width: 18 },
});
