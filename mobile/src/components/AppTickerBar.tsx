import { StyleSheet, View } from 'react-native';

import { TickerStrips } from '@/components/TickerStrips';
import { Spacing } from '@/constants/theme';
import { useLeagueTicker, useNflScoreboard, useSeasonWeek } from '@/lib/queries';
import { buildKickoffCountdownItem, buildLeagueTickerItems, buildNflTickerItems } from '@/lib/ticker';

// Port of the web's AppTickerBar: the "This Week, Live" strips on every
// page except Home (which has its own richer tickers) and Chat. Real NFL
// scores, then this week's league scores — or, before any matchup has
// started, the NFL kickoff countdown. nflOnly drops the league strip
// for screens outside any one league (the league picker).
export function AppTickerBar({ nflOnly = false }: { nflOnly?: boolean }) {
  const nflGames = useNflScoreboard().data ?? [];
  const isGameDay = nflGames.some((g) => g.state === 'in');
  const { season = null, week = null } = useSeasonWeek().data ?? {};
  const leagueTicker = useLeagueTicker(season, week).data ?? [];

  const nflItems = buildNflTickerItems(nflGames);
  let leagueItems = buildLeagueTickerItems(leagueTicker);
  let leagueFast = isGameDay;
  if (nflOnly) leagueItems = [];
  else if (leagueItems.length === 0 && week !== null) {
    const countdown = buildKickoffCountdownItem(nflGames, week);
    leagueItems = countdown ? [countdown] : [];
    leagueFast = false;
  }
  if (nflItems.length === 0 && leagueItems.length === 0) return null;

  return (
    // The Lounge's look (2026-10): strips labelled NFL and LEAGUE —
    // still swipeable and tappable (TickerStrips).
    <View style={styles.bar}>
      <TickerStrips nfl={nflItems} league={leagueItems} fast={isGameDay} leagueFast={leagueFast} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.xs },
});
