import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Text } from '@/components/Text';
import { LoadingState } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { queryClient, useChatMembers } from '@/lib/queries';

// Port of the web's NewPartyModal: name the party, pick who's invited
// from your league, then land in the new room.
export default function NewPartyScreen() {
  const accent = useAppearance().accent;
  const members = useChatMembers();
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filtered = (members.data ?? []).filter((m) => m.display_name.toLowerCase().includes(query.toLowerCase()));
  const canSubmit = !!name.trim() && selected.size > 0 && !submitting;

  function toggle(ownerId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ownerId)) next.delete(ownerId);
      else next.add(ownerId);
      return next;
    });
  }

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const { id } = await api.createWatchPartyRoom(name.trim(), Array.from(selected));
      await queryClient.invalidateQueries({ queryKey: ['watch-party-rooms'] });
      router.replace({ pathname: '/watch-party/[id]', params: { id: String(id) } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the party.");
      setSubmitting(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
      <Stack.Screen options={{ title: 'Start a Party' }} />
      <TextInput
        autoFocus
        value={name}
        onChangeText={setName}
        placeholder="Party name"
        placeholderTextColor="rgba(255,255,255,0.4)"
        style={styles.input}
      />
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search league members..."
        placeholderTextColor="rgba(255,255,255,0.4)"
        autoCorrect={false}
        style={styles.input}
      />

      {members.isPending ? (
        <LoadingState />
      ) : (
        <View>
          {filtered.map((m) => {
            const on = selected.has(m.owner_id);
            return (
              <Pressable key={m.owner_id} onPress={() => toggle(m.owner_id)} style={styles.member}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{m.display_name.slice(0, 2).toUpperCase()}</Text>
                </View>
                <View style={styles.flex}>
                  <Text style={styles.name}>{m.display_name}</Text>
                  <Text style={styles.small}>{m.team_name}</Text>
                </View>
                <View style={[styles.check, on && { backgroundColor: accent, borderColor: 'transparent' }]}>
                  {on && <Text style={styles.checkText}>✓</Text>}
                </View>
              </Pressable>
            );
          })}
          {filtered.length === 0 && <Text style={styles.empty}>No members found.</Text>}
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable onPress={submit} disabled={!canSubmit} style={[styles.primary, { backgroundColor: accent }, !canSubmit && styles.disabled]}>
        {submitting ? (
          <ActivityIndicator color="#06110a" />
        ) : (
          <Text style={styles.primaryText}>Create & Start{selected.size > 0 ? ` (${selected.size + 1})` : ''}</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.md },
  flex: { flex: 1, minWidth: 0 },
  input: { backgroundColor: Colors.surface,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    color: Colors.text,
    fontSize: 14,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
  },
  member: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.sm },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: Colors.text, fontSize: 12, fontWeight: '600' },
  name: { color: Colors.text, fontSize: 14, fontWeight: '500' },
  small: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  check: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  checkText: { color: '#06110a', fontSize: 10, fontWeight: '800' },
  empty: { color: 'rgba(255,255,255,0.5)', fontSize: 14, textAlign: 'center', paddingVertical: Spacing.lg },
  error: { color: Colors.loss, fontSize: 14 },
  primary: { borderRadius: Radius.pill, paddingHorizontal: Spacing.lg, paddingVertical: 10, alignItems: 'center' },
  primaryText: { color: '#06110a', fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.4 },
});
