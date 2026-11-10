import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo';
import { router, type Href } from 'expo-router';

import type { Reminder, ReminderCategory } from '@/lib/reminders';
import { api } from '@/lib/api';
import { markOpenedByLink } from '@/lib/freshStart';
import { registerNotificationCategories, runNotificationAction } from '@/lib/notificationActions';
import { queryClient } from '@/lib/queries';

// Schedules lib/reminders.ts's reminders as local notifications. Native
// (expo-notifications) and, like sharing, only loaded where the build has
// it — an over-the-air update also reaches installs from before it was
// added, and importing it there would crash. Elsewhere this is a no-op.
type NotificationsModule = typeof import('expo-notifications');

export const canScheduleReminders = requireOptionalNativeModule('ExpoNotificationScheduler') !== null;

let notifications: NotificationsModule | null = null;
export function load(): NotificationsModule | null {
  if (!canScheduleReminders) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  notifications ??= require('expo-notifications') as NotificationsModule;
  return notifications;
}

const ID_PREFIX = 'wl-reminder:';

// ---- Settings (this phone only) ------------------------------------------

const SETTINGS_KEY = 'wl:reminder-settings';
export type ReminderSettings = Record<ReminderCategory, boolean>;
export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = { lineup: true, draft: true, chug: true };

export async function getReminderSettings(): Promise<ReminderSettings> {
  try {
    const saved = await AsyncStorage.getItem(SETTINGS_KEY);
    return saved ? { ...DEFAULT_REMINDER_SETTINGS, ...JSON.parse(saved) } : DEFAULT_REMINDER_SETTINGS;
  } catch {
    return DEFAULT_REMINDER_SETTINGS;
  }
}

export async function saveReminderSettings(settings: ReminderSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)).catch(() => {});
}

// ---- Scheduling ----------------------------------------------------------

// Asks once, the first time there's actually something to remind about.
export async function ensurePermission(n: NotificationsModule): Promise<boolean> {
  const current = await n.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await n.requestPermissionsAsync()).granted;
}

let lastSignature = '';
// The last full list (before settings filter it), so a settings change can
// reschedule without waiting for new data.
let lastReminders: Reminder[] = [];

// Replaces every scheduled Weekend League reminder with `reminders`
// (filtered by this phone's settings). Cheap to call often: it skips the
// work when nothing changed since the last call.
export async function syncReminders(reminders: Reminder[]): Promise<void> {
  lastReminders = reminders;
  const n = load();
  if (!n) return;
  const settings = await getReminderSettings();
  const wanted = reminders.filter((r) => settings[r.category]).sort((a, b) => a.at - b.at);
  const signature = JSON.stringify(wanted.map((r) => [r.key, r.at, r.body]));
  if (signature === lastSignature) return;

  const scheduled = await n.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled.filter((s) => s.identifier.startsWith(ID_PREFIX)).map((s) => n.cancelScheduledNotificationAsync(s.identifier)),
  );
  lastSignature = signature;
  if (wanted.length === 0 || !(await ensurePermission(n))) return;

  for (const r of wanted) {
    await n.scheduleNotificationAsync({
      identifier: `${ID_PREFIX}${r.key}`,
      content: { title: r.title, body: r.body, data: { url: r.url } },
      trigger: { type: n.SchedulableTriggerInputTypes.DATE, date: r.at },
    });
  }
}

// Settings' "Send a test reminder": a real local notification in 5
// seconds (lock the phone to see it arrive), opening the Team tab.
export async function sendTestReminder(): Promise<boolean> {
  const n = load();
  if (!n || !(await ensurePermission(n))) return false;
  await n.scheduleNotificationAsync({
    identifier: `${ID_PREFIX}test-${Date.now()}`,
    content: { title: '🏈 Kickoff in 1 hour — check your lineup', body: 'This is a test reminder from The Weekend.', data: { url: '/team' } },
    trigger: { type: n.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5 },
  });
  return true;
}

// Reschedules from the last list after a settings change.
export function invalidateReminders() {
  lastSignature = '';
  syncReminders(lastReminders).catch(() => {});
}

// Show reminders even while the app is open, and open their screen on tap
// (including a tap that launched the app).
export function setUpReminderHandling(): () => void {
  const n = load();
  if (!n) return () => {};
  n.setNotificationHandler({
    handleNotification: async () => {
      // A push that arrives with the app open is also new in the inbox.
      void queryClient.invalidateQueries({ queryKey: ['inbox-unread'] });
      return { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false };
    },
  });
  // A reminder carries its url in content.data; a real push from the
  // backend (app/notifications/apns_client.py) carries it and its data
  // beside "aps", which iOS hands over as the push trigger's payload.
  const linkOf = (r: import('expo-notifications').NotificationResponse) => {
    const { content, trigger } = r.notification.request;
    const payload = trigger && 'payload' in trigger ? (trigger.payload as Record<string, unknown> | null) : null;
    const data = ((payload?.data ?? content.data) ?? {}) as Record<string, unknown>;
    return { url: content.data?.url ?? payload?.url, leagueId: data.league_id };
  };
  // A button on the push (lib/notificationActions.ts) does its thing first.
  const respond = (r: import('expo-notifications').NotificationResponse) => {
    if (r.actionIdentifier !== n.DEFAULT_ACTION_IDENTIFIER) {
      const { content, trigger } = r.notification.request;
      const payload = trigger && 'payload' in trigger ? (trigger.payload as Record<string, unknown> | null) : null;
      const data = ((payload?.data ?? content.data) ?? {}) as Record<string, unknown>;
      void runNotificationAction(content.categoryIdentifier ?? (data.category as string | undefined), r.actionIdentifier, data, r.userText);
    }
    const { url, leagueId } = linkOf(r);
    void openNotificationLink(url, leagueId);
  };
  registerNotificationCategories(n);
  const initial = n.getLastNotificationResponse();
  if (initial) {
    respond(initial);
    // Handled — so a later launch doesn't open it again.
    n.clearLastNotificationResponse();
  }
  const sub = n.addNotificationResponseReceivedListener(respond);
  return () => sub.remove();
}

/**
 * Opens what a notification is about (2026-11-10): switches to the
 * league it came from first, so a push from your other league doesn't
 * open its matchup or trade under this one ("not found"). Used by push
 * taps and the inbox.
 */
export async function openNotificationLink(url: unknown, leagueId?: unknown): Promise<void> {
  if (typeof url !== 'string' || !url.startsWith('/')) return;
  // Before anything awaits, so a fresh start (app/_layout.tsx) knows a
  // tap is landing and doesn't send it Home.
  markOpenedByLink();
  if (typeof leagueId === 'number') {
    type Mine = { active_league_id: number | null };
    const active =
      queryClient.getQueryData<Mine>(['leagues-mine'])?.active_league_id ??
      (await api.leaguesMine().catch(() => null))?.active_league_id;
    if (active != null && active !== leagueId) {
      const switched = await api.selectLeague(leagueId).then(() => true, () => false);
      if (switched) await queryClient.invalidateQueries();
      markOpenedByLink();
    }
  }
  router.push(toNativePath(url) as Href);
}

/**
 * Pushes from the backend carry the web's paths (app/notifications/
 * formatter.py). Most match a native screen as is; these don't, so a
 * tap would land on a list instead of the thing the push was about.
 */
export function toNativePath(url: string): string {
  let m = url.match(/^\/chat\?conversation=(\d+)/);
  if (m) return `/chat/${m[1]}`;
  // Tagged in a Lounge / watch party's chat: straight into the room.
  m = url.match(/^\/chat\?party=(\d+)/);
  if (m) return `/lounge-room/party-${m[1]}`;
  // A friend's Lounge invite: the web opens the room; the app's private
  // Lounge lists it under "Friends invited you".
  if (/^\/lounge\/[\w-]+$/.test(url)) return '/lounge-private';
  m = url.match(/^\/matchups\/(\d+)/);
  if (m) return `/matchup/${m[1]}`;
  // One trade, one player's card (injury/news), standings in League.
  m = url.match(/^\/trades\?trade=(\d+)/);
  if (m) return `/trade/${m[1]}`;
  m = url.match(/^\/team\?card=([\w-]+)/);
  if (m) return `/player/${m[1]}`;
  if (url === '/standings') return '/league?section=standings';
  m = url.match(/^\/seasons\/(\d+)\/weeks\/(\d+)\/recap/);
  if (m) return `/recap/${m[1]}/${m[2]}`;
  m = url.match(/^\/admin\/errors\?fp=([^&]+)/);
  if (m) return `/admin/errors/${m[1]}`;
  return url;
}
