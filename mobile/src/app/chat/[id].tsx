import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LoadingState, MessageState } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { conversationTitle, formatMessageTime } from '@/lib/chatFormat';
import { markConversationRead, useChatSocket } from '@/lib/chatSocket';
import { queryClient, useChatConversations, useChatMessages, useMe } from '@/lib/queries';
import type { ChatMessage } from '@/lib/types';

// backend/app/routers/chat.py's ALLOWED_REACTIONS and DEFAULT_PAGE_SIZE.
const REACTIONS = ['😂', '🔥', '💀', '👍', '❤️', '😭'];
const PAGE_SIZE = 50;
const TYPING_SEND_INTERVAL_MS = 2000;

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = Number(id);
  const insets = useSafeAreaInsets();
  const me = useMe();
  const conversation = useChatConversations().data?.find((c) => c.id === conversationId);
  const messages = useChatMessages(conversationId);
  const { connected, typingByConversation, send, setOpenConversation } = useChatSocket();

  const [draft, setDraft] = useState('');
  const [title, setTitle] = useState('');
  const [reactingTo, setReactingTo] = useState<ChatMessage | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reachedStart, setReachedStart] = useState(false);
  const lastTypingSent = useRef(0);

  useEffect(() => {
    setOpenConversation(conversationId);
    markConversationRead(conversationId);
    return () => setOpenConversation(null);
  }, [conversationId, setOpenConversation]);

  const myOwnerId = me.data?.owner_id ?? null;
  const isAnnouncements = conversation?.type === 'commish_corner';
  const canPost = conversation?.can_post ?? true;
  const typists = (typingByConversation[conversationId] ?? []).filter((t) => t.owner_id !== myOwnerId);

  async function loadOlder() {
    const current = messages.data;
    if (loadingOlder || reachedStart || !current || current.length < PAGE_SIZE) return;
    setLoadingOlder(true);
    try {
      const { messages: older } = await api.chatMessages(conversationId, current[0].id);
      if (older.length < PAGE_SIZE) setReachedStart(true);
      queryClient.setQueryData<ChatMessage[]>(['chat-messages', conversationId], (prev) => {
        const ids = new Set((prev ?? []).map((m) => m.id));
        return [...older.filter((m) => !ids.has(m.id)), ...(prev ?? [])];
      });
    } finally {
      setLoadingOlder(false);
    }
  }

  function onChangeDraft(text: string) {
    setDraft(text);
    const now = Date.now();
    if (text && now - lastTypingSent.current > TYPING_SEND_INTERVAL_MS) {
      lastTypingSent.current = now;
      send({ type: 'typing', conversation_id: conversationId });
    }
  }

  function onSend() {
    const body = draft.trim();
    if (!body || (isAnnouncements && !title.trim())) return;
    const event: Record<string, unknown> = { type: 'message', conversation_id: conversationId, body };
    if (isAnnouncements) event.title = title.trim();
    // The sent message comes back over the socket like everyone else's,
    // so it only appears once the server has saved it.
    if (send(event)) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setDraft('');
      setTitle('');
    }
  }

  function react(emoji: string) {
    const target = reactingTo;
    setReactingTo(null);
    if (!target) return;
    void Haptics.selectionAsync();
    api.reactToMessage(target.id, emoji).catch(() => {});
  }

  const headerTitle = conversation ? conversationTitle(conversation) : 'Chat';
  if (messages.isPending) return <LoadingState />;
  if (messages.isError && !messages.data) return <MessageState message="Couldn't load messages." />;

  // Inverted list: newest at the bottom, next to the composer.
  const newestFirst = [...(messages.data ?? [])].reverse();

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top + 44}>
      <Stack.Screen options={{ title: headerTitle }} />
      <FlatList
        inverted
        data={newestFirst}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={styles.list}
        onEndReached={loadOlder}
        onEndReachedThreshold={0.3}
        keyboardDismissMode="interactive"
        ListFooterComponent={loadingOlder ? <ActivityIndicator color={Colors.accent} style={styles.olderSpinner} /> : null}
        renderItem={({ item, index }) => {
          // "Previous" in reading order is the next item in this
          // newest-first array.
          const previous = newestFirst[index + 1];
          const showName = item.owner_id !== myOwnerId && previous?.owner_id !== item.owner_id;
          return (
            <MessageBubble
              message={item}
              mine={item.owner_id === myOwnerId}
              showName={showName}
              onLongPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setReactingTo(item);
              }}
            />
          );
        }}
      />

      {typists.length > 0 && (
        <Text style={styles.typing}>
          {typists.map((t) => t.owner_name).join(', ')} {typists.length === 1 ? 'is' : 'are'} typing…
        </Text>
      )}

      {canPost ? (
        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}>
          {isAnnouncements && (
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Announcement title"
              placeholderTextColor={Colors.textSecondary}
              style={[styles.input, styles.titleInput]}
            />
          )}
          <View style={styles.composerRow}>
            <TextInput
              value={draft}
              onChangeText={onChangeDraft}
              placeholder={connected ? 'Message' : 'Connecting…'}
              placeholderTextColor={Colors.textSecondary}
              multiline
              style={[styles.input, styles.messageInput]}
            />
            <Pressable
              onPress={onSend}
              disabled={!connected || !draft.trim()}
              style={({ pressed }) => [
                styles.sendButton,
                (!connected || !draft.trim()) && styles.sendDisabled,
                pressed && styles.pressed,
              ]}>
              <Text style={styles.sendText}>Send</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Text style={[styles.readOnly, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
          Only the commissioner can post here.
        </Text>
      )}

      <Modal visible={reactingTo !== null} transparent animationType="fade" onRequestClose={() => setReactingTo(null)}>
        <Pressable style={styles.reactBackdrop} onPress={() => setReactingTo(null)}>
          <View style={styles.reactBar}>
            {REACTIONS.map((emoji) => (
              <Pressable key={emoji} onPress={() => react(emoji)} hitSlop={6} style={({ pressed }) => pressed && styles.pressed}>
                <Text style={styles.reactEmoji}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function MessageBubble(props: { message: ChatMessage; mine: boolean; showName: boolean; onLongPress: () => void }) {
  const { message, mine } = props;
  return (
    <View style={[styles.messageWrap, mine ? styles.alignEnd : styles.alignStart]}>
      {props.showName && (
        <Text style={[styles.sender, message.owner_chat_color ? { color: message.owner_chat_color } : null]}>
          {message.owner_name}
        </Text>
      )}
      <Pressable onLongPress={props.onLongPress} delayLongPress={300}>
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
          {message.reply_to && (
            <View style={styles.reply}>
              <Text style={styles.replyName}>{message.reply_to.owner_name}</Text>
              <Text style={styles.replyBody} numberOfLines={2}>
                {message.reply_to.body}
              </Text>
            </View>
          )}
          {message.title && <Text style={[styles.announcementTitle, mine && styles.textMine]}>{message.title}</Text>}
          {message.image_url && (
            <Image source={{ uri: message.image_url }} style={styles.image} contentFit="cover" transition={150} />
          )}
          {!!message.body && <Text style={[styles.body, mine && styles.textMine]}>{message.body}</Text>}
          <Text style={[styles.time, mine && styles.timeMine]}>{formatMessageTime(message.created_at)}</Text>
        </View>
      </Pressable>
      {message.reactions.length > 0 && (
        <View style={[styles.reactions, mine && styles.alignEnd]}>
          {message.reactions.map((r) => (
            <View key={r.emoji} style={[styles.reactionChip, r.reacted_by_me && styles.reactionMine]}>
              <Text style={styles.reactionText}>
                {r.emoji} {r.count}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  list: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  olderSpinner: { marginVertical: Spacing.lg },
  messageWrap: { marginVertical: 3, maxWidth: '82%' },
  alignStart: { alignSelf: 'flex-start' },
  alignEnd: { alignSelf: 'flex-end' },
  sender: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 2, marginLeft: Spacing.sm },
  bubble: { borderRadius: Radius.lg, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  bubbleMine: { backgroundColor: Colors.accent },
  bubbleTheirs: { backgroundColor: Colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.border },
  body: { color: Colors.text, fontSize: 16, lineHeight: 21 },
  textMine: { color: Colors.bg },
  announcementTitle: { color: Colors.text, fontSize: 16, fontWeight: '800', marginBottom: 2 },
  time: { color: Colors.textSecondary, fontSize: 11, marginTop: 2, alignSelf: 'flex-end' },
  timeMine: { color: 'rgba(13,16,22,0.6)' },
  image: { width: 220, height: 220, borderRadius: Radius.md, marginVertical: Spacing.xs },
  reply: { borderLeftWidth: 3, borderLeftColor: Colors.textSecondary, paddingLeft: Spacing.sm, marginBottom: Spacing.xs },
  replyName: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700' },
  replyBody: { color: Colors.textSecondary, fontSize: 13 },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 },
  reactionChip: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  reactionMine: { borderColor: Colors.accent },
  reactionText: { color: Colors.text, fontSize: 12 },
  typing: { color: Colors.textSecondary, fontSize: 12, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xs },
  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    backgroundColor: Colors.bg,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm },
  input: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.lg,
    color: Colors.text,
    fontSize: 16,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  titleInput: { fontWeight: '700' },
  messageInput: { flex: 1, maxHeight: 120 },
  sendButton: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
  },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: Colors.bg, fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.6 },
  readOnly: { color: Colors.textSecondary, textAlign: 'center', paddingTop: Spacing.md },
  reactBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  reactBar: {
    flexDirection: 'row',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  reactEmoji: { fontSize: 30 },
});
