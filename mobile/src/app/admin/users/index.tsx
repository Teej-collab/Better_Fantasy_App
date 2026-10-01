import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ADMIN_ACCENT, AdminScreen, adminStyles as s, relativeTime, RoleBadge } from '@/components/admin/AdminUI';
import { NeonPanel } from '@/components/NeonPanel';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import type { AdminUserStatus } from '@/lib/adminTypes';

const STATUS_TABS: { key: AdminUserStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Inactive' },
  { key: 'new', label: 'New' },
  { key: 'commissioner', label: 'Commissioner' },
  { key: 'multiple_leagues', label: 'Multiple Leagues' },
  { key: 'no_league', label: 'No League' },
];

const SEARCH_DEBOUNCE_MS = 300;

// Port of the web's AdminUsers.
export default function AdminUsersScreen() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<AdminUserStatus>('all');
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [search]);
  const q = useQuery({ queryKey: ['admin', 'users', debounced, status], queryFn: () => api.admin.users(debounced, status), placeholderData: keepPreviousData });

  return (
    <AdminScreen>
      <Stack.Screen options={{ title: 'Users' }} />
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search by name, email, or user ID…"
        placeholderTextColor="rgba(255,255,255,0.4)"
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.search}
      />
      {q.data && <Text style={s.small}>{q.data.total} total</Text>}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {STATUS_TABS.map((t) => (
          <Pressable key={t.key} onPress={() => setStatus(t.key)} style={[styles.tab, status === t.key && styles.tabActive]}>
            <Text style={[styles.tabText, status === t.key && { color: ADMIN_ACCENT }]}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {!q.data ? (
        <LoadingState />
      ) : (
        <NeonPanel color={ADMIN_ACCENT} radius={Radius.md} contentStyle={[styles.list, q.isFetching && { opacity: 0.5 }]}>
          {q.data.users.length === 0 ? (
            <Text style={[s.small, { padding: Spacing.lg }]}>No users match this filter.</Text>
          ) : (
            q.data.users.map((u, i) => (
              <Pressable
                key={u.user_id}
                onPress={() => router.push({ pathname: '/admin/users/[id]', params: { id: String(u.user_id) } })}
                style={({ pressed }) => [styles.row, i > 0 && styles.divided, pressed && styles.pressed]}>
                <View style={s.flex}>
                  <View style={[s.row, { flexWrap: 'wrap', gap: 6 }]}>
                    <Text style={s.medium}>{u.display_name}</Text>
                    {u.is_commissioner_anywhere && <RoleBadge label="Commissioner" />}
                    {u.is_admin && <RoleBadge label="Admin" green />}
                  </View>
                  <Text style={s.small}>
                    {u.email ?? 'No email'} · {u.league_count} league{u.league_count === 1 ? '' : 's'}
                  </Text>
                </View>
                <View>
                  <Text style={[s.small, s.right]}>Joined {relativeTime(u.created_at)}</Text>
                  <Text style={[s.small, s.right]}>{u.last_active ? `Active ${relativeTime(u.last_active)}` : 'Never active'}</Text>
                </View>
              </Pressable>
            ))
          )}
        </NeonPanel>
      )}
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  search: { backgroundColor: Colors.surface,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    color: Colors.text,
    fontSize: 14,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
  },
  tabs: { gap: 6 },
  tab: { backgroundColor: Colors.surface, borderRadius: Radius.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 10, paddingVertical: 4 },
  tabActive: { borderColor: ADMIN_ACCENT, backgroundColor: 'rgba(56,189,248,0.12)' },
  tabText: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '500' },
  list: { padding: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.md, paddingVertical: 10 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.06)' },
  pressed: { backgroundColor: 'rgba(255,255,255,0.05)' },
});
