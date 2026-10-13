import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { Radius, withAlpha } from '@/constants/theme';
import type { WaiverClaim } from '@/lib/types';
import { OUTCOME } from '@/lib/waiverClaims';

// Won / Missed / Cancelled, for a finished waiver claim.
export function OutcomeChip({ status }: { status: WaiverClaim['status'] }) {
  if (status === 'pending') return null;
  const { label, color } = OUTCOME[status];
  return (
    <View style={[styles.chip, { backgroundColor: withAlpha(color, 0.14) }]}>
      <Text style={[styles.chipText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { borderRadius: Radius.pill, paddingHorizontal: 9, paddingVertical: 4 },
  chipText: { fontSize: 11, fontWeight: '700' },
});
