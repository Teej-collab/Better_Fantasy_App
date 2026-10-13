import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { OutcomeChip } from '@/components/players/OutcomeChip';
import { ReorderableClaims } from '@/components/players/ReorderableClaims';
import { Text } from '@/components/Text';
import { Card, LoadingState, MessageState } from '@/components/ui';
import { Colors, Radius, Spacing, withAlpha } from '@/constants/theme';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { invalidateRosterMoves, queryClient, useWaiverClaims } from '@/lib/queries';
import type { WaiverClaim, WaiverClaimsResponse } from '@/lib/types';
import { lastRun, nextClear, pastClaims, pendingClaims, shortWhen } from '@/lib/waiverClaims';

/**
 * My claims (Option B, 2026-10-13): the claims still in line up top —
 * hold the grip and drag to rank them — then how the last waiver run
 * went, with everything older one tap away on Past claims.
 */
export default function WaiversScreen() {
  const claims = useWaiverClaims();
  const [refreshing, setRefreshing] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function reorder(pendingIds: number[]) {
    const current = claims.data;
    if (!current) return;
    const byId = new Map(current.claims.map((c) => [c.id, c]));
    queryClient.setQueryData<WaiverClaimsResponse>(['waiver-claims'], {
      ...current,
      claims: [...pendingIds.map((id) => byId.get(id)!), ...current.claims.filter((c) => c.status !== 'pending')],
    });
    try {
      await api.reorderWaiverClaims(pendingIds);
    } catch (e) {
      queryClient.setQueryData<WaiverClaimsResponse>(['waiver-claims'], current);
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
    haptics.warning();
    Alert.alert('Cancel this claim?', `Your claim for ${claim.add_player_name} will be withdrawn.`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel claim',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.cancelWaiverClaim(claim.id);
            haptics.success();
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
  const all = claims.data?.claims ?? [];
  const priority = claims.data?.priority ?? null;
  const pending = pendingClaims(all);
  const past = pastClaims(all);
  const recent = lastRun(all);
  const clears = nextClear(pending);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      scrollEnabled={!dragging}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.kicker}>{clears ? `Up next · ${shortWhen(clears)}` : 'Up next'}</Text>
          <Text style={styles.title}>
            {pending.length === 0 ? 'No claims in line' : `${pending.length} claim${pending.length === 1 ? '' : 's'} in line`}
          </Text>
        </View>
        {priority && (
          <View style={styles.priority} accessibilityLabel={`Waiver priority ${priority.rank} of ${priority.of}`}>
            <Text style={styles.priorityText}>Priority #{priority.rank}</Text>
          </View>
        )}
      </View>

      {pending.length > 0 ? (
        <>
          <Card style={styles.listCard}>
            <ReorderableClaims claims={pending} onReorder={reorder} onCancel={confirmCancel} onDragChange={setDragging} />
          </Card>
          <Text style={styles.hint}>
            {pending.length > 1 ? 'Hold ≡ and drag to rank. Your #1 goes first on your turn. ' : ''}
            Swipe left to cancel.
          </Text>
        </>
      ) : (
        <Card style={styles.empty}>
          <Text style={styles.emptyText}>Put in a claim on any player on waivers from the Players tab.</Text>
        </Card>
      )}

      {recent.length > 0 && (
        <Card style={styles.runCard}>
          <Text style={styles.cardKicker}>Last run · {shortWhen(recent[0].processed_at!)}</Text>
          {recent.map((c) => (
            <View key={c.id} style={styles.runRow}>
              <View style={styles.runText}>
                <Text style={styles.runName} numberOfLines={1}>
                  {c.add_player_name}
                </Text>
                {c.status === 'failed' && c.failure_reason && (
                  <Text style={styles.runReason} numberOfLines={1}>
                    {c.failure_reason}
                  </Text>
                )}
              </View>
              <OutcomeChip status={c.status} />
            </View>
          ))}
        </Card>
      )}

      {past.length > 0 && (
        <Pressable
          style={({ pressed }) => [styles.pastRow, pressed && styles.pressed]}
          onPress={() => {
            haptics.tap();
            router.push('/waiver-history');
          }}
          accessibilityRole="button">
          <Text style={styles.pastText}>
            All past claims <Text style={styles.pastCount}>· {past.length}</Text>
          </Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.md },
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: Spacing.md },
  headerText: { flex: 1, gap: 2 },
  kicker: { color: Colors.accent, fontSize: 11, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase' },
  title: { color: Colors.text, fontSize: 22, fontWeight: '700' },
  priority: { backgroundColor: withAlpha(Colors.accent, 0.14), borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  priorityText: { color: Colors.accent, fontSize: 12, fontWeight: '700' },
  listCard: { padding: 4 },
  hint: { color: Colors.textSecondary, fontSize: 12, marginTop: -4 },
  empty: { padding: Spacing.lg },
  emptyText: { color: Colors.textSecondary, fontSize: 14 },
  runCard: { padding: Spacing.lg, gap: Spacing.sm },
  cardKicker: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase' },
  runRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md, minHeight: 32 },
  runText: { flex: 1, gap: 1 },
  runName: { color: Colors.text, fontSize: 14 },
  runReason: { color: Colors.textSecondary, fontSize: 12 },
  pastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  pressed: { opacity: 0.7 },
  pastText: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  pastCount: { color: Colors.textSecondary, fontWeight: '500' },
  chevron: { color: Colors.textSecondary, fontSize: 22 },
});
