import { useIsFocused } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppTickerBar } from '@/components/AppTickerBar';
import { HoneycombBackground } from '@/components/HoneycombBackground';
import { Colors } from '@/constants/theme';

// Wraps each tab's screen. Native tabs paint an opaque system background
// over the app-wide honeycomb behind the navigator, so each tab draws
// its own — only while it's the tab on screen, so hidden tabs don't keep
// animating. `ticker` pins the web's "This Week, Live" strip at the top
// (Team, Players, League — not Home, which has its own, or Chat).
export function TabFrame({ children, ticker = false }: { children: ReactNode; ticker?: boolean }) {
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.frame}>
      {focused ? <HoneycombBackground /> : <View style={[StyleSheet.absoluteFill, styles.plain]} />}
      {ticker && (
        <View style={{ paddingTop: insets.top }}>
          <AppTickerBar />
        </View>
      )}
      <View style={styles.flex}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  flex: { flex: 1 },
  plain: { backgroundColor: Colors.bg },
});
