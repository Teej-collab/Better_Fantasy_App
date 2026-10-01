import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { Spacing } from '@/constants/theme';
import { useConnectivity } from '@/lib/connectivity';

function timeLabel(ms: number): string {
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
}

// "You're offline — showing data from 2:14 PM": shown at the top of
// every screen while the backend can't be reached (lib/connectivity.ts).
// Screens keep showing what they last loaded; it clears itself the
// moment the connection comes back and everything refreshes.
export function OfflineBanner() {
  const { online, lastOnlineAt } = useConnectivity();
  if (online) return null;
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.text}>
        You&apos;re offline — {lastOnlineAt ? `showing data from ${timeLabel(lastOnlineAt)}` : 'showing saved data'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: '#3a2a0a', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(245,158,11,0.5)', paddingHorizontal: Spacing.lg, paddingVertical: 7 },
  text: { color: '#fbbf24', fontSize: 13, fontWeight: '600', textAlign: 'center' },
});
