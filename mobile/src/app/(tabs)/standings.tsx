import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card, LoadingState, MessageState } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { useSeasonWeek, useStandings } from '@/lib/queries';

export default function StandingsScreen() {
  const seasonWeek = useSeasonWeek();
  const season = seasonWeek.data?.season ?? null;
  const standings = useStandings(season);
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await standings.refetch();
    setRefreshing(false);
  }

  if (standings.isPending && !standings.data) return <LoadingState />;
  if (standings.isError && !standings.data) return <MessageState message="Couldn't load standings." />;

  const rows = standings.data?.standings ?? [];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}>
      <Text style={styles.title}>Standings</Text>
      <Card style={styles.card}>
        <View style={[styles.row, styles.headRow]}>
          <Text style={[styles.rank, styles.head]}>#</Text>
          <Text style={[styles.team, styles.head]}>Team</Text>
          <Text style={[styles.num, styles.head]}>W-L</Text>
          <Text style={[styles.num, styles.head]}>PF</Text>
        </View>
        {rows.map((row, i) => (
          <View key={row.team_id} style={[styles.row, i > 0 && styles.divided]}>
            <Text style={styles.rank}>{i + 1}</Text>
            <View style={styles.team}>
              <Text style={styles.teamName} numberOfLines={1}>
                {row.team_name}
              </Text>
              <Text style={styles.owner} numberOfLines={1}>
                {row.owner_name}
              </Text>
            </View>
            <Text style={styles.num}>
              {row.wins}-{row.losses}
              {row.ties ? `-${row.ties}` : ''}
            </Text>
            <Text style={styles.num}>{Number(row.points_for).toFixed(1)}</Text>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2 },
  title: { color: Colors.text, fontSize: 28, fontWeight: '800', marginBottom: Spacing.lg },
  card: { padding: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  headRow: { paddingVertical: Spacing.sm },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  head: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  rank: { width: 28, color: Colors.textSecondary, fontVariant: ['tabular-nums'] },
  team: { flex: 1, color: Colors.text },
  teamName: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  owner: { color: Colors.textSecondary, fontSize: 12 },
  num: { width: 64, textAlign: 'right', color: Colors.text, fontVariant: ['tabular-nums'] },
});
