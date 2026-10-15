// Settings > Appearance > Intro Sound: when the Welcome Back intro on
// Home (and the sign-in screen's) plays in full, with its sounds,
// instead of the quick version. Saved in this browser, not the account:
// where a sound is welcome depends on the device. Same rule as the
// app's mobile/src/lib/introSound.ts.
export type IntroSoundMode = "daily" | "always" | "off";

const MODE_KEY = "wl_intro_sound";
const LAST_PLAYED_KEY = "wl_intro_sound_day";
// A day starts at 4 AM, so a late Sunday Night Football check doesn't
// use up the next morning's intro.
const DAY_STARTS_AT_HOUR = 4;

export function getIntroSoundMode(): IntroSoundMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === "always" || v === "off" ? v : "daily";
  } catch {
    return "daily";
  }
}

export function setIntroSoundMode(mode: IntroSoundMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Stays as it was.
  }
}

function today(): string {
  const d = new Date(Date.now() - DAY_STARTS_AT_HOUR * 3_600_000);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Whether this load gets the full intro; counts it as today's if so. */
export function takeFullIntro(): boolean {
  const mode = getIntroSoundMode();
  if (mode === "off") return false;
  if (mode === "always") return true;
  try {
    if (localStorage.getItem(LAST_PLAYED_KEY) === today()) return false;
    localStorage.setItem(LAST_PLAYED_KEY, today());
  } catch {
    // Can't remember it, so play it.
  }
  return true;
}
