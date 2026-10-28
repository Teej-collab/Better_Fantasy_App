import * as SecureStore from 'expo-secure-store';

export type ThemeName = 'calm' | 'cosmic' | 'midnight' | 'graphite' | 'ember' | 'gridiron';

export const THEME_NAMES: ThemeName[] = ['calm', 'cosmic', 'midnight', 'graphite', 'ember', 'gridiron'];

// Settings > Appearance > Look, as last saved on this phone. Read
// synchronously here because every StyleSheet in the app is built from
// Colors when its file first loads — so a change applies on the next
// launch (Settings reloads the app right away; lib/appearance.ts keeps
// this in step with a choice made on the web).
export const THEME_STORE_KEY = 'wl-theme';

function storedTheme(): ThemeName {
  try {
    const saved = SecureStore.getItem(THEME_STORE_KEY) as ThemeName | null;
    return saved && THEME_NAMES.includes(saved) ? saved : 'calm';
  } catch {
    return 'calm';
  }
}

export const ActiveTheme: ThemeName = storedTheme();

// Settings > Appearance > Accent Color, saved on this phone the same way
// (lib/appearance.ts), so the many screens styled from Colors.accent at
// load use your color — not just the ones that read it live.
export const ACCENT_STORE_KEY = 'wl-accent';

function storedAccent(): string | null {
  try {
    const value = SecureStore.getItem(ACCENT_STORE_KEY);
    return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

// The web app's palettes (frontend/src/app/globals.css): Calm is the
// :root --wl-* tokens, Cosmic is [data-wl-theme="cosmic"], which swaps
// only bg/surface/border/accent — so the two apps read as one product.
// tile/tileRaised are solid versions of the web's faint white tiles (3% /
// 5% white over surface): they look the same inside a card, but stay
// readable when a tile sits straight on the honeycomb.
// 2026-10-28: four more full looks (the approved "The Weekend Themes"
// mockup), each its own background, panels and accent: Midnight (navy),
// Graphite (true black), Ember (warm charcoal) and Gridiron (field green).
const PALETTES: Record<ThemeName, { bg: string; surface: string; tile: string; tileRaised: string; border: string; accent: string }> = {
  calm: { bg: '#0d1016', surface: '#12161c', tile: '#191d23', tileRaised: '#1e2227', border: '#1c2027', accent: '#39ff14' },
  cosmic: { bg: '#0a0716', surface: '#171129', tile: '#1e182f', tileRaised: '#231d34', border: '#35285f', accent: '#39ffb0' },
  midnight: { bg: '#060a13', surface: '#0e1526', tile: '#152038', tileRaised: '#1a2642', border: '#1d2b48', accent: '#5cc8ff' },
  graphite: { bg: '#000000', surface: '#121214', tile: '#1c1c1f', tileRaised: '#232327', border: '#2a2a2e', accent: '#f2f2f7' },
  ember: { bg: '#110a07', surface: '#1a110c', tile: '#241812', tileRaised: '#2b1d16', border: '#3a2418', accent: '#ff7a2f' },
  gridiron: { bg: '#06100a', surface: '#0c1a12', tile: '#12261a', tileRaised: '#17301f', border: '#1c3a27', accent: '#b4f03a' },
};

// The brand, the same for everyone whatever their look or accent, like
// ESPN's or Sleeper's: the opening intro and the logo never take a
// theme's colors.
export const Brand = { green: '#39ff14', bg: '#0d1016' } as const;

// The Look's own accent, for "Default" in Settings.
export const DefaultAccent: string = PALETTES[ActiveTheme].accent;

export const Colors: {
  bg: string;
  surface: string;
  tile: string;
  tileRaised: string;
  border: string;
  accent: string;
  text: string;
  textSecondary: string;
  live: string;
  win: string;
  loss: string;
  discord: string;
} = {
  ...PALETTES[ActiveTheme],
  accent: storedAccent() ?? DefaultAccent,
  text: '#eceef1',
  textSecondary: '#8790a0',
  live: '#ef4444',
  win: '#22c55e',
  loss: '#f87171',
  discord: '#5865F2',
};

// A palette hex at the given opacity, e.g. the see-through surface behind
// list cards.
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// Dark or white ink for text drawn on a color the user picked (their own
// chat bubbles are their accent): whichever has more contrast, so text
// stays readable on neon green, orange, navy or anything else.
export function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  const dark = 0.0055; // #0d1016's luminance
  return (l + 0.05) / (dark + 0.05) >= 1.05 / (l + 0.05) ? '#0d1016' : '#ffffff';
}

// Each destination's color (frontend/src/lib/navDestinations.ts): the
// neon ring on its cards and its section headers.
export const SectionColors = {
  team: '#a855f7',
  home: '#f5f4ec',
  league: '#6366f1',
  standings: '#0ea5e9',
  matchups: '#ec4899',
  playerCards: '#22d3ee',
  freeAgents: '#14b8a6',
  chat: '#39ff14',
  awards: '#facc15',
  rivalries: '#f97316',
  rules: '#84cc16',
  chug: '#d97706',
  keepers: '#10b981',
  powerRankings: '#3b82f6',
  draft: '#eab308',
  gamecast: '#ef4444',
  awardsAllTime: '#ca8a04',
  history: '#f59e0b',
  trades: '#d946ef',
} as const;

// The honeycomb background's default color (frontend/src/components/
// CinematicHoneycombBackground.tsx).
// Each look has its own default (2026-10-28); a color picked in Settings
// still wins.
const THEME_HONEYCOMB: Record<ThemeName, string> = {
  calm: '#dc143c',
  cosmic: '#a855f7',
  midnight: '#2563eb',
  graphite: '#636366',
  ember: '#ea580c',
  gridiron: '#16a34a',
};
export const HoneycombColor = THEME_HONEYCOMB[ActiveTheme];

// Same families as the web (frontend/src/app/layout.tsx): Oswald for
// display type, IBM Plex Sans for body, Geist Mono for numbers. Loaded
// in app/_layout.tsx.
export const Fonts = {
  display: 'Oswald_600SemiBold',
  displayMedium: 'Oswald_500Medium',
  displayBold: 'Oswald_700Bold',
  body: 'IBMPlexSans_400Regular',
  bodyMedium: 'IBMPlexSans_500Medium',
  bodySemiBold: 'IBMPlexSans_600SemiBold',
  bodyBold: 'IBMPlexSans_700Bold',
  mono: 'GeistMono_500Medium',
  monoBold: 'GeistMono_700Bold',
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const Radius = {
  md: 12,
  lg: 16,
  pill: 999,
} as const;
