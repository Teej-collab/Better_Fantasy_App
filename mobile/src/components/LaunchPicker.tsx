import { StyleSheet, View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppTickerBar } from '@/components/AppTickerBar';
import { HoneycombBackground } from '@/components/HoneycombBackground';
import { LeaguePicker } from '@/components/start/LeaguePicker';

// The cold-open front screen: what the intro's bloom reveals, sitting
// over the (already-mounted) tabs until a league is picked — so a cold
// open never lands inside a league first. The NFL ticker rides along
// the top. Picking a league fades this away onto its Home; Join and
// Create hide it and open their own screens.
export function LaunchPicker({ onDismiss }: { onDismiss: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Animated.View exiting={FadeOut.duration(250)} style={[StyleSheet.absoluteFill, { paddingTop: insets.top }]}>
      <HoneycombBackground />
      <AppTickerBar nflOnly />
      <View style={styles.body}>
        <LeaguePicker onOpened={onDismiss} onLeave={onDismiss} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
});
