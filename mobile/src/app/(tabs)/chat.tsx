import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { PreviewLink } from '@/components/PreviewLink';
import { TabFrame } from '@/components/TabFrame';
import { Text } from '@/components/Text';
import { WatchPartyBar } from '@/components/watchparty/WatchPartyBar';
import { Card, LoadingState, MessageState, TeamAvatar } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { markConversationRead } from '@/lib/chatSocket';
import { queryClient, useChatConversations } from '@/lib/queries';
import { conversationTitle, formatWhen } from '@/lib/chatFormat';

function ChatListScreenContent() {
  const conversations = useChatConversations();
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
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}>
      <Text style={styles.title}>Chat</Text>
      <WatchPartyBar />
      <Card style={styles.listCard}>
        {list.map((c, i) => (
          <View key={c.id} style={i > 0 ? styles.divided : undefined}>
            <PreviewLink
              href={{ pathname: '/chat/[id]', params: { id: String(c.id) } }}
              menu={c.unread_count > 0 ? [{ title: 'Mark as Read', icon: 'checkmark.message', onPress: () => markConversationRead(c.id) }] : undefined}
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
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl * 2 },
  title: { color: Colors.text, fontSize: 28, fontWeight: '800', marginBottom: Spacing.lg },
  listCard: { padding: 0, overflow: 'hidden' },
  chatRow: { paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg },
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
