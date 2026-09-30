import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card, LoadingState, MessageState } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { invalidateRosterMoves, useWaiverClaims } from '@/lib/queries';
import type { WaiverClaim } from '@/lib/types';

const STATUS_LABEL: Record<WaiverClaim['status'], string> = {
  pending: 'Pending',
  successful: 'Won',
  failed: 'Lost',
  cancelled: 'Cancelled',
};

const STATUS_COLOR: Record<WaiverClaim['status'], string> = {
  pending: Colors.accent,
  successful: Colors.win,
  failed: Colors.loss,
  cancelled: Colors.textSecondary,
};

export default function WaiversScreen() {
  const claims = useWaiverClaims();
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await claims.refetch();
    setRefreshing(false);
  }

  function confirmCancel(claim: WaiverClaim) {
    Alert.alert('Cancel this claim?', `Your claim for ${claim.add_player_name} will be withdrawn.`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel claim',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.cancelWaiverClaim(claim.id);
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            invalidateRosterMoves();
          } catch (e) {
            Alert.alert("Couldn't cancel", e instanceof Error ? e.message : 'Try again.');
          }
        },
      },
    ]);
  }

  if (claims.isPending) return <LoadingState />;
  if (claims.isError && !claims.data) return <MessageState message="Couldn't load your claims." />;
  const list = claims.data ?? [];
  if (list.length === 0) return <MessageState message="No waiver claims yet." />;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}>
      <Card style={styles.list}>
        {list.map((claim, i) => (
          <View key={claim.id} style={[styles.row, i > 0 && styles.divided]}>
            <View style={styles.text}>
              <Text style={styles.add}>+ {claim.add_player_name}</Text>
              {claim.drop_player_name && <Text style={styles.drop}>− {claim.drop_player_name}</Text>}
              {claim.failure_reason && <Text style={styles.reason}>{claim.failure_reason}</Text>}
              <Text style={styles.when}>
                {new Date(claim.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </Text>
            </View>
            <View style={styles.side}>
              <Text style={[styles.status, { color: STATUS_COLOR[claim.status] }]}>{STATUS_LABEL[claim.status]}</Text>
              {claim.status === 'pending' && (
                <Pressable onPress={() => confirmCancel(claim)} hitSlop={10}>
                  <Text style={styles.cancel}>Cancel</Text>
                </Pressable>
              )}
            </View>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2 },
  list: { padding: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', padding: Spacing.lg, gap: Spacing.md },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  text: { flex: 1, gap: 2 },
  add: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  drop: { color: Colors.textSecondary, fontSize: 14 },
  reason: { color: Colors.loss, fontSize: 12 },
  when: { color: Colors.textSecondary, fontSize: 12 },
  side: { alignItems: 'flex-end', gap: Spacing.sm },
  status: { fontSize: 13, fontWeight: '700' },
  cancel: { color: Colors.textSecondary, fontSize: 13 },
});
