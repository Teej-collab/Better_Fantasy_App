import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { api } from '@/lib/api';
import { canUseWidgets } from '@/lib/homeWidget';
import { deviceId } from '@/lib/pushRegistration';
import { initialsFor, syncTeamLogos, widgetAssetDir } from '@/lib/widgetAssets';
import type { YourWeek } from '@/lib/types';
import type { MatchupActivityProps } from '@/widgets/MatchupActivity';

// Your matchup on the Lock Screen and in the Dynamic Island (2026-10).
//
// - Starts on its own when you open the app while your matchup is live
//   (iOS only lets the app start one while it's open). The backend can
//   also start it at kickoff with the device's push-to-start token
//   (iOS 17.2+), so you don't have to open the app at all.
// - The app updates it while it's open; the backend pushes updates the
//   rest of the time (backend/app/domain/live_activity.py) using the
//   token each Live Activity hands us, which we register here.
// - Ends when the matchup is final (the result stays up for a while).
// - Settings → Notifications → "Live score on Lock Screen" turns it off.

export const canUseLiveActivities = canUseWidgets && Platform.OS === 'ios';

const SETTING_KEY = 'wl:live-activity';

export async function liveActivityEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(SETTING_KEY)) !== 'off';
  } catch {
    return true;
  }
}

type Factory = typeof import('@/widgets/MatchupActivity').default;
type Activity = ReturnType<Factory['start']>;

function factory(): Factory | null {
  if (!canUseLiveActivities) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('@/widgets/MatchupActivity') as typeof import('@/widgets/MatchupActivity')).default;
  } catch {
    return null;
  }
}

function widgets(): typeof import('expo-widgets') | null {
  if (!canUseLiveActivities) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-widgets') as typeof import('expo-widgets');
  } catch {
    return null;
  }
}

export function activityPropsFor(week: YourWeek | null): MatchupActivityProps | null {
  const m = week?.matchup ?? null;
  if (!week || !m) return null;
  const myLeft = m.my_yet_to_play + m.my_in_play;
  const oppLeft = m.opponent_yet_to_play + m.opponent_in_play;
  const state: MatchupActivityProps['state'] = !m.started
    ? 'pre'
    : m.my_in_play + m.opponent_in_play > 0
      ? 'live'
      : myLeft + oppLeft === 0
        ? 'final'
        : 'between';
  const round = (n: number | null) => Math.round((n ?? 0) * 10) / 10;
  return {
    state,
    week: week.week,
    myName: week.team_name,
    oppName: m.opponent_team_name || 'Opponent',
    myScore: round(m.my_score),
    oppScore: round(m.opponent_score),
    myProjected: round(m.my_projected_total),
    oppProjected: round(m.opponent_projected_total),
    myLeft,
    oppLeft,
    winProbability: m.win_probability !== null ? Math.round(m.win_probability) : null,
    matchupId: m.matchup_id,
    updatedAt: Date.now(),
    myTeamId: week.team_id,
    oppTeamId: m.opponent_team_id,
    // Initials only when there's no picture: they sit behind the logo, and a
    // see-through logo would show them.
    myInitials: m.my_logo_url ? '' : initialsFor(m.my_owner_name ?? week.team_name),
    oppInitials: m.opponent_logo_url ? '' : initialsFor(m.opponent_owner_name ?? m.opponent_team_name),
    logoDir: widgetAssetDir(),
    // The backend adds the latest touchdown; the app doesn't track plays.
    lastPlay: null,
    moment: null,
  };
}

// Activity ids whose push token we've already handed the backend.
const registered = new Set<string>();
// The matchup each running activity follows (props are kept on the activity, not readable back).
const matchupOf = new Map<string, number>();
let lastSignature: string | null = null;

async function registerActivity(activity: Activity, matchupId?: number) {
  const id = activity.getId();
  if (matchupId !== undefined) matchupOf.set(id, matchupId);
  const send = async (token: string | null) => {
    const device = await deviceId();
    if (!token || !device) return;
    await api.registerLiveActivityToken({
      kind: 'activity',
      token,
      device_id: device,
      activity_id: id,
      matchup_id: matchupOf.get(id),
      asset_dir: widgetAssetDir() ?? undefined,
    });
    registered.add(id);
  };
  activity.addPushTokenListener((e) => void send(e.pushToken).catch(() => {}));
  if (!registered.has(id)) await send(await activity.getPushToken()).catch(() => {});
}

/**
 * Called whenever /me/week loads. Starts, updates or ends the Live
 * Activity to match. Safe to call often: an unchanged matchup is skipped.
 */
export async function syncLiveActivity(week: YourWeek | null): Promise<void> {
  const f = factory();
  if (!f) return;
  const props = activityPropsFor(week);
  const running = f.getInstances();
  if (!(await liveActivityEnabled())) {
    if (running.length) await endAll();
    return;
  }

  // Anything running for a different matchup (last week's, another league's) ends now.
  for (const a of running) {
    const followed = matchupOf.get(a.getId());
    if (props === null || (followed !== undefined && followed !== props.matchupId)) {
      await a.end('immediate').catch(() => {});
      void api.endLiveActivity({ activity_id: a.getId() }).catch(() => {});
    }
  }
  if (!props) return;
  const current = f.getInstances();

  if (props.state === 'final') {
    for (const a of current) await a.end('default', props).catch(() => {});
    return;
  }

  const { updatedAt: _ignored, ...rest } = props;
  const signature = JSON.stringify(rest);
  if (current.length === 0) {
    // Only start once games are underway — not hours ahead.
    if (props.state !== 'live') return;
    // Logos onto the phone first, so they're there from the first frame.
    await syncTeamLogos([
      { teamId: week?.team_id, url: week?.matchup?.my_logo_url },
      { teamId: week?.matchup?.opponent_team_id, url: week?.matchup?.opponent_logo_url },
    ]).catch(() => {});
    try {
      const activity = f.start(props, `weekendleague://matchup/${props.matchupId}`);
      lastSignature = signature;
      await registerActivity(activity, props.matchupId);
    } catch {
      // Live Activities turned off for the app in iPhone Settings, or iOS refused.
    }
    return;
  }

  // Started remotely by the backend, or after a relaunch: make sure the backend has its token.
  for (const a of current) {
    if (!matchupOf.has(a.getId())) matchupOf.set(a.getId(), props.matchupId);
    if (!registered.has(a.getId())) await registerActivity(a, props.matchupId);
  }
  if (signature === lastSignature) return;
  lastSignature = signature;
  for (const a of current) await a.update(props).catch(() => {});
}

/** Hands the backend this device's push-to-start token, once it's available. */
export function listenForPushToStart(): () => void {
  const w = widgets();
  if (!w) return () => {};
  const sub = w.addPushToStartTokenListener((e) => {
    void (async () => {
      if (!(await liveActivityEnabled())) return;
      const device = await deviceId();
      if (!device) return;
      await api.registerLiveActivityToken({ kind: 'start', token: e.activityPushToStartToken, device_id: device, asset_dir: widgetAssetDir() ?? undefined });
    })().catch(() => {});
  });
  return () => sub.remove();
}

/** Ends every Live Activity and tells the backend to stop (sign-out, or the setting turned off). */
export async function endAll(): Promise<void> {
  const f = factory();
  for (const a of f?.getInstances() ?? []) await a.end('immediate').catch(() => {});
  registered.clear();
  matchupOf.clear();
  lastSignature = null;
  const device = await deviceId();
  if (device) await api.endLiveActivity({ device_id: device }).catch(() => {});
}

export async function setLiveActivityEnabled(on: boolean): Promise<void> {
  await AsyncStorage.setItem(SETTING_KEY, on ? 'on' : 'off').catch(() => {});
  if (!on) await endAll();
}
