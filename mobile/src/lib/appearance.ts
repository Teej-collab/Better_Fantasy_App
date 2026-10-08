import * as SecureStore from 'expo-secure-store';
import * as Updates from 'expo-updates';
import { useEffect } from 'react';
import { DevSettings } from 'react-native';

import { ACCENT_STORE_KEY, ActiveTheme, Colors, DefaultAccent, HoneycombColor, THEME_STORE_KEY, type ThemeName } from '@/constants/theme';
import { usePreferences } from '@/lib/queries';

const HEX = /^#[0-9a-fA-F]{6}$/;

function hexOr(value: string | null | undefined, fallback: string): string {
  return value && HEX.test(value) ? value : fallback;
}

export type Appearance = {
  theme: 'calm' | 'cosmic';
  // Settings > Appearance > Accent Color.
  accent: string;
  // The moving ring on every card: Border Animation Color, falling back
  // to the accent (globals.css's --border-glow-color → --user-accent).
  ring: string;
  // Home's Your Week card; falls back to the accent.
  yourWeek: string;
  // The honeycomb's color, or null when it's turned off. Multi-color
  // gives each light behind the wall its own color (HONEYCOMB_MULTI).
  honeycomb: string | null;
  honeycombColors: string[];
  // Settings > Appearance > Neon Intensity, as a glow strength 0–1.
  glow: number;
  // Settings > Appearance > Animations: Reduced (the device's own
  // Reduce Motion is honored separately, always).
  reducedMotion: boolean;
};

// Settings > Appearance > Background > Multi-color: one light per color
// wandering behind the wall, so the gaps glow in different colors as they
// pass (frontend/src/components/CinematicHoneycombBackground.tsx too).
export const HONEYCOMB_MULTI = ['#ec4899', '#0ea5e9', '#39ff14', '#a855f7', '#facc15'];

const GLOW_BY_INTENSITY = { subtle: 0.14, standard: 0.28, high: 0.5 } as const;

// The owner's Settings > Appearance choices (GET /settings/preferences),
// applied the way the web's layout.tsx head script applies them.
export function useAppearance(): Appearance {
  const prefs = usePreferences().data;
  // Before preferences load, the color saved on this phone (Colors.accent).
  const accent = prefs ? hexOr(prefs.accent_color, DefaultAccent) : Colors.accent;
  return {
    // The palette this launch was built with, not the saved choice:
    // the two only differ until the next launch (see useThemeSync).
    theme: ActiveTheme,
    accent,
    ring: hexOr(prefs?.border_glow_color, accent),
    yourWeek: hexOr(prefs?.your_week_color, accent),
    honeycomb: prefs?.honeycomb_color === 'off' ? null : prefs?.honeycomb_color === 'multi' ? HONEYCOMB_MULTI[3] : hexOr(prefs?.honeycomb_color, HoneycombColor),
    honeycombColors:
      prefs?.honeycomb_color === 'multi' ? HONEYCOMB_MULTI : [hexOr(prefs?.honeycomb_color, HoneycombColor)],
    glow: GLOW_BY_INTENSITY[prefs?.neon_intensity ?? 'standard'] ?? GLOW_BY_INTENSITY.standard,
    reducedMotion: prefs?.reduced_motion ?? false,
  };
}

// Which color a card's ring uses. In Calm (the default) every ring is
// the owner's ring color; only Cosmic gives each section its own —
// same rule as the web's [data-wl-theme="cosmic"] panel override.
export function ringColorFor(appearance: Appearance, sectionColor: string | undefined): string {
  return appearance.theme === 'cosmic' && sectionColor ? sectionColor : appearance.ring;
}

// Remember the Look for the next launch (constants/theme.ts reads it
// before any screen's styles are built), and reload now if it changed
// so the new palette shows right away.
export function applyTheme(theme: ThemeName): void {
  try {
    SecureStore.setItem(THEME_STORE_KEY, theme);
  } catch {
    return;
  }
  if (theme === ActiveTheme) return;
  reloadQuietly();
}

// The intro is for opening the app, not for a reload to apply a setting.
const SKIP_INTRO_KEY = 'wl-skip-intro-once';

function reloadQuietly(): void {
  try {
    SecureStore.setItem(SKIP_INTRO_KEY, '1');
  } catch {
    // Plays the intro, then.
  }
  Updates.reloadAsync().catch(() => DevSettings.reload());
}

/** True once right after reloadQuietly(), for app/_layout.tsx. */
export function takeSkipIntro(): boolean {
  try {
    if (SecureStore.getItem(SKIP_INTRO_KEY) !== '1') return false;
    void SecureStore.deleteItemAsync(SKIP_INTRO_KEY);
    return true;
  } catch {
    return false;
  }
}

function savedAccent(): string | null {
  try {
    return SecureStore.getItem(ACCENT_STORE_KEY);
  } catch {
    return null;
  }
}

function saveAccent(accent: string | null): void {
  try {
    if (accent) SecureStore.setItem(ACCENT_STORE_KEY, accent);
    else void SecureStore.deleteItemAsync(ACCENT_STORE_KEY);
  } catch {
    // Stays as it was.
  }
}

// Accent Color: saved for every screen styled at load, and reloaded now
// so the whole app changes together instead of half now, half later.
export function applyAccent(accent: string | null): void {
  const next = accent && HEX.test(accent) ? accent : null;
  if ((savedAccent() ?? null) === next) return;
  saveAccent(next);
  if ((next ?? DefaultAccent) !== Colors.accent) reloadQuietly();
}

// Picks up a Look chosen on the web (or on another phone). It's saved for
// the next launch rather than applied mid-session: reloading the app out
// from under someone would be worse than one more launch in the old look.
export function useThemeSync(): void {
  const prefs = usePreferences().data;
  const theme = prefs?.theme;
  useEffect(() => {
    if (!theme) return;
    try {
      if (SecureStore.getItem(THEME_STORE_KEY) !== theme) SecureStore.setItem(THEME_STORE_KEY, theme);
    } catch {
      // Stays in the current look.
    }
  }, [theme]);
  // Same for the accent (an accent picked on the web shows from the next launch).
  const accent = prefs ? (prefs.accent_color && HEX.test(prefs.accent_color) ? prefs.accent_color : null) : undefined;
  useEffect(() => {
    if (accent !== undefined && (savedAccent() ?? null) !== accent) saveAccent(accent);
  }, [accent]);
}
