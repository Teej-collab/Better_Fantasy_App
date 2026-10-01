import * as QuickActions from 'expo-quick-actions';
import { useQuickActionRouting } from 'expo-quick-actions/router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { Colors } from '@/constants/theme';
import { updateMatchupWidget } from '@/lib/homeWidget';
import { setUpReminderHandling, syncReminders } from '@/lib/localNotifications';
import { useChatConversations, useChugDeadline, useMe, useMyKeepers, useMyTeam, useMyWeek } from '@/lib/queries';
import { chugReminders, draftReminders, keeperReminders, lineupReminders } from '@/lib/reminders';

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

// Game-day reminders scheduled on this phone (lib/reminders.ts), rebuilt
// whenever the data behind them changes — and cleared on sign-out, when
// this layout unmounts.
function useLocalReminders() {
  const team = useMyTeam().data;
  const myWeek = useMyWeek().data;
  const keepers = useMyKeepers().data;
  const chug = useChugDeadline(myWeek?.draft?.status === 'complete').data;
  useEffect(() => {
    const now = Date.now();
    syncReminders([
      ...lineupReminders(team, now),
      ...draftReminders(myWeek, now),
      ...keeperReminders(keepers, now),
      ...chugReminders(chug, now),
    ]).catch(() => {});
  }, [team, myWeek, keepers, chug]);
  useEffect(() => {
    const stop = setUpReminderHandling();
    return () => {
      stop();
      syncReminders([]).catch(() => {});
    };
  }, []);
}

// Hands the home-screen widget a fresh matchup snapshot whenever /me/week
// loads (the live refetch keeps it current on game day), and blanks it on
// sign-out so it doesn't keep showing someone's score.
function useHomeWidget() {
  const myWeek = useMyWeek().data;
  useEffect(() => {
    if (myWeek !== undefined) updateMatchupWidget(myWeek);
  }, [myWeek]);
  useEffect(() => () => updateMatchupWidget(null), []);
}

export default function TabsLayout() {
  useHomeScreenQuickActions();
  useLocalReminders();
  useHomeWidget();
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
