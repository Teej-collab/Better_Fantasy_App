import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { Colors, Radius } from '@/constants/theme';

export function LiveBadge() {
  return (
    <View style={styles.badge}>
      <View style={styles.dot} />
      <Text style={styles.text}>LIVE</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.live,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.live },
  text: { color: Colors.live, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
});
