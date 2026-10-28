import * as QuickActions from 'expo-quick-actions';
import { useQuickActionRouting } from 'expo-quick-actions/router';
import { Tabs } from 'expo-router';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { FloatingTabBar } from '@/components/FloatingTabBar';
import { useAppearance, useThemeSync } from '@/lib/appearance';
import { leagueWidgetPropsFor, updateLeagueWidget, updateMatchupWidget } from '@/lib/homeWidget';
import { listenForPushToStart, syncLiveActivity } from '@/lib/liveActivity';
import { syncSeasonalAppIcon } from '@/lib/seasonal';
import { setUpReminderHandling, syncReminders } from '@/lib/localNotifications';
import { registerForPush } from '@/lib/pushRegistration';
import {
  useActiveLeagueName,
  useChatConversations,
  useChugDeadline,
  useHomeAwards,
  useMe,
  useMyKeepers,
  useMyTeam,
  useMyWeek,
  useNflScoreboard,
  useSeasonWeek,
  useStandings,
  useHouseRules,
} from '@/lib/queries';
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
  const ruleName = useHouseRules().data?.chugRuleName;
  useEffect(() => {
    const now = Date.now();
    syncReminders([
      ...lineupReminders(team, now),
      ...draftReminders(myWeek, now),
      ...keeperReminders(keepers, now),
      ...chugReminders(chug, now, ruleName),
    ]).catch(() => {});
  }, [team, myWeek, keepers, chug, ruleName]);
  useEffect(() => {
    const stop = setUpReminderHandling();
    return () => {
      stop();
      syncReminders([]).catch(() => {});
    };
  }, []);
}

// Hands the home-screen widget a fresh matchup snapshot whenever /me/week
// loads (the live refetch keeps it current on game day). Signing out
// blanks it (lib/auth.tsx).
function useHomeWidget() {
  const myWeek = useMyWeek().data;
  const team = useMyTeam().data;
  const games = useNflScoreboard().data;
  const season = useSeasonWeek().data?.season ?? null;
  const weekNumber = useSeasonWeek().data?.week ?? null;
  const standings = useStandings(season).data?.standings;
  const awards = useHomeAwards(season, weekNumber).data ?? null;
  const leagueName = useActiveLeagueName().data ?? null;
  useEffect(() => {
    if (myWeek !== undefined) updateMatchupWidget(myWeek, { team, games });
  }, [myWeek, team, games]);
  // The League widget: standings, power rank, waivers and last week's awards.
  useEffect(() => {
    if (myWeek === undefined || standings === undefined) return;
    updateLeagueWidget(leagueWidgetPropsFor({ week: myWeek, season, leagueName, standings, awards }));
  }, [myWeek, season, standings, awards, leagueName]);
  // The Lock Screen / Dynamic Island live score follows the same data
  // (lib/liveActivity.ts), and the backend can start one at kickoff.
  useEffect(() => {
    if (myWeek !== undefined) void syncLiveActivity(myWeek).catch(() => {});
  }, [myWeek]);
  useEffect(() => listenForPushToStart(), []);
}

// The season's home-screen icon (October's spider web...), checked each
// time the app opens since the date is what changes it.
function useSeasonalAppIcon() {
  useEffect(() => {
    void syncSeasonalAppIcon();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncSeasonalAppIcon();
    });
    return () => sub.remove();
  }, []);
}

// Real push (lib/pushRegistration.ts): asks once you're in a league —
// before that there's nothing to notify you about — and re-sends the
// token each launch in case iOS rotated it.
function usePushRegistration() {
  const inLeague = useMe().data?.active_league_id != null;
  useEffect(() => {
    if (inLeague) registerForPush().catch(() => {});
  }, [inLeague]);
}

export default function TabsLayout() {
  useHomeScreenQuickActions();
  usePushRegistration();
  useLocalReminders();
  useHomeWidget();
  useThemeSync();
  useSeasonalAppIcon();
  // Loaded here so lib/chatSocket.tsx always knows which live messages
  // are your own (those never count as unread).
  useMe();
  const unread = (useChatConversations().data ?? []).reduce((sum, c) => sum + c.unread_count, 0);
  // Settings > Appearance > Accent Color colors the current tab.
  const accent = useAppearance().accent;
  // The floating, icons-only bar that hides while you scroll down
  // (components/FloatingTabBar.tsx), 2026-10-20 — replacing the system
  // tab bar, which can't shrink or hide on scroll.
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: 'transparent' } }}
      tabBar={(props) => <FloatingTabBar {...props} accent={accent} badges={{ chat: unread }} />}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="team" options={{ title: 'Team' }} />
      <Tabs.Screen name="players" options={{ title: 'Players' }} />
      <Tabs.Screen name="chat" options={{ title: 'Chat' }} />
      <Tabs.Screen name="league" options={{ title: 'League' }} />
    </Tabs>
  );
}
