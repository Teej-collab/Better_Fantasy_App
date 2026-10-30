import { requireOptionalNativeModule } from 'expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ImageSourcePropType } from 'react-native';

import { hasSkia } from '@/lib/skia';

// Seasonal logos (like Snapchat's spider-web icon each October) — kept
// in step with the web's frontend/src/lib/seasonal.ts. Each season names
// a date window, its own copy of the in-app emblem, and an alternate
// home-screen icon (the expo-alternate-app-icons entry of the same name
// in app.json). A window may cross New Year (winter).

export type Season = 'Halloween' | 'Winter';

// `pour`: the same emblem with its lit cell (orange, pumpkin, ice) left
// empty, for the Hive Toss, which pours that cell itself (2026-10-30).
const SEASONS: { season: Season; from: [number, number]; to: [number, number]; emblem: ImageSourcePropType; pour: ImageSourcePropType }[] = [
  // Month is 1-based here.
  {
    season: 'Halloween',
    from: [10, 1],
    to: [11, 1],
    emblem: require('@/assets/images/the-weekend-emblem-halloween.png'),
    pour: require('@/assets/images/the-weekend-emblem-pour-halloween.png'),
  },
  {
    season: 'Winter',
    from: [12, 1],
    to: [1, 2],
    emblem: require('@/assets/images/the-weekend-emblem-winter.png'),
    pour: require('@/assets/images/the-weekend-emblem-pour-winter.png'),
  },
];
const DEFAULT_EMBLEM: ImageSourcePropType = require('@/assets/images/the-weekend-emblem.png');
const DEFAULT_POUR: ImageSourcePropType = require('@/assets/images/the-weekend-emblem-pour.png');

function inWindow(date: Date, from: [number, number], to: [number, number]): boolean {
  const md = (date.getMonth() + 1) * 100 + date.getDate();
  const start = from[0] * 100 + from[1];
  const end = to[0] * 100 + to[1];
  return start <= end ? md >= start && md <= end : md >= start || md <= end;
}

export function currentSeason(now: Date = new Date()): Season | null {
  return SEASONS.find((s) => inWindow(now, s.from, s.to))?.season ?? null;
}

export function seasonalEmblem(now: Date = new Date()): ImageSourcePropType {
  return SEASONS.find((s) => inWindow(now, s.from, s.to))?.emblem ?? DEFAULT_EMBLEM;
}

export function seasonalPourEmblem(now: Date = new Date()): ImageSourcePropType {
  return SEASONS.find((s) => inWindow(now, s.from, s.to))?.pour ?? DEFAULT_POUR;
}

// ---- Home-screen icon ----

// Only in builds with the native module (older builds get this code over
// the air without it, and expo-alternate-app-icons throws on import there).
export const canChangeAppIcon = requireOptionalNativeModule('ExpoAlternateAppIcons') !== null;

const ICON_SETTING_KEY = 'wl:seasonal-app-icon';

type IconsModule = typeof import('expo-alternate-app-icons');
function icons(): IconsModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-alternate-app-icons') as IconsModule;
}

export async function seasonalIconEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ICON_SETTING_KEY)) !== 'off';
  } catch {
    return true;
  }
}

// The home-screen icons were redrawn for build 10 (the Hive Mark) under
// new names: iOS caches an alternate icon by name, so the old names kept
// showing the old pictures. Builds before 10 (no Skia, which came in the
// same build) only have the old names.
function iconName(season: Season): string {
  if (!hasSkia) return season;
  return season === 'Halloween' ? 'HalloweenHive' : 'WinterIce';
}

// Puts the season's icon on the home screen (or back to the normal one
// once the season's over). iOS shows its own "You have changed the icon"
// notice each time, so this only switches when the icon is actually
// wrong — twice a season at most.
export async function syncSeasonalAppIcon(): Promise<void> {
  if (!canChangeAppIcon) return;
  try {
    const mod = icons();
    if (!mod.supportsAlternateIcons) return;
    const season = (await seasonalIconEnabled()) ? currentSeason() : null;
    const wanted = season ? iconName(season) : null;
    if (mod.getAppIconName() === wanted) return;
    await mod.setAlternateAppIcon(wanted);
  } catch {
    // Keeps whatever icon it has.
  }
}

export async function setSeasonalIconEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(ICON_SETTING_KEY, enabled ? 'on' : 'off');
  } catch {
    // Not remembered; the switch below still applies now.
  }
  await syncSeasonalAppIcon();
}
