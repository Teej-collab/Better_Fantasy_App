import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo';
import { router, type Href } from 'expo-router';

import type { Reminder, ReminderCategory } from '@/lib/reminders';

// Schedules lib/reminders.ts's reminders as local notifications. Native
// (expo-notifications) and, like sharing, only loaded where the build has
// it — an over-the-air update also reaches installs from before it was
// added, and importing it there would crash. Elsewhere this is a no-op.
type NotificationsModule = typeof import('expo-notifications');

export const canScheduleReminders = requireOptionalNativeModule('ExpoNotificationScheduler') !== null;

let notifications: NotificationsModule | null = null;
function load(): NotificationsModule | null {
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
async function ensurePermission(n: NotificationsModule): Promise<boolean> {
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
    content: { title: '🏈 Kickoff in 1 hour — check your lineup', body: 'This is a test reminder from Weekend League.', data: { url: '/team' } },
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
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
  const open = (url: unknown) => {
    if (typeof url === 'string' && url.startsWith('/')) router.push(url as Href);
  };
  const initial = n.getLastNotificationResponse();
  if (initial) {
    open(initial.notification.request.content.data?.url);
    // Handled — so a later launch doesn't open it again.
    n.clearLastNotificationResponse();
  }
  const sub = n.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data?.url));
  return () => sub.remove();
}
