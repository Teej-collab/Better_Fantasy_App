import { Colors, HoneycombColor } from '@/constants/theme';
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
  // The honeycomb's color, or null when it's turned off.
  honeycomb: string | null;
  // Settings > Appearance > Neon Intensity, as a glow strength 0–1.
  glow: number;
  // Settings > Appearance > Animations: Reduced (the device's own
  // Reduce Motion is honored separately, always).
  reducedMotion: boolean;
};

const GLOW_BY_INTENSITY = { subtle: 0.14, standard: 0.28, high: 0.5 } as const;

// The owner's Settings > Appearance choices (GET /settings/preferences),
// applied the way the web's layout.tsx head script applies them.
export function useAppearance(): Appearance {
  const prefs = usePreferences().data;
  const accent = hexOr(prefs?.accent_color, Colors.accent);
  return {
    theme: prefs?.theme === 'cosmic' ? 'cosmic' : 'calm',
    accent,
    ring: hexOr(prefs?.border_glow_color, accent),
    yourWeek: hexOr(prefs?.your_week_color, accent),
    honeycomb: prefs?.honeycomb_color === 'off' ? null : hexOr(prefs?.honeycomb_color, HoneycombColor),
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
