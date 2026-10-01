import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ADMIN_ACCENT, AdminScreen, AdminSection, adminStyles as s, Divided, EmptyNote, relativeTime, RoleBadge, StatTile, TileGrid } from '@/components/admin/AdminUI';
import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { eventLabel } from '@/lib/analyticsEvents';
import { queryClient } from '@/lib/queries';
import type { AdminUserDetail } from '@/lib/adminTypes';

// Port of the web's AdminUserDetail. The backend never sends password
// hashes, tokens or push credentials, so there's nothing to leak here.
export default function AdminUserScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = Number(id);
  const q = useQuery({ queryKey: ['admin', 'user', userId], queryFn: () => api.admin.user(userId) });
  return (
    <AdminScreen>
      <Stack.Screen options={{ title: q.data?.display_name ?? 'User' }} />
      {!q.data ? q.isPending ? <LoadingState /> : <Text style={s.error}>Couldn&apos;t load this user.</Text> : <Detail user={q.data} />}
    </AdminScreen>
  );
}

function Detail({ user }: { user: AdminUserDetail }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function toggleAdmin() {
    setBusy(true);
    setError(null);
    api.admin
      .setUserIsAdmin(user.user_id, !user.is_admin)
      .then((updated) => {
        queryClient.setQueryData(['admin', 'user', user.user_id], updated);
        void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't change admin access"))
      .finally(() => setBusy(false));
  }

  function deleteAccount() {
    Alert.alert(`Permanently delete ${user.display_name}'s account?`, "This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setDeleteBusy(true);
          setDeleteError(null);
          api.admin
            .deleteUser(user.user_id)
            .then(() => {
              void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
              router.back();
            })
            .catch((e) => {
              setDeleteError(e instanceof Error ? e.message : "Couldn't delete account");
              setDeleteBusy(false);
            });
        },
      },
    ]);
  }

  return (
    <>
      <View style={[s.between, { alignItems: 'flex-start' }]}>
        <View style={s.flex}>
          <View style={[s.row, { flexWrap: 'wrap' }]}>
            <Text style={styles.name}>{user.display_name}</Text>
            {user.is_commissioner_anywhere && <RoleBadge label="Commissioner" />}
            {user.is_admin && <RoleBadge label="Admin" green />}
          </View>
          <Text style={s.soft}>{user.email ?? 'No email on file'}</Text>
        </View>
        <Pressable onPress={toggleAdmin} disabled={busy} style={[styles.outline, { borderColor: user.is_admin ? 'rgba(239,68,68,0.3)' : ADMIN_ACCENT }, busy && styles.dim]}>
          <Text style={[styles.outlineText, { color: user.is_admin ? '#ef4444' : ADMIN_ACCENT }]}>
            {busy ? 'Saving…' : user.is_admin ? 'Revoke Admin' : 'Grant Admin'}
          </Text>
        </Pressable>
      </View>
      {error && <Text style={s.error}>{error}</Text>}

      <TileGrid>
        <StatTile label="Joined" value={<Text style={styles.statText}>{relativeTime(user.created_at)}</Text>} />
        <StatTile label="Last Active" value={<Text style={styles.statText}>{user.last_active ? relativeTime(user.last_active) : 'Never'}</Text>} />
        <StatTile label="Leagues" value={<Text style={styles.statText}>{user.league_count}</Text>} />
        <StatTile label="User ID" value={<Text style={styles.statText}>{user.user_id}</Text>} />
      </TileGrid>

      <AdminSection title="Leagues">
        {user.leagues.length === 0 ? (
          <EmptyNote>Not a member of any league.</EmptyNote>
        ) : (
          user.leagues.map((l, i) => (
            <Divided key={l.league_id} index={i}>
              <Pressable onPress={() => router.push({ pathname: '/admin/leagues/[id]', params: { id: String(l.league_id) } })} style={s.between}>
                <Text style={s.body}>{l.league_name}</Text>
                <Text style={[s.small, { textTransform: 'capitalize' }]}>{l.role}</Text>
              </Pressable>
            </Divided>
          ))
        )}
      </AdminSection>

      <AdminSection title="Recent Activity">
        {user.recent_activity.length === 0 ? (
          <EmptyNote>No recorded activity yet.</EmptyNote>
        ) : (
          user.recent_activity.map((event, i) => (
            <Divided key={i} index={i}>
              <View style={s.between}>
                <Text style={s.body}>{eventLabel(event.event_name)}</Text>
                <Text style={s.small}>{new Date(event.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</Text>
              </View>
            </Divided>
          ))
        )}
      </AdminSection>

      <View style={styles.danger}>
        <Text style={styles.dangerTitle}>Danger Zone</Text>
        {user.delete_blockers.length === 0 ? (
          <>
            <Text style={s.soft}>This account has no linked owner, league membership, or other history — safe to permanently delete.</Text>
            <Pressable onPress={deleteAccount} disabled={deleteBusy} style={[styles.outline, { borderColor: 'rgba(239,68,68,0.3)' }, deleteBusy && styles.dim]}>
              <Text style={[styles.outlineText, { color: '#ef4444' }]}>{deleteBusy ? 'Deleting…' : 'Delete Account'}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={s.soft}>Can&apos;t be deleted — this account has real data attached:</Text>
            {user.delete_blockers.map((reason) => (
              <Text key={reason} style={s.soft}>
                • {reason}
              </Text>
            ))}
          </>
        )}
        {deleteError && <Text style={s.error}>{deleteError}</Text>}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  name: { color: Colors.text, fontSize: 20, fontWeight: '600' },
  outline: { alignSelf: 'flex-start', borderRadius: Radius.pill, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  outlineText: { fontSize: 12, fontWeight: '500' },
  dim: { opacity: 0.5 },
  statText: { color: Colors.text, fontSize: 14, fontWeight: '500' },
  danger: { gap: Spacing.sm, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)', backgroundColor: 'rgba(239,68,68,0.03)', padding: Spacing.lg },
  dangerTitle: { color: '#ef4444', fontSize: 12, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
});
