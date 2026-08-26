"use client";

// A silent (0-volume) 1-frame clip — its only job is to register a
// real "audio played after a user gesture" event with the browser, not
// to be heard. Autoplay trust (Chrome's Media Engagement Index, and
// Safari's equivalent per-site heuristic) is scored per-origin across
// *all* visits over time, not just within one page load — so every
// real tap/keypress anywhere in the app that successfully plays this
// is one more data point nudging the browser toward eventually
// granting real autoplay-with-sound on a future cold reload, which is
// the only thing that can ever make the boot intro's sound (AppEntry.tsx
// /HomeWelcomeBackEntry.tsx have zero buttons of their own to tap
// during the sequence) play with no interaction at all.
const SILENT_UNLOCK_SRC =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

let armed = false;

/**
 * Call once, as early as possible in the app's lifetime (RootLayout's
 * AudioWarmup.tsx) — arms a page-wide, one-time listener for the
 * visitor's very first tap/keypress anywhere on the site, on any page,
 * not just during the boot intro. Once *any* gesture-triggered audio
 * play succeeds on a document, that document stays unlocked for
 * further audio for the rest of its lifetime (Chrome/Safari both work
 * this way) — this just makes sure the *first* gesture on every fresh
 * page load is the one that claims that unlock, whatever it is,
 * rather than leaving it to chance whether the boot sequence itself
 * happens to get tapped.
 */
export function armGlobalAudioUnlock() {
  if (armed || typeof window === "undefined") return;
  armed = true;

  const unlock = () => {
    const el = new Audio(SILENT_UNLOCK_SRC);
    el.volume = 0;
    el.play().catch(() => {});
  };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}
