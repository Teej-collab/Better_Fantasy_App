import { requireOptionalNativeModule } from 'expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ImageSourcePropType } from 'react-native';

// Seasonal logos (like Snapchat's spider-web icon each October) — kept
// in step with the web's frontend/src/lib/seasonal.ts. Each season names
// a date window, its own copy of the in-app emblem, and an alternate
// home-screen icon (the expo-alternate-app-icons entry of the same name
// in app.json).

export type Season = 'Halloween';

const SEASONS: { season: Season; from: [number, number]; to: [number, number]; emblem: ImageSourcePropType }[] = [
  // Oct 1 – Nov 1 (month is 1-based here).
  { season: 'Halloween', from: [10, 1], to: [11, 1], emblem: require('@/assets/images/weekend-league-emblem-halloween.png') },
];
const DEFAULT_EMBLEM: ImageSourcePropType = require('@/assets/images/weekend-league-emblem.png');

function inWindow(date: Date, from: [number, number], to: [number, number]): boolean {
  const md = (date.getMonth() + 1) * 100 + date.getDate();
  return md >= from[0] * 100 + from[1] && md <= to[0] * 100 + to[1];
}

export function currentSeason(now: Date = new Date()): Season | null {
  return SEASONS.find((s) => inWindow(now, s.from, s.to))?.season ?? null;
}

export function seasonalEmblem(now: Date = new Date()): ImageSourcePropType {
  return SEASONS.find((s) => inWindow(now, s.from, s.to))?.emblem ?? DEFAULT_EMBLEM;
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

// Puts the season's icon on the home screen (or back to the normal one
// once the season's over). iOS shows its own "You have changed the icon"
// notice each time, so this only switches when the icon is actually
// wrong — twice a season at most.
export async function syncSeasonalAppIcon(): Promise<void> {
  if (!canChangeAppIcon) return;
  try {
    const mod = icons();
    if (!mod.supportsAlternateIcons) return;
    const wanted = (await seasonalIconEnabled()) ? currentSeason() : null;
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
