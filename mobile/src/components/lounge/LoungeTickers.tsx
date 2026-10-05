import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { Text } from '@/components/Text';
import { Fonts } from '@/constants/theme';
import { useAppearance } from '@/lib/appearance';
import { clockLabel, useDelayedValue } from '@/lib/loungeLive';
import { useLeagueTicker, useNflScoreboard, useSeasonWeek } from '@/lib/queries';
import { buildLeagueTickerItems, buildNflTickerItems, type TickerItem } from '@/lib/ticker';
import type { LiveGame, NflGame } from '@/lib/types';

const PX_PER_SECOND = 28;

// The Lounge's two slim strips: NFL scores, and (signed into a league)
// this week's league scores. The game on the room's TV shows its
// delayed score — the same moment the TV is at — and the league strip
// lags by the room's delay too, so fantasy points from the TV's game
// never land before the play does.
export function LoungeTickers({ tvGame, delaySeconds }: { tvGame: LiveGame | null; delaySeconds: number }) {
  const accent = useAppearance().accent;
  const games = useNflScoreboard().data ?? [];
  const { season = null, week = null } = useSeasonWeek().data ?? {};
  const league = useDelayedValue(useLeagueTicker(season, week).data, delaySeconds) ?? [];

  const nflItems = buildNflTickerItems(games.map((g) => withTvScore(g, tvGame)));
  const leagueItems = buildLeagueTickerItems(league);

  return (
    <View>
      {nflItems.length > 0 && <Strip label="NFL" labelColor="#9aa3b2" items={nflItems} tint="rgba(255,255,255,0.03)" />}
      {leagueItems.length > 0 && <Strip label="LEAGUE" labelColor={accent} items={leagueItems} tint="rgba(57,255,20,0.04)" />}
    </View>
  );
}

function withTvScore(g: NflGame, tv: LiveGame | null): NflGame {
  if (!tv || g.id !== tv.game_id) return g;
  return {
    ...g,
    home_score: String(tv.home_team.score),
    away_score: String(tv.away_team.score),
    state: tv.status === 'final' ? 'post' : tv.status === 'scheduled' ? 'pre' : 'in',
    status_detail: clockLabel(tv),
  };
}

function Strip({ label, labelColor, items, tint }: { label: string; labelColor: string; items: TickerItem[]; tint: string }) {
  return (
    <View style={[styles.strip, { backgroundColor: tint }]}>
      <Text style={[styles.label, { color: labelColor }]} maxFontSizeMultiplier={1}>
        {label}
      </Text>
      <Marquee items={items} />
    </View>
  );
}

function Marquee({ items }: { items: TickerItem[] }) {
  const systemReduced = useReducedMotion();
  const appReduced = useAppearance().reducedMotion;
  const reduceMotion = systemReduced || appReduced;
  const [width, setWidth] = useState(0);
  const [viewport, setViewport] = useState(0);
  const x = useSharedValue(0);
  const scrolls = width > viewport && !reduceMotion;

  useEffect(() => {
    cancelAnimation(x);
    x.value = 0;
    if (!scrolls) return;
    x.value = withRepeat(withTiming(-width, { duration: (width / PX_PER_SECOND) * 1000, easing: Easing.linear }), -1, false);
  }, [scrolls, width, x]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  const line = (copy: number) => (
    <View style={styles.line} onLayout={copy === 0 ? (e) => setWidth(e.nativeEvent.layout.width) : undefined}>
      {items.map((item) => (
        <View key={`${copy}-${item.key}`} style={styles.item}>
          {item.segments.map((seg, i) => (
            <Text key={i} style={[styles.itemText, seg.color ? { color: seg.color, fontFamily: Fonts.monoBold } : null]} maxFontSizeMultiplier={1}>
              {seg.text}
            </Text>
          ))}
          <Text style={styles.dot} maxFontSizeMultiplier={1}>
            {'  •  '}
          </Text>
        </View>
      ))}
    </View>
  );

  return (
    <View style={styles.viewport} onLayout={(e) => setViewport(e.nativeEvent.layout.width)}>
      <Animated.View style={[styles.track, style]}>
        {line(0)}
        {scrolls && line(1)}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 30,
    paddingLeft: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  label: { fontFamily: Fonts.displayBold, fontSize: 10, letterSpacing: 1.2 },
  viewport: { flex: 1, overflow: 'hidden' },
  track: { flexDirection: 'row' },
  line: { flexDirection: 'row', flexShrink: 0 },
  item: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  itemText: { color: '#f3f4f6', fontSize: 11.5, fontFamily: Fonts.mono },
  dot: { color: '#4b5263', fontSize: 11.5 },
});
