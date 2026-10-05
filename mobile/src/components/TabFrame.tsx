import { useIsFocused } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppTickerBar } from '@/components/AppTickerBar';
import { HoneycombBackground } from '@/components/HoneycombBackground';
import { NeedsLeague } from '@/components/NeedsLeague';
import { OfflineBanner } from '@/components/OfflineBanner';
import { TabHeader } from '@/components/TabHeader';
import { Colors } from '@/constants/theme';
import { useConnectivity } from '@/lib/connectivity';
import { useMe } from '@/lib/queries';

// Wraps each tab's screen. Native tabs paint an opaque system background
// over the app-wide honeycomb behind the navigator, so each tab draws
// its own — only while it's the tab on screen, so hidden tabs don't keep
// animating. `ticker` pins the web's "This Week, Live" strip at the top
// (Team and League — not Home, which has its own, Chat, or the Lounge, which draws its own slim strips).
export function TabFrame({ children, ticker = false }: { children: ReactNode; ticker?: boolean }) {
  const focused = useIsFocused();
  const me = useMe().data;
  const { online } = useConnectivity();
  // Signed in but in no league yet: every tab is league data, so offer
  // to join or create one instead.
  const noLeague = me !== undefined && me.active_league_id === null;
  return (
    <View style={styles.frame}>
      {focused ? <HoneycombBackground /> : <View style={[StyleSheet.absoluteFill, styles.plain]} />}
      {/* Every tab's top bar: your league and your account menu. */}
      <TabHeader />
      {(ticker && !noLeague) || !online ? (
        <View>
          <OfflineBanner />
          {ticker && !noLeague && <AppTickerBar />}
        </View>
      ) : null}
      <View style={styles.flex}>{noLeague ? <NeedsLeague displayName={me.display_name} /> : children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  flex: { flex: 1 },
  plain: { backgroundColor: Colors.bg },
});
