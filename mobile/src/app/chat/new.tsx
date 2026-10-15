import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Text } from '@/components/Text';
import { LoadingState, MessageState, TeamAvatar } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { queryClient, useChatMembers } from '@/lib/queries';

// New Message: pick a league member and land in your conversation with
// them (an existing one opens instead of making a second). Same
// POST /chat/conversations/direct the website's member list uses.
export default function NewMessageScreen() {
  const accent = useAppearance().accent;
  const members = useChatMembers();
  const [query, setQuery] = useState('');
  const [opening, setOpening] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const filtered = (members.data ?? []).filter(
    (m) => m.display_name.toLowerCase().includes(q) || m.team_name.toLowerCase().includes(q),
  );

  async function open(ownerId: number) {
    if (opening !== null) return;
    setOpening(ownerId);
    setError(null);
    try {
      const id = await api.startDirectConversation(ownerId);
      void queryClient.invalidateQueries({ queryKey: ['chat-conversations'] });
      haptics.tap();
      router.dismiss();
      router.push({ pathname: '/chat/[id]', params: { id: String(id) } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start that conversation.");
      setOpening(null);
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive">
      <TextInput
        autoFocus
        value={query}
        onChangeText={setQuery}
        placeholder="Search league members..."
        placeholderTextColor={Colors.textSecondary}
        autoCorrect={false}
        style={styles.input}
      />

      {members.isPending ? (
        <LoadingState />
      ) : members.isError ? (
        <MessageState message="Couldn't load your league." />
      ) : (
        <View>
          {filtered.map((m) => (
            <Pressable
              key={m.owner_id}
              onPress={() => void open(m.owner_id)}
              disabled={opening !== null}
              accessibilityRole="button"
              accessibilityLabel={`Message ${m.display_name}, ${m.team_name}`}
              style={({ pressed }) => [styles.member, pressed && styles.pressed]}>
              <TeamAvatar name={m.display_name} logoUrl={null} size={40} />
              <View style={styles.flex}>
                <Text style={styles.name} numberOfLines={1}>
                  {m.display_name}
                </Text>
                <Text style={styles.small} numberOfLines={1}>
                  {m.team_name}
                </Text>
              </View>
              {opening === m.owner_id ? (
                <ActivityIndicator color={accent} />
              ) : (
                m.online && <View style={[styles.online, { backgroundColor: accent }]} accessibilityLabel="Online" />
              )}
            </Pressable>
          ))}
          {filtered.length === 0 && <Text style={styles.empty}>No members found.</Text>}
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.md },
  flex: { flex: 1, minWidth: 0 },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontSize: 15,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
  },
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 56,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
  },
  pressed: { backgroundColor: Colors.border },
  name: { color: Colors.text, fontSize: 16, fontWeight: '600' },
  small: { color: Colors.textSecondary, fontSize: 13 },
  online: { width: 10, height: 10, borderRadius: 5 },
  empty: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', paddingVertical: Spacing.lg },
  error: { color: Colors.loss, fontSize: 14 },
});
