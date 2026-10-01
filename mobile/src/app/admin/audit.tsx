import { useInfiniteQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AdminScreen, AdminSection, adminStyles as s, Divided, EmptyNote, formatWhen, Pill } from '@/components/admin/AdminUI';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Radius } from '@/constants/theme';
import { api } from '@/lib/api';

const PAGE_SIZE = 50;

// Port of the web's AdminAuditLog: every admin change, newest first. Read-only.
export default function AdminAuditScreen() {
  const q = useInfiniteQuery({
    queryKey: ['admin', 'audit'],
    queryFn: ({ pageParam }) => api.admin.audit(PAGE_SIZE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.entries.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });
  const entries = q.data?.pages.flatMap((p) => p.entries) ?? [];
  const total = q.data?.pages[q.data.pages.length - 1]?.total ?? 0;

  return (
    <AdminScreen>
      <Stack.Screen options={{ title: 'Audit Log' }} />
      {q.isPending ? (
        <LoadingState />
      ) : !q.data ? (
        <Text style={s.error}>Couldn&apos;t load the audit log.</Text>
      ) : (
        <>
          <Text style={s.small}>
            {total.toLocaleString()} admin actions recorded — granting or revoking admin, deleting users or teams, syncs, lineup changes.
            Read-only.
          </Text>
          <AdminSection title="Admin Actions">
            {entries.length === 0 ? (
              <EmptyNote>No admin actions recorded yet. They&apos;ll show up here as they happen.</EmptyNote>
            ) : (
              entries.map((e, i) => (
                <Divided key={e.id} index={i}>
                  <View style={s.between}>
                    <Text style={[s.medium, s.flex]}>{e.action}</Text>
                    <Text style={s.small}>{formatWhen(e.created_at)}</Text>
                  </View>
                  <View style={[s.row, { flexWrap: 'wrap', gap: 6 }]}>
                    <Text style={s.small}>by </Text>
                    {e.actor_user_id ? (
                      <Pressable onPress={() => router.push({ pathname: '/admin/users/[id]', params: { id: String(e.actor_user_id) } })}>
                        <Text style={[s.small, { color: s.link.color }]}>{e.actor ?? `user ${e.actor_user_id}`}</Text>
                      </Pressable>
                    ) : (
                      <Text style={s.small}>unknown</Text>
                    )}
                    {e.target && <Text style={s.small}>· {e.target}</Text>}
                    <Pill>{e.method}</Pill>
                    <Text style={[s.mono, s.small]}>{e.path}</Text>
                  </View>
                </Divided>
              ))
            )}
            {q.hasNextPage && (
              <Pressable onPress={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} style={[styles.more, q.isFetchingNextPage && { opacity: 0.5 }]}>
                <Text style={s.small}>{q.isFetchingNextPage ? 'Loading…' : 'Load more'}</Text>
              </Pressable>
            )}
          </AdminSection>
        </>
      )}
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  more: { alignSelf: 'center', borderRadius: Radius.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 12, paddingVertical: 4 },
});
