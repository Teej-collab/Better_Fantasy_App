import { router, Stack } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppRefreshControl } from '@/components/AppRefreshControl';
import { Display, Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { QueueHeader, QueueList } from '@/components/warroom/QueueList';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { useWarRoom } from '@/lib/queries';

// The War Room's Queue page (2026-10-28 mockup): who you've lined up,
// in big readable cards, with each one's chance of lasting to your next
// pick. Players are added from the draft room's Players tab.

export default function DraftQueueScreen() {
  const q = useWarRoom();
  if (q.isPending) return <LoadingState />;
  if (!q.data) return <MessageState message="Couldn't load your queue." actionLabel="Try again" onAction={() => void q.refetch()} />;
  const draft = q.data.draft;
  const items = draft.queue_full ?? [];
  const live = draft.status === 'in_progress' || draft.status === 'paused';

  function addPlayers() {
    haptics.tap();
    router.push('/draft');
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" refreshControl={<AppRefreshControl />}>
      <Stack.Screen options={{ title: 'Your Queue' }} />
      <View style={styles.titleRow}>
        <Display style={styles.title}>Your Queue</Display>
        <Pressable onPress={addPlayers} accessibilityRole="button" style={({ pressed }) => [styles.add, pressed && styles.pressed]}>
          <Text style={styles.addText}>+ Add players</Text>
        </Pressable>
      </View>
      <QueueHeader draft={draft} />
      {items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nobody queued yet</Text>
          <Text style={styles.muted}>Star players in the draft room&apos;s Players tab and they line up here, in the order you want them.</Text>
        </View>
      ) : (
        <QueueList items={items} />
      )}
      <Text style={styles.muted}>Use the arrows to reorder. If your clock runs out, autopick takes your top player who&apos;s still there.</Text>
      {live && (
        <Pressable onPress={addPlayers} accessibilityRole="button" style={({ pressed }) => [styles.enter, pressed && styles.pressed]}>
          <Text style={styles.enterText}>The draft is live: enter the draft room</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, flexWrap: 'wrap' },
  title: { color: Colors.text, fontSize: 30 },
  add: { minHeight: 40, borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.accent, paddingHorizontal: 14, justifyContent: 'center' },
  addText: { color: Colors.accent, fontSize: 14, fontWeight: '700' },
  empty: { borderRadius: Radius.lg, borderWidth: 1, borderStyle: 'dashed', borderColor: Colors.border, padding: Spacing.lg, gap: 6, alignItems: 'center' },
  emptyTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' },
  muted: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  enter: { minHeight: 48, borderRadius: Radius.pill, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg },
  enterText: { color: '#0d1016', fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.7 },
});
