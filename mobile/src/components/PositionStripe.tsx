import { StyleSheet, View } from 'react-native';

import { positionColor } from '@/lib/positionColors';

/** The web lineup's position stripe: a thin colored bar down the left
 *  of a player row. Put it first in a row (flexDirection: 'row'). */
export function PositionStripe({ position }: { position: string | null | undefined }) {
  return <View style={[styles.stripe, { backgroundColor: positionColor(position) }]} accessibilityElementsHidden importantForAccessibility="no" />;
}

const styles = StyleSheet.create({
  stripe: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
});
