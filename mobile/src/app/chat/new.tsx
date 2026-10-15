import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Text } from '@/components/Text';
import { LoadingState, MessageState, TeamAvatar } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { haptics } from '@/lib/haptics';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { queryClient, useChatMembers } from '@/lib/queries';

// New Message: pick one league member for a DM, or several for a group
// chat (an existing DM or group with the same people opens instead).
// With ?add=<conversation id> it adds people to that group instead.
export default function NewMessageScreen() {
  const accent = useAppearance().accent;
  const { add } = useLocalSearchParams<{ add?: string }>();
  const addTo = add ? Number(add) : null;
  const members = useChatMembers();
  const current = useQuery({
    queryKey: ['chat-conversation-members', addTo],
    queryFn: () => api.chatConversationMembers(addTo as number),
    enabled: addTo !== null,
  });
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [groupName, setGroupName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const already = new Set((current.data ?? []).map((m) => m.owner_id));
  const q = query.trim().toLowerCase();
  const filtered = (members.data ?? []).filter(
    (m) => !already.has(m.owner_id) && (m.display_name.toLowerCase().includes(q) || m.team_name.toLowerCase().includes(q)),
  );
  const isGroup = addTo === null && selected.length > 1;

  function toggle(ownerId: number) {
    haptics.select();
    setSelected((prev) => (prev.includes(ownerId) ? prev.filter((id) => id !== ownerId) : [...prev, ownerId]));
  }

  async function submit() {
    if (busy || selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      if (addTo !== null) {
        await api.addChatParticipants(addTo, selected);
        void queryClient.invalidateQueries({ queryKey: ['chat-conversation-members', addTo] });
        void queryClient.invalidateQueries({ queryKey: ['chat-conversations'] });
        haptics.success();
        router.back();
        return;
      }
      const id =
        selected.length === 1
          ? await api.startDirectConversation(selected[0])
          : await api.startGroupConversation(selected, groupName.trim());
      void queryClient.invalidateQueries({ queryKey: ['chat-conversations'] });
      haptics.tap();
      router.dismiss();
      router.push({ pathname: '/chat/[id]', params: { id: String(id) } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start that conversation.");
      setBusy(false);
    }
  }

  const label =
    addTo !== null
      ? `Add ${selected.length} ${selected.length === 1 ? 'Person' : 'People'}`
      : isGroup
        ? `Start Group (${selected.length + 1})`
        : 'Chat';

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: addTo !== null ? 'Add People' : 'New Message' }} />
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
        {isGroup && (
          <TextInput
            value={groupName}
            onChangeText={setGroupName}
            placeholder="Group name (optional)"
            placeholderTextColor={Colors.textSecondary}
            maxLength={60}
            style={styles.input}
          />
        )}

        {members.isPending || (addTo !== null && current.isPending) ? (
          <LoadingState />
        ) : members.isError ? (
          <MessageState message="Couldn't load your league." />
        ) : (
          <View>
            {filtered.map((m) => {
              const on = selected.includes(m.owner_id);
              return (
                <Pressable
                  key={m.owner_id}
                  onPress={() => toggle(m.owner_id)}
                  disabled={busy}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${m.display_name}, ${m.team_name}`}
                  style={({ pressed }) => [styles.member, pressed && styles.pressed]}>
                  <TeamAvatar name={m.display_name} logoUrl={null} size={40} />
                  <View style={styles.flex}>
                    <Text style={styles.name} numberOfLines={1}>
                      {m.display_name}
                    </Text>
                    <Text style={styles.small} numberOfLines={1}>
                      {m.online ? 'Online · ' : ''}
                      {m.team_name}
                    </Text>
                  </View>
                  <View style={[styles.check, on && { backgroundColor: accent, borderColor: accent }]}>
                    {on && <Text style={styles.checkText}>✓</Text>}
                  </View>
                </Pressable>
              );
            })}
            {filtered.length === 0 && (
              <Text style={styles.empty}>{addTo !== null && q === '' ? 'Everyone is already here.' : 'No members found.'}</Text>
            )}
          </View>
        )}

        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
      {selected.length > 0 && (
        <View style={styles.footer}>
          <Pressable
            onPress={() => void submit()}
            disabled={busy}
            accessibilityRole="button"
            style={({ pressed }) => [styles.primary, { backgroundColor: accent }, (pressed || busy) && styles.pressedButton]}>
            {busy ? <ActivityIndicator color={Colors.bg} /> : <Text style={styles.primaryText}>{label}</Text>}
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 4, gap: Spacing.md },
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
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkText: { color: Colors.bg, fontSize: 13, fontWeight: '800' },
  empty: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', paddingVertical: Spacing.lg },
  error: { color: Colors.loss, fontSize: 14 },
  footer: { padding: Spacing.lg, paddingBottom: Spacing.xl, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  primary: { minHeight: 48, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  pressedButton: { opacity: 0.7 },
  primaryText: { color: Colors.bg, fontSize: 16, fontWeight: '800' },
});
