import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { Colors, withAlpha } from '@/constants/theme';
import { hasInjuryBadge, injuryShortCode } from '@/lib/matchups';

// A player's injury as ESPN shows it in a roster row: a small red Q / D /
// O / IR tag that never wraps or squeezes the name (2026-10-29:
// "Questionable" spelled out broke across two lines at larger text).
export function InjuryTag({ status }: { status: string | null | undefined }) {
  if (!hasInjuryBadge(status)) return null;
  return (
    <View style={styles.tag} accessible accessibilityLabel={status}>
      <Text style={styles.text} numberOfLines={1} maxFontSizeMultiplier={1.15}>
        {injuryShortCode(status)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: { flexShrink: 0, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5, backgroundColor: withAlpha(Colors.loss, 0.16) },
  text: { color: Colors.loss, fontSize: 11, fontWeight: '800' },
});
