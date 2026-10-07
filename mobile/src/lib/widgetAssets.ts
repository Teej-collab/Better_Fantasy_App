import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo';

const canUseWidgets = requireOptionalNativeModule('ExpoWidgets') !== null;

// Team logos for the widgets, Lock Screen and Dynamic Island (2026-10).
// Those can't download images themselves, so the app saves each team's
// logo into the widgets' shared folder as logo-<team id>, and they load
// it from there (the backend passes the folder along in Live Activity
// updates too — backend/app/domain/live_activity.py). Initials show
// whenever a team has no logo, or it hasn't been saved yet.

const SAVED_KEY = 'wl:widget-logos';

/** The shared folder as a file:// URL ending in "/", or null. */
export function widgetAssetDir(): string | null {
  if (!canUseWidgets) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dir = (require('expo-widgets') as typeof import('expo-widgets')).widgetsDirectory;
    if (!dir) return null;
    return dir.endsWith('/') ? dir : `${dir}/`;
  } catch {
    return null;
  }
}

let saved: Record<string, string> | null = null;

async function savedLogos(): Promise<Record<string, string>> {
  if (saved) return saved;
  try {
    saved = JSON.parse((await AsyncStorage.getItem(SAVED_KEY)) ?? '{}') as Record<string, string>;
  } catch {
    saved = {};
  }
  return saved;
}

/**
 * Saves (or removes) these teams' logos. Only downloads a logo when it
 * changed since the last save. Returns once done; failures just leave
 * initials showing.
 */
export async function syncTeamLogos(teams: { teamId: number | null | undefined; url: string | null | undefined }[]): Promise<void> {
  const dir = widgetAssetDir();
  if (!dir) return;
  const { File } = await import('expo-file-system');
  const record = await savedLogos();
  let changed = false;
  for (const { teamId, url } of teams) {
    if (!teamId) continue;
    const key = String(teamId);
    const file = new File(`${dir}logo-${teamId}`);
    if (!url) {
      if (record[key]) {
        try {
          if (file.exists) file.delete();
        } catch {
          // Already gone.
        }
        delete record[key];
        changed = true;
      }
      continue;
    }
    if (record[key] === url && file.exists) continue;
    try {
      await File.downloadFileAsync(url, file, { idempotent: true });
      record[key] = url;
      changed = true;
    } catch {
      // Keep initials for now; the next sync tries again.
    }
  }
  if (changed) await AsyncStorage.setItem(SAVED_KEY, JSON.stringify(record)).catch(() => {});
}

export function initialsFor(name: string | null | undefined): string {
  const words = (name ?? '').replace(/'/g, '').split(/\s+/).filter((w) => /^[a-z0-9]/i.test(w));
  return words.slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}
