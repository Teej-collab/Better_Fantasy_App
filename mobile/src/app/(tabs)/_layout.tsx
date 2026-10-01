import * as QuickActions from 'expo-quick-actions';
import { useQuickActionRouting } from 'expo-quick-actions/router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { Colors } from '@/constants/theme';
import { useChatConversations, useMe } from '@/lib/queries';

// Long-press the app icon: four shortcuts (iOS's maximum), with the
// search one last as Apple suggests. Set here, not in the root layout,
// so they only exist while signed in — and cleared on sign-out.
const QUICK_ACTIONS: QuickActions.Action[] = [
  { id: 'team', title: 'My Team', icon: 'symbol:person.3.fill', params: { href: '/team' } },
  { id: 'gamecast', title: 'Gamecast', icon: 'symbol:football.fill', params: { href: '/gamecast' } },
  { id: 'chat', title: 'League Chat', icon: 'symbol:bubble.left.and.bubble.right.fill', params: { href: '/chat' } },
  { id: 'players', title: 'Search Players', icon: 'search', params: { href: '/players' } },
];

function useHomeScreenQuickActions() {
  useQuickActionRouting();
  useEffect(() => {
    // SF Symbols are iOS-only; Android shows the app icon beside each.
    const items = Platform.OS === 'ios' ? QUICK_ACTIONS : QUICK_ACTIONS.map(({ icon, ...rest }) => rest);
    QuickActions.setItems(items).catch(() => {});
    return () => {
      QuickActions.setItems([]).catch(() => {});
    };
  }, []);
}

export default function TabsLayout() {
  useHomeScreenQuickActions();
  // Loaded here so lib/chatSocket.tsx always knows which live messages
  // are your own (those never count as unread).
  useMe();
  const unread = (useChatConversations().data ?? []).reduce((sum, c) => sum + c.unread_count, 0);
  return (
    <NativeTabs backgroundColor={Colors.surface} tintColor={Colors.accent}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="team">
        <NativeTabs.Trigger.Label>Team</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.3.fill" md="groups" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="players">
        <NativeTabs.Trigger.Label>Players</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.badge.plus" md="person_add" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="chat">
        <NativeTabs.Trigger.Label>Chat</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="bubble.left.and.bubble.right.fill" md="chat" />
        {/* Not rendered at all at zero: hidden={true} still showed a "0". */}
        {unread > 0 && <NativeTabs.Trigger.Badge>{unread > 99 ? '99+' : String(unread)}</NativeTabs.Trigger.Badge>}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="league">
        <NativeTabs.Trigger.Label>League</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="trophy.fill" md="emoji_events" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
