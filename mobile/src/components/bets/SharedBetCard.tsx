import { StyleSheet, View } from 'react-native';

import { BetCard } from '@/components/bets/BetCard';
import { Text } from '@/components/Text';
import { SkeletonBlock } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useSharedBet } from '@/lib/queries';

// A bet shared to league chat (messages.bet_id), loaded live so its legs
// keep moving with the games. Once the bettor makes it private again —
// or deletes it — the card says so instead.
export function SharedBetCard({ betId, mine }: { betId: number; mine: boolean }) {
  const q = useSharedBet(betId);
  if (q.isError) {
    return (
      <View style={styles.gone}>
        <Text style={styles.goneText}>🎟️ This bet isn&apos;t shared anymore.</Text>
      </View>
    );
  }
  if (!q.data) return <SkeletonBlock height={96} width={260} />;
  return (
    <View style={styles.wrap}>
      <BetCard bet={q.data} shared={!mine} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 280, maxWidth: '100%', marginVertical: Spacing.xs },
  gone: { borderRadius: Radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: Colors.border, paddingHorizontal: 10, paddingVertical: 8, marginVertical: Spacing.xs },
  goneText: { color: Colors.textSecondary, fontSize: 12 },
});
