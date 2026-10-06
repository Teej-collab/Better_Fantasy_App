import { useState } from 'react';
import { Animated, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { GameCard } from '@/components/bracket/GameCard';
import { Text } from '@/components/Text';
import { Fonts } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import type { PlayoffWorld, World, WorldTeam } from '@/lib/bracketEngine';

// The phone's bracket (mockup D): swipe through the games as 3D cards —
// the one in front flat and full size, the neighbours turned away and
// dimmed. Winners and the ladder (down to the Toilet Bowl) are two
// decks. Native-driver transforms only: smooth, and light on battery.

export function Carousel({
  world,
  w,
  teams,
  records,
  me,
}: {
  world: PlayoffWorld;
  w: World;
  teams: Record<number, WorldTeam>;
  records: Record<number, string>;
  me: number | null;
}) {
  const { width } = useWindowDimensions();
  const [deck, setDeck] = useState<'winners' | 'consolation'>('winners');
  const [scrollX] = useState(() => new Animated.Value(0));
  const cardW = Math.min(300, width - 90);
  const step = cardW + 16;
  const side = (width - cardW) / 2;
  const games = w.games.filter((g) => g.bracket === deck);
  const hasLadder = w.games.some((g) => g.bracket === 'consolation');

  return (
    <View style={styles.wrap}>
      {hasLadder && (
        <View style={styles.tabs}>
          {(['winners', 'consolation'] as const).map((d) => (
            <Pressable
              key={d}
              onPress={() => {
                haptics.tap();
                scrollX.setValue(0);
                setDeck(d);
              }}
              style={[styles.tab, deck === d && styles.tabOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: deck === d }}>
              <Text style={[styles.tabText, deck === d && styles.tabTextOn]}>{d === 'winners' ? 'WINNERS' : 'LADDER + BOWL'}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <Animated.ScrollView
        key={deck}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: side, gap: 16, paddingVertical: 24 }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}>
        {games.map((g, i) => {
          const input = [(i - 1) * step, i * step, (i + 1) * step];
          const rotateY = scrollX.interpolate({ inputRange: input, outputRange: ['38deg', '0deg', '-38deg'], extrapolate: 'clamp' });
          const scale = scrollX.interpolate({ inputRange: input, outputRange: [0.86, 1, 0.86], extrapolate: 'clamp' });
          const opacity = scrollX.interpolate({ inputRange: input, outputRange: [0.55, 1, 0.55], extrapolate: 'clamp' });
          return (
            <Animated.View key={g.code} style={{ width: cardW, opacity, transform: [{ perspective: 900 }, { rotateY }, { scale }] }}>
              <GameCard game={g} all={w.games} teams={teams} records={records} punishment={world.toilet_bowl_punishment} me={me} />
            </Animated.View>
          );
        })}
      </Animated.ScrollView>
      <Text style={styles.hint}>Swipe for every game · {games.length} in this deck</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  tabs: { flexDirection: 'row', marginHorizontal: 16, padding: 4, gap: 4, borderRadius: 14, backgroundColor: '#12161c', borderWidth: 1, borderColor: '#1c2027' },
  tab: { flex: 1, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: '#eceef1' },
  tabText: { fontFamily: Fonts.display, fontSize: 14, letterSpacing: 1, color: '#9aa3b2' },
  tabTextOn: { color: '#0d1016' },
  hint: { textAlign: 'center', fontSize: 12, color: '#7f8a99' },
});
