import { useIsFocused, useNavigation } from 'expo-router';
import { createContext, useContext, useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppTickerBar } from '@/components/AppTickerBar';
import { HoneycombBackground } from '@/components/HoneycombBackground';
import { NeedsLeague } from '@/components/NeedsLeague';
import { OfflineBanner } from '@/components/OfflineBanner';
import { TabHeader } from '@/components/TabHeader';
import { Colors } from '@/constants/theme';
import { useConnectivity } from '@/lib/connectivity';
import { useMe } from '@/lib/queries';

// Tapping the tab you're already on scrolls it back to the top. iOS's own
// version of that only finds a scroll view that's the first view all the
// way down, and the honeycomb and header come first here, so each tab
// hands its main list to useTabScrollRef() and the frame scrolls it.
type Scrollable = {
  scrollTo?: (options: { y: number; animated?: boolean }) => void;
  scrollToOffset?: (options: { offset: number; animated?: boolean }) => void;
};
const TabScrollContext = createContext<RefObject<Scrollable | null> | null>(null);

export function useTabScrollRef<T>(): RefObject<T | null> {
  const shared = useContext(TabScrollContext);
  const own = useRef<T>(null);
  return (shared ?? own) as RefObject<T | null>;
}

function useScrollToTopOnTabPress(ref: RefObject<Scrollable | null>) {
  const navigation = useNavigation();
  useEffect(() => {
    // 'tabPress' fires before the switch, so only a tap on the tab you're
    // already looking at scrolls.
    return (navigation as any).addListener('tabPress', () => {
      if (!navigation.isFocused()) return;
      const list = ref.current;
      if (list?.scrollToOffset) list.scrollToOffset({ offset: 0, animated: true });
      else list?.scrollTo?.({ y: 0, animated: true });
    });
  }, [navigation, ref]);
}

// Wraps each tab's screen. Native tabs paint an opaque system background
// over the app-wide honeycomb behind the navigator, so each tab draws
// its own — only while it's the tab on screen, so hidden tabs don't keep
// animating. `ticker` pins the web's "This Week, Live" strip at the top
// (Team and League — not Home, which has its own, Chat, or the Lounge, which draws its own slim strips).
export function TabFrame({ children, ticker = false }: { children: ReactNode; ticker?: boolean }) {
  const focused = useIsFocused();
  const me = useMe().data;
  const { online } = useConnectivity();
  const scrollRef = useRef<Scrollable | null>(null);
  useScrollToTopOnTabPress(scrollRef);
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
      <TabScrollContext.Provider value={scrollRef}>
        <View style={styles.flex}>{noLeague ? <NeedsLeague displayName={me.display_name} /> : children}</View>
      </TabScrollContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  flex: { flex: 1 },
  plain: { backgroundColor: Colors.bg },
});
