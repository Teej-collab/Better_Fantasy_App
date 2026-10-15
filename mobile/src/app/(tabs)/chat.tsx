import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';

import { PreviewLink } from '@/components/PreviewLink';
import { TabFrame, useTabScrollRef } from '@/components/TabFrame';
import { Text } from '@/components/Text';
import { WatchPartyBar } from '@/components/watchparty/WatchPartyBar';
import { Card, LoadingState, MessageState, TeamAvatar } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { markConversationRead } from '@/lib/chatSocket';
import { queryClient, useChatConversations } from '@/lib/queries';
import { canDeleteConversation, confirmDeleteConversation } from '@/lib/chatActions';
import { conversationTitle, formatWhen } from '@/lib/chatFormat';
import { useAppearance } from '@/lib/appearance';

function ChatListScreenContent() {
  const scrollRef = useTabScrollRef<ScrollView>();
  const conversations = useChatConversations();
  const accent = useAppearance().accent;
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([conversations.refetch(), queryClient.invalidateQueries({ queryKey: ['watch-party-rooms'] })]);
    setRefreshing(false);
  }

  if (conversations.isPending) return <LoadingState />;
  if (conversations.isError && !conversations.data) return <MessageState message="Couldn't load chat." />;
  const list = conversations.data ?? [];

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Chat</Text>
        <Pressable
          onPress={() => router.push('/chat/new')}
          accessibilityRole="button"
          accessibilityLabel="New message"
          hitSlop={8}
          style={({ pressed }) => [styles.newButton, { backgroundColor: accent }, pressed && styles.pressed]}>
          <Text style={styles.newButtonText}>✎ New</Text>
        </Pressable>
      </View>
      <WatchPartyBar />
      <Card style={styles.listCard}>
        {list.map((c, i) => (
          <Swipeable
            key={c.id}
            containerStyle={i > 0 ? styles.divided : undefined}
            enabled={canDeleteConversation(c)}
            friction={2}
            rightThreshold={40}
            overshootRight={false}
            renderRightActions={(_progress, _translation, swipe) => (
              <Pressable
                onPress={() => {
                  swipe.close();
                  confirmDeleteConversation(c);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${conversationTitle(c)}`}
                style={styles.deleteAction}>
                <Text style={styles.deleteText}>Delete</Text>
              </Pressable>
            )}>
            <PreviewLink
              href={{ pathname: '/chat/[id]', params: { id: String(c.id) } }}
              menu={[
                ...(c.unread_count > 0
                  ? [{ title: 'Mark as Read', icon: 'checkmark.message' as const, onPress: () => markConversationRead(c.id) }]
                  : []),
                ...(canDeleteConversation(c)
                  ? [{ title: 'Delete Chat', icon: 'trash' as const, destructive: true, onPress: () => confirmDeleteConversation(c) }]
                  : []),
              ]}
              style={styles.chatRow}
              pressedStyle={styles.chatRowPressed}>
              <View style={styles.row}>
                <TeamAvatar name={conversationTitle(c)} logoUrl={c.other_owner_logo_url} size={44} />
                <View style={styles.body}>
                  <View style={styles.topLine}>
                    <Text style={[styles.name, c.unread_count > 0 && styles.unreadName]} numberOfLines={1}>
                      {conversationTitle(c)}
                    </Text>
                    {c.last_message && <Text style={styles.when}>{formatWhen(c.last_message.created_at)}</Text>}
                  </View>
                  <View style={styles.topLine}>
                    <Text style={styles.preview} numberOfLines={1}>
                      {c.last_message ? `${c.last_message.owner_name}: ${c.last_message.body || 'Photo'}` : 'No messages yet'}
                    </Text>
                    {c.unread_count > 0 && (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{c.unread_count > 99 ? '99+' : c.unread_count}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>
            </PreviewLink>
          </Swipeable>
        ))}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.lg },
  title: { color: Colors.text, fontSize: 28, fontWeight: '800' },
  newButton: { minHeight: 36, borderRadius: Radius.pill, paddingHorizontal: Spacing.lg, justifyContent: 'center' },
  newButtonText: { color: Colors.bg, fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.7 },
  deleteAction: { width: 88, backgroundColor: Colors.loss, alignItems: 'center', justifyContent: 'center' },
  deleteText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  listCard: { padding: 0, overflow: 'hidden' },
  // Solid, so the swipe's Delete button stays hidden until you swipe.
  chatRow: { paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg, backgroundColor: Colors.surface },
  chatRowPressed: { backgroundColor: Colors.border },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  body: { flex: 1, gap: 2 },
  topLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  name: { flex: 1, color: Colors.text, fontSize: 16, fontWeight: '600' },
  unreadName: { fontWeight: '800' },
  when: { color: Colors.textSecondary, fontSize: 12 },
  preview: { flex: 1, color: Colors.textSecondary, fontSize: 14 },
  badge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: Colors.bg, fontSize: 12, fontWeight: '800' },
});

export default function ChatListScreen() {
  return (
    <TabFrame>
      <ChatListScreenContent />
    </TabFrame>
  );
}
