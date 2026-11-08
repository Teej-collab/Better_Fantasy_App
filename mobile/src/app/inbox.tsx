import { useQuery } from '@tanstack/react-query';
import { router, Stack, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppRefreshControl } from '@/components/AppRefreshControl';
import { ANTON, Elite } from '@/components/elite/Elite';
import { Text } from '@/components/Text';
import { LoadingState, MessageState } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { toNativePath } from '@/lib/localNotifications';
import { runNotificationAction } from '@/lib/notificationActions';
import { queryClient } from '@/lib/queries';
import type { InboxNotification } from '@/lib/types';

// The notification inbox (2026-11-08): everything we've pushed you in the
// last 30 days, including what quiet hours held back or a phone missed.
// Tapping one opens what it was about; the ones with buttons on the push
// have the same buttons here.

const BUTTONS: Record<string, { action: string; label: string }[]> = {
  trade_offer: [{ action: 'decline', label: 'Decline' }],
  survivor_pick: [{ action: 'best', label: 'Pick best odds' }],
  friend_request: [{ action: 'accept', label: 'Accept' }],
};

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d` : new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'TODAY';
  if (d.toDateString() === yesterday.toDateString()) return 'YESTERDAY';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase();
}

async function markRead(ids?: number[]) {
  const res = await api.markNotificationsRead(ids).catch(() => null);
  if (res) queryClient.setQueryData(['inbox-unread'], { unread: res.unread });
  void queryClient.invalidateQueries({ queryKey: ['inbox'] });
}

function Row({ n }: { n: InboxNotification }) {
  const buttons = (n.data.category && BUTTONS[n.data.category]) || [];
  function open() {
    haptics.tap();
    if (!n.read) void markRead([n.id]);
    router.push(toNativePath(n.url) as Href);
  }
  return (
    <Pressable onPress={open} accessibilityRole="button" accessibilityHint={n.read ? undefined : 'Unread'} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={[styles.dot, !n.read && styles.dotOn]} />
      <View style={styles.flex}>
        <View style={styles.top}>
          <Text style={[styles.title, n.read && styles.titleRead]} numberOfLines={2}>
            {n.title}
          </Text>
          <Text style={styles.when}>{ago(n.created_at)}</Text>
        </View>
        {n.body ? (
          <Text style={styles.body} numberOfLines={3}>
            {n.body}
          </Text>
        ) : null}
        {buttons.length > 0 && !n.read && (
          <View style={styles.buttons}>
            {buttons.map((b) => (
              <Pressable
                key={b.action}
                onPress={() => {
                  haptics.tap();
                  void runNotificationAction(n.data.category, b.action, n.data).then(() => markRead([n.id]));
                }}
                style={styles.button}
                accessibilityRole="button">
                <Text style={styles.buttonText}>{b.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </Pressable>
  );
}

export default function InboxScreen() {
  const q = useQuery({ queryKey: ['inbox'], queryFn: api.notifications });
  const items = q.data?.notifications ?? [];
  const unread = q.data?.unread ?? 0;
  useEffect(() => {
    if (q.data) queryClient.setQueryData(['inbox-unread'], { unread: q.data.unread });
  }, [q.data]);

  if (q.isPending) return <LoadingState />;
  if (!q.data) return <MessageState message="Couldn't load your notifications." actionLabel="Try again" onAction={() => void q.refetch()} />;

  const groups: { label: string; rows: InboxNotification[] }[] = [];
  for (const n of items) {
    const label = dayLabel(n.created_at);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.rows.push(n);
    else groups.push({ label, rows: [n] });
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic" refreshControl={<AppRefreshControl />}>
      <Stack.Screen
        options={{
          title: 'Notifications',
          headerRight: unread
            ? () => (
                <Pressable onPress={() => void markRead()} hitSlop={8} accessibilityRole="button">
                  <Text style={styles.markAll}>Mark all read</Text>
                </Pressable>
              )
            : undefined,
        }}
      />
      <Text style={styles.heading} accessibilityRole="header">
        INBOX
      </Text>
      <Text style={styles.sub}>The last 30 days, including anything quiet hours held back.</Text>
      {items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nothing yet</Text>
          <Text style={styles.sub}>Trade offers, injuries, your matchup and survivor reminders land here.</Text>
        </View>
      ) : (
        groups.map((g) => (
          <View key={g.label} style={styles.group}>
            <Text style={styles.groupLabel}>{g.label}</Text>
            <View style={styles.card}>
              {g.rows.map((n, i) => (
                <View key={n.id} style={i > 0 && styles.line}>
                  <Row n={n} />
                </View>
              ))}
            </View>
          </View>
        ))
      )}
      <Pressable onPress={() => router.push({ pathname: '/settings', params: { section: 'notifications' } })} style={styles.settings} accessibilityRole="button">
        <Text style={styles.settingsText}>Notification settings ›</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Elite.deep },
  content: { padding: Spacing.lg, gap: 10, paddingBottom: 80 },
  flex: { flex: 1, minWidth: 0 },
  heading: { fontFamily: ANTON, fontSize: 32, color: Elite.green, textShadowColor: 'rgba(57,255,20,0.4)', textShadowRadius: 14 },
  sub: { color: Elite.faint, fontSize: 12 },
  group: { gap: 6, marginTop: 8 },
  groupLabel: { color: Elite.faint, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  card: { backgroundColor: Elite.card, borderRadius: 14, borderWidth: 1, borderColor: Elite.line, overflow: 'hidden' },
  line: { borderTopWidth: 1, borderTopColor: Elite.line },
  row: { flexDirection: 'row', gap: 10, padding: 14 },
  pressed: { backgroundColor: 'rgba(255,255,255,0.04)' },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  dotOn: { backgroundColor: Elite.green },
  top: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  title: { flex: 1, color: Elite.cream, fontSize: 14, fontWeight: '800' },
  titleRead: { color: Elite.soft, fontWeight: '600' },
  when: { color: Elite.grey, fontSize: 11, marginTop: 2 },
  body: { color: Elite.soft, fontSize: 13, marginTop: 3, lineHeight: 18 },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 10 },
  button: { minHeight: 34, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: Elite.green, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: Elite.green, fontSize: 12, fontWeight: '800' },
  empty: { backgroundColor: Elite.card, borderRadius: 14, padding: 18, gap: 4, marginTop: 8 },
  emptyTitle: { color: Elite.cream, fontSize: 15, fontWeight: '800' },
  markAll: { color: Elite.green, fontSize: 14, fontWeight: '700' },
  settings: { alignSelf: 'center', padding: 12, marginTop: 8 },
  settingsText: { color: Elite.faint, fontSize: 13, fontWeight: '600' },
});
