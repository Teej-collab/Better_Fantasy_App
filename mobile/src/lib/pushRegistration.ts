import * as Application from 'expo-application';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { api } from '@/lib/api';
import { ensurePermission, load } from '@/lib/localNotifications';

// Real push (2026-10): hands this phone's APNs token to the backend
// (POST /push/native/register), which sends trade offers, waiver
// results, chat and injury alerts straight to it — the same events the
// web's Web Push already gets. iOS only for now.
//
// Asked once the owner is in a league (there's nothing to notify about
// before that), and re-sent on each launch since iOS can rotate tokens.
// Builds run from Xcode get sandbox tokens; the backend retries those
// on APNs' sandbox, so debug builds get pushes too.

let registered: string | null = null;

async function deviceId(): Promise<string | null> {
  if (Platform.OS !== 'ios') return null;
  return Application.getIosIdForVendorAsync().catch(() => null);
}

export async function registerForPush(): Promise<boolean> {
  const n = load();
  if (!n || Platform.OS !== 'ios' || !Device.isDevice) return false;
  if (!(await ensurePermission(n))) return false;
  const [token, id] = await Promise.all([n.getDevicePushTokenAsync(), deviceId()]);
  if (!id || typeof token.data !== 'string') return false;
  if (registered === `${id}:${token.data}`) return true;
  await api.registerNativePush({
    device_id: id,
    platform: 'ios',
    push_token: token.data,
    app_version: Application.nativeApplicationVersion,
    os_version: Device.osVersion,
  });
  registered = `${id}:${token.data}`;
  return true;
}

/** Called before signing out, while the session still works, so the
 * next person to sign in on this phone doesn't get this account's pushes. */
export async function unregisterForPush(): Promise<void> {
  if (registered === null) return;
  const id = await deviceId();
  registered = null;
  if (id) await api.unregisterNativePush(id);
}
