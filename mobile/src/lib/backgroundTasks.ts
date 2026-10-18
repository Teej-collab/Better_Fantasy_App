import { requireOptionalNativeModule } from 'expo';

import { api, setSessionToken } from '@/lib/api';
import { readSavedToken } from '@/lib/auth';
import { updateMatchupWidget } from '@/lib/homeWidget';

// Game-day widget refresh (2026-10): while NFL games are live, the backend
// sends iOS devices a silent push every 15 minutes
// (backend/app/domain/live_activity.py). iOS wakes the app in the
// background — when it decides to, a few times an hour at most — and this
// task loads /me/week and hands the home-screen widget the new score, so
// it stays current without opening the app.
//
// Defined at module scope from index.ts, before the app itself loads,
// because a background launch runs only this task. Needs the
// expo-task-manager native module; older builds skip it.

const TASK = 'wl-background-refresh';

if (requireOptionalNativeModule('ExpoTaskManager') && requireOptionalNativeModule('ExpoNotificationsHandlerModule')) {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const TaskManager = require('expo-task-manager') as typeof import('expo-task-manager');
  const Notifications = require('expo-notifications') as typeof import('expo-notifications');
  /* eslint-enable @typescript-eslint/no-require-imports */

  TaskManager.defineTask(TASK, async () => {
    try {
      const token = await readSavedToken();
      if (!token) return Notifications.BackgroundNotificationTaskResult.NoData;
      setSessionToken(token);
      const [week, team, scoreboard] = await Promise.all([
        api.myWeek(),
        api.myTeam().catch(() => null),
        api.nflScoreboard().catch(() => null),
      ]);
      updateMatchupWidget(week, { team, games: scoreboard?.games ?? [] });
      return Notifications.BackgroundNotificationTaskResult.NewData;
    } catch {
      return Notifications.BackgroundNotificationTaskResult.Failed;
    }
  });
  Notifications.registerTaskAsync(TASK).catch(() => {});
}
