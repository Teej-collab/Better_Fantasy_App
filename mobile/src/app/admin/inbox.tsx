import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { InboxCard, useInbox } from '@/components/admin/AdminInbox';
import { AdminScreen, EmptyNote, adminStyles as s } from '@/components/admin/AdminUI';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Colors, Radius } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import type { AdminInboxItem } from '@/lib/adminTypes';

// Admin › Inbox (2026-10-28, mockup B): one feed of what needs a person,
// filtered by Open, Mine, each other admin who has claimed something,
// and Done.

type Filter = { key: string; label: string; test: (i: AdminInboxItem) => boolean };

export default function AdminInboxScreen() {
  const inbox = useInbox();
  const [filter, setFilter] = useState('open');

  const me = inbox.data?.me ?? 0;
  const items = inbox.data?.items ?? [];
  const others = [...new Map(items.filter((i) => !i.done && i.claimed_by && i.claimed_by.user_id !== me).map((i) => [i.claimed_by!.user_id, i.claimed_by!.name])).entries()];
  const filters: Filter[] = [
    { key: 'open', label: 'Open', test: (i) => !i.done },
    { key: 'mine', label: 'Mine', test: (i) => !i.done && i.claimed_by?.user_id === me },
    ...others.map(([id, name]) => ({ key: `u${id}`, label: name.split(' ')[0], test: (i: AdminInboxItem) => !i.done && i.claimed_by?.user_id === id })),
    { key: 'done', label: 'Done', test: (i) => i.done },
  ];
  const active = filters.find((f) => f.key === filter) ?? filters[0];
  const shown = items.filter(active.test);

  return (
    <AdminScreen>
      <Stack.Screen options={{ title: 'Inbox', headerBackTitle: 'Admin' }} />
      <Text style={s.small}>Everything that needs a person, from the last two weeks. Claim it so you two don&apos;t double up.</Text>
      <View style={styles.segment}>
        {filters.map((f) => {
          const count = f.key === 'done' ? 0 : items.filter(f.test).length;
          const on = f.key === active.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => {
                haptics.select();
                setFilter(f.key);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              style={[styles.segmentItem, on && styles.segmentOn]}>
              <Text style={[styles.segmentText, on && styles.segmentTextOn]} numberOfLines={1}>
                {f.label}
                {count > 0 ? ` ${count}` : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {inbox.isPending ? (
        <LoadingState />
      ) : inbox.isError ? (
        <Text style={s.error}>Couldn&apos;t load the inbox. Pull to refresh.</Text>
      ) : shown.length === 0 ? (
        <EmptyNote>{active.key === 'done' ? 'Nothing marked done yet.' : 'All clear. Nothing needs a person.'}</EmptyNote>
      ) : (
        shown.map((item) => <InboxCard key={`${item.kind}:${item.ref}`} item={item} me={me} />)
      )}
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', gap: 4, padding: 3, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  segmentItem: { flex: 1, minHeight: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  segmentOn: { backgroundColor: 'rgba(255,255,255,0.1)' },
  segmentText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '700' },
  segmentTextOn: { color: Colors.text },
});
