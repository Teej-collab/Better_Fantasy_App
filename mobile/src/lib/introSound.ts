import * as SecureStore from 'expo-secure-store';

// Settings > Appearance > Intro Sound: when opening the app plays the
// full intro (the lights clicking on, the can cracking open and the
// pour) instead of the quick one. Saved on this phone, not the account:
// where a sound is welcome depends on the device.
export type IntroSoundMode = 'daily' | 'always' | 'off';

const MODE_KEY = 'wl-intro-sound';
const LAST_PLAYED_KEY = 'wl-intro-sound-day';
// A day starts at 4 AM, so a late Sunday Night Football check doesn't
// use up the next morning's intro.
const DAY_STARTS_AT_HOUR = 4;

export function getIntroSoundMode(): IntroSoundMode {
  try {
    const v = SecureStore.getItem(MODE_KEY);
    return v === 'always' || v === 'off' ? v : 'daily';
  } catch {
    return 'daily';
  }
}

export function setIntroSoundMode(mode: IntroSoundMode): void {
  try {
    SecureStore.setItem(MODE_KEY, mode);
  } catch {
    // Stays as it was.
  }
}

function today(): string {
  const d = new Date(Date.now() - DAY_STARTS_AT_HOUR * 3_600_000);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Whether this open gets the full intro; counts it as today's if so. */
export function takeFullIntro(): boolean {
  const mode = getIntroSoundMode();
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  try {
    if (SecureStore.getItem(LAST_PLAYED_KEY) === today()) return false;
    SecureStore.setItem(LAST_PLAYED_KEY, today());
  } catch {
    // Can't remember it, so play it.
  }
  return true;
}
