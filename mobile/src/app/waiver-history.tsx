import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { OutcomeChip } from '@/components/players/OutcomeChip';
import { Text } from '@/components/Text';
import { Card, LoadingState, MessageState } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { useWaiverClaims } from '@/lib/queries';
import type { WaiverClaim } from '@/lib/types';
import { byDay, pastClaims } from '@/lib/waiverClaims';

type Filter = 'all' | 'successful' | 'failed';

// What happened to every claim you've made, newest first.
export default function WaiverHistoryScreen() {
  const claims = useWaiverClaims();
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  async function onRefresh() {
    setRefreshing(true);
    await claims.refetch();
    setRefreshing(false);
  }

  if (claims.isPending) return <LoadingState />;
  if (claims.isError && !claims.data) return <MessageState message="Couldn't load your claims." />;
  const past = pastClaims(claims.data?.claims ?? []);
  if (past.length === 0) return <MessageState message="No past claims yet." />;
  const won = past.filter((c) => c.status === 'successful').length;
  const missed = past.filter((c) => c.status === 'failed').length;
  const shown = filter === 'all' ? past : past.filter((c) => c.status === filter);

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'successful', label: `Won · ${won}` },
    { key: 'failed', label: `Missed · ${missed}` },
  ];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}>
      <View style={styles.filters}>
        {filters.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => {
              haptics.select();
              setFilter(f.key);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === f.key }}
            style={[styles.filter, filter === f.key && styles.filterOn]}>
            <Text style={[styles.filterText, filter === f.key && styles.filterTextOn]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>

      {shown.length === 0 && <Text style={styles.none}>Nothing here yet.</Text>}
      {byDay(shown).map((group) => (
        <Card key={group.day} style={styles.card}>
          <Text style={styles.day}>{group.day}</Text>
          {group.claims.map((c) => (
            <PastRow key={c.id} claim={c} />
          ))}
        </Card>
      ))}
    </ScrollView>
  );
}

function PastRow({ claim }: { claim: WaiverClaim }) {
  const detail =
    claim.status === 'failed'
      ? claim.failure_reason
      : claim.status === 'cancelled'
        ? 'You cancelled it'
        : claim.drop_player_name
          ? `Dropped ${claim.drop_player_name}`
          : null;
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {claim.add_player_name}
        </Text>
        {detail && (
          <Text style={styles.detail} numberOfLines={2}>
            {detail}
          </Text>
        )}
      </View>
      <OutcomeChip status={claim.status} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.md },
  filters: { flexDirection: 'row', gap: Spacing.sm },
  filter: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  filterOn: { backgroundColor: Colors.text, borderColor: Colors.text },
  filterText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  filterTextOn: { color: Colors.bg },
  none: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', marginTop: Spacing.lg },
  card: { padding: 0, overflow: 'hidden' },
  day: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  text: { flex: 1, gap: 2 },
  name: { color: Colors.text, fontSize: 15, fontWeight: '700' },
  detail: { color: Colors.textSecondary, fontSize: 12 },
});
