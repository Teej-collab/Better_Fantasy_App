import { StyleSheet, View } from 'react-native';

import { LiveTicker } from '@/components/home/LiveTicker';
import { Text } from '@/components/Text';
import { Colors, Spacing } from '@/constants/theme';
import { useLeagueTicker, useNflScoreboard, useSeasonWeek } from '@/lib/queries';
import { buildKickoffCountdownItem, buildLeagueTickerItems, buildNflTickerItems } from '@/lib/ticker';

// Port of the web's AppTickerBar: the "This Week, Live" strips on every
// page except Home (which has its own richer tickers) and Chat. Real NFL
// scores, then this week's league scores — or, before any matchup has
// started, the NFL kickoff countdown.
export function AppTickerBar() {
  const nflGames = useNflScoreboard().data ?? [];
  const isGameDay = nflGames.some((g) => g.state === 'in');
  const { season = null, week = null } = useSeasonWeek().data ?? {};
  const leagueTicker = useLeagueTicker(season, week).data ?? [];

  const nflItems = buildNflTickerItems(nflGames);
  let leagueItems = buildLeagueTickerItems(leagueTicker);
  let leagueFast = isGameDay;
  if (leagueItems.length === 0 && week !== null) {
    const countdown = buildKickoffCountdownItem(nflGames, week);
    leagueItems = countdown ? [countdown] : [];
    leagueFast = false;
  }
  if (nflItems.length === 0 && leagueItems.length === 0) return null;

  return (
    <View style={styles.bar}>
      <View style={styles.labelRow}>
        <View style={[styles.dot, !isGameDay && styles.dotIdle]} />
        <Text style={styles.label}>This Week, Live</Text>
      </View>
      {nflItems.length > 0 && <LiveTicker items={nflItems} fast={isGameDay} />}
      {leagueItems.length > 0 && <LiveTicker items={leagueItems} fast={leagueFast} />}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { gap: 6, paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.xs },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.live },
  dotIdle: { backgroundColor: 'rgba(255,255,255,0.3)' },
  label: { color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
});
