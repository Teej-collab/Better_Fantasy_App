import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ADMIN_ACCENT, AdminScreen, adminStyles as s, relativeTime } from '@/components/admin/AdminUI';
import { NeonPanel } from '@/components/NeonPanel';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';

// Port of the web's AdminLeagues.
export default function AdminLeaguesScreen() {
  const q = useQuery({ queryKey: ['admin', 'leagues'], queryFn: () => api.admin.leagues(7) });
  const data = q.data;
  return (
    <AdminScreen>
      <Stack.Screen options={{ title: 'Leagues' }} />
      {!data ? (
        q.isPending ? <LoadingState /> : <Text style={s.error}>Couldn&apos;t load leagues.</Text>
      ) : (
        <>
          <Text style={s.small}>
            Activity is approximated from each league&apos;s own members&apos; overall usage over the last {data.window_days} days — not
            exact per-event league attribution yet (see ADMIN_DASHBOARD.md).
          </Text>
          <NeonPanel color={ADMIN_ACCENT} radius={Radius.md} contentStyle={{ padding: 0 }}>
            {data.leagues.length === 0 ? (
              <Text style={[s.small, { padding: Spacing.lg }]}>No leagues yet.</Text>
            ) : (
              data.leagues.map((l, i) => (
                <Pressable
                  key={l.id}
                  onPress={() => router.push({ pathname: '/admin/leagues/[id]', params: { id: String(l.id) } })}
                  style={({ pressed }) => [styles.row, i > 0 && styles.divided, pressed && styles.pressed]}>
                  <View style={s.flex}>
                    <Text style={s.medium}>{l.name}</Text>
                    <Text style={s.small}>
                      {l.member_count} member{l.member_count === 1 ? '' : 's'} · created {relativeTime(l.created_at)}
                    </Text>
                  </View>
                  <View style={[styles.chip, l.recent_events > 0 ? styles.chipActive : styles.chipQuiet]}>
                    <Text style={[styles.chipText, { color: l.recent_events > 0 ? '#34d399' : 'rgba(255,255,255,0.5)' }]}>
                      {l.recent_events > 0 ? `${l.recent_events} events` : 'Quiet'}
                    </Text>
                  </View>
                </Pressable>
              ))
            )}
          </NeonPanel>
        </>
      )}
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.md, paddingVertical: 10 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.06)' },
  pressed: { backgroundColor: 'rgba(255,255,255,0.05)' },
  chip: { borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  chipActive: { backgroundColor: 'rgba(16,185,129,0.15)' },
  chipQuiet: { backgroundColor: 'rgba(255,255,255,0.1)' },
  chipText: { fontSize: 12, fontWeight: '500' },
});
