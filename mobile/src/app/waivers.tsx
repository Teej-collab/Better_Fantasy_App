import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { Card, LoadingState, MessageState } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { invalidateRosterMoves, queryClient, useWaiverClaims } from '@/lib/queries';
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

// "Processes Wed, Oct 14 at 3:00 AM", in the phone's own time zone.
function processesAt(iso: string): string {
  const when = new Date(iso);
  const day = when.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `Processes ${day} at ${time}`;
}

export default function WaiversScreen() {
  const claims = useWaiverClaims();
  const [refreshing, setRefreshing] = useState(false);
  // ESPN's Waiver Claims > Edit: rank your pending claims with the arrows.
  const [editing, setEditing] = useState(false);

  async function move(claimId: number, by: -1 | 1) {
    const current = claims.data ?? [];
    const pendingIds = current.filter((c) => c.status === 'pending').map((c) => c.id);
    const from = pendingIds.indexOf(claimId);
    const to = from + by;
    if (from < 0 || to < 0 || to >= pendingIds.length) return;
    [pendingIds[from], pendingIds[to]] = [pendingIds[to], pendingIds[from]];
    const byId = new Map(current.map((c) => [c.id, c]));
    queryClient.setQueryData<WaiverClaim[]>(['waiver-claims'], [
      ...pendingIds.map((id) => byId.get(id)!),
      ...current.filter((c) => c.status !== 'pending'),
    ]);
    void Haptics.selectionAsync();
    try {
      await api.reorderWaiverClaims(pendingIds);
    } catch (e) {
      queryClient.setQueryData<WaiverClaim[]>(['waiver-claims'], current);
      Alert.alert("Couldn't save your order", e instanceof Error ? e.message : 'Try again.');
      void claims.refetch();
    }
  }

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
  const pendingIds = list.filter((c) => c.status === 'pending').map((c) => c.id);
  const canReorder = pendingIds.length > 1;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}>
      {canReorder && (
        <View style={styles.orderBar}>
          <Text style={styles.orderHint}>
            {editing ? 'When several clear at once, your top claim goes first on your turn.' : `${pendingIds.length} pending claims`}
          </Text>
          <Pressable onPress={() => setEditing(!editing)} hitSlop={10}>
            <Text style={styles.orderButton}>{editing ? 'Done' : 'Edit order'}</Text>
          </Pressable>
        </View>
      )}
      <Card style={styles.list}>
        {list.map((claim, i) => (
          <View key={claim.id} style={[styles.row, i > 0 && styles.divided]}>
            {editing && claim.status === 'pending' && canReorder && (
              <View style={styles.arrows}>
                <Pressable
                  onPress={() => move(claim.id, -1)}
                  disabled={pendingIds.indexOf(claim.id) === 0}
                  hitSlop={6}
                  accessibilityLabel={`Move ${claim.add_player_name} up`}>
                  <Text style={[styles.arrow, pendingIds.indexOf(claim.id) === 0 && styles.arrowOff]}>▲</Text>
                </Pressable>
                <Text style={styles.rank}>{pendingIds.indexOf(claim.id) + 1}</Text>
                <Pressable
                  onPress={() => move(claim.id, 1)}
                  disabled={pendingIds.indexOf(claim.id) === pendingIds.length - 1}
                  hitSlop={6}
                  accessibilityLabel={`Move ${claim.add_player_name} down`}>
                  <Text style={[styles.arrow, pendingIds.indexOf(claim.id) === pendingIds.length - 1 && styles.arrowOff]}>▼</Text>
                </Pressable>
              </View>
            )}
            <View style={styles.text}>
              <Text style={styles.add}>+ {claim.add_player_name}</Text>
              {claim.drop_player_name && <Text style={styles.drop}>− {claim.drop_player_name}</Text>}
              {claim.failure_reason && <Text style={styles.reason}>{claim.failure_reason}</Text>}
              <Text style={styles.when}>
                {claim.status === 'pending' && claim.clears_at
                  ? processesAt(claim.clears_at)
                  : new Date(claim.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
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
  screen: { flex: 1 },
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
  orderBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md, marginBottom: Spacing.sm },
  orderHint: { flex: 1, color: Colors.textSecondary, fontSize: 12 },
  orderButton: { color: Colors.accent, fontSize: 15, fontWeight: '600' },
  arrows: { alignItems: 'center', gap: 2 },
  arrow: { color: Colors.text, fontSize: 16, paddingHorizontal: 6 },
  arrowOff: { opacity: 0.25 },
  rank: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700' },
});
