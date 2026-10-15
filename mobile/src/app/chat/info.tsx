import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Text } from '@/components/Text';
import { Card, LoadingState, MessageState, SectionTitle, TeamAvatar } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { useAppearance } from '@/lib/appearance';
import { canDeleteConversation, confirmDeleteConversation } from '@/lib/chatActions';
import { conversationTitle } from '@/lib/chatFormat';
import { haptics } from '@/lib/haptics';
import { queryClient, useChatConversations, useMe } from '@/lib/queries';

// A DM's or group chat's details: the group's name and who's in it,
// Add People, and Delete Chat.
export default function ChatInfoScreen() {
  const accent = useAppearance().accent;
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = Number(id);
  const conversation = (useChatConversations().data ?? []).find((c) => c.id === conversationId);
  const myOwnerId = useMe().data?.owner_id ?? null;
  const members = useQuery({
    queryKey: ['chat-conversation-members', conversationId],
    queryFn: () => api.chatConversationMembers(conversationId),
  });
  const [name, setName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!conversation) return <MessageState message="This chat isn't on your list." />;
  const isGroup = conversation.type === 'group';
  const draft = name ?? conversation.name ?? '';
  const nameChanged = draft.trim() !== (conversation.name ?? '');

  async function saveName() {
    if (!nameChanged || saving) return;
    setSaving(true);
    try {
      await api.renameGroupChat(conversationId, draft.trim());
      await queryClient.invalidateQueries({ queryKey: ['chat-conversations'] });
      setName(null);
      haptics.success();
    } catch {
      haptics.error();
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: isGroup ? 'Group Info' : conversationTitle(conversation) }} />

      {isGroup && (
        <>
          <SectionTitle>Name</SectionTitle>
          <View style={styles.nameRow}>
            <TextInput
              value={draft}
              onChangeText={setName}
              placeholder={conversationTitle({ ...conversation, name: null })}
              placeholderTextColor={Colors.textSecondary}
              maxLength={60}
              returnKeyType="done"
              onSubmitEditing={() => void saveName()}
              style={styles.input}
            />
            {nameChanged && (
              <Pressable
                onPress={() => void saveName()}
                accessibilityRole="button"
                style={({ pressed }) => [styles.save, { backgroundColor: accent }, pressed && styles.pressed]}>
                {saving ? <ActivityIndicator color={Colors.bg} /> : <Text style={styles.saveText}>Save</Text>}
              </Pressable>
            )}
          </View>
        </>
      )}

      <SectionTitle>{isGroup ? `${members.data?.length ?? conversation.member_count} People` : 'In this chat'}</SectionTitle>
      {members.isPending ? (
        <LoadingState />
      ) : (
        <Card style={styles.listCard}>
          {(members.data ?? []).map((m, i) => (
            <View key={m.owner_id} style={[styles.member, i > 0 && styles.divided]}>
              <TeamAvatar name={m.display_name} logoUrl={m.logo_url} size={36} />
              <Text style={styles.name} numberOfLines={1}>
                {m.display_name}
                {m.owner_id === myOwnerId ? ' (you)' : ''}
              </Text>
            </View>
          ))}
          {isGroup && (
            <Pressable
              onPress={() => router.push(`/chat/new?add=${conversationId}` as Href)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.member, styles.divided, pressed && styles.rowPressed]}>
              <View style={[styles.plus, { borderColor: accent }]}>
                <Text style={[styles.plusText, { color: accent }]}>+</Text>
              </View>
              <Text style={[styles.name, { color: accent }]}>Add People</Text>
            </Pressable>
          )}
        </Card>
      )}

      {canDeleteConversation(conversation) && (
        <Pressable
          onPress={() => confirmDeleteConversation(conversation, () => router.dismissTo('/chat'))}
          accessibilityRole="button"
          style={({ pressed }) => [styles.delete, pressed && styles.rowPressed]}>
          <Text style={styles.deleteText}>Delete Chat</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2, gap: Spacing.sm },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  input: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontSize: 15,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
  },
  save: { minHeight: 40, minWidth: 64, borderRadius: Radius.pill, paddingHorizontal: Spacing.lg, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: Colors.bg, fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.7 },
  listCard: { padding: 0, overflow: 'hidden' },
  member: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 52, paddingHorizontal: Spacing.lg },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  rowPressed: { backgroundColor: Colors.border },
  name: { flex: 1, color: Colors.text, fontSize: 16, fontWeight: '600' },
  plus: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  plusText: { fontSize: 20, fontWeight: '700' },
  delete: {
    marginTop: Spacing.xl,
    minHeight: 48,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.loss,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: { color: Colors.loss, fontSize: 16, fontWeight: '700' },
});
