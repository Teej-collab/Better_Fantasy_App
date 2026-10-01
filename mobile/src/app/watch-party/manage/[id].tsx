import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { queryClient, useMe, useWatchPartyMembers } from '@/lib/queries';

// Port of the web's ManagePartyModal: a private party's host can
// remove people (anyone but themselves).
export default function ManagePartyScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const roomId = Number(id);
  const myOwnerId = useMe().data?.owner_id;
  const q = useWatchPartyMembers(roomId);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function confirmRemove(ownerId: number, displayName: string) {
    Alert.alert(`Remove ${displayName}?`, "They won't be able to rejoin this party or its chat.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void remove(ownerId) },
    ]);
  }

  async function remove(ownerId: number) {
    setRemovingId(ownerId);
    setError(null);
    try {
      await api.removeWatchPartyMember(roomId, ownerId);
      queryClient.setQueryData<typeof q.data>(['watch-party-members', roomId], (prev) =>
        prev ? { ...prev, members: prev.members.filter((m) => m.owner_id !== ownerId) } : prev,
      );
      void queryClient.invalidateQueries({ queryKey: ['watch-party-rooms'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove that person.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: name ? `Manage "${name}"` : 'Manage party' }} />
      {error && <Text style={styles.error}>{error}</Text>}
      {q.isPending ? (
        <LoadingState />
      ) : !q.data ? (
        <Text style={styles.error}>{q.error instanceof Error ? q.error.message : "Couldn't load members."}</Text>
      ) : (
        q.data.members.map((m) => {
          const isHost = m.owner_id === q.data.created_by_owner_id;
          return (
            <View key={m.owner_id} style={styles.member}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{m.display_name.slice(0, 2).toUpperCase()}</Text>
              </View>
              <Text style={styles.name}>
                {m.display_name}
                {isHost && <Text style={styles.host}>  Host</Text>}
              </Text>
              {!isHost && m.owner_id !== myOwnerId && (
                <Pressable
                  onPress={() => confirmRemove(m.owner_id, m.display_name)}
                  disabled={removingId === m.owner_id}
                  style={[styles.remove, removingId === m.owner_id && styles.disabled]}>
                  <Text style={styles.removeText}>{removingId === m.owner_id ? 'Removing…' : 'Remove'}</Text>
                </Pressable>
              )}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: 4 },
  member: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.sm },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: Colors.text, fontSize: 12, fontWeight: '600' },
  name: { flex: 1, color: Colors.text, fontSize: 14, fontWeight: '500' },
  host: { color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: '400' },
  remove: { backgroundColor: Colors.surface, borderRadius: Radius.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 10, paddingVertical: 4 },
  removeText: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '500' },
  disabled: { opacity: 0.4 },
  error: { color: Colors.loss, fontSize: 14 },
});
