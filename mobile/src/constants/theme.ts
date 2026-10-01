import * as SecureStore from 'expo-secure-store';

export type ThemeName = 'calm' | 'cosmic';

// Settings > Appearance > Look, as last saved on this phone. Read
// synchronously here because every StyleSheet in the app is built from
// Colors when its file first loads — so a change applies on the next
// launch (Settings reloads the app right away; lib/appearance.ts keeps
// this in step with a choice made on the web).
export const THEME_STORE_KEY = 'wl-theme';

function storedTheme(): ThemeName {
  try {
    return SecureStore.getItem(THEME_STORE_KEY) === 'cosmic' ? 'cosmic' : 'calm';
  } catch {
    return 'calm';
  }
}

export const ActiveTheme: ThemeName = storedTheme();

// The web app's palettes (frontend/src/app/globals.css): Calm is the
// :root --wl-* tokens, Cosmic is [data-wl-theme="cosmic"], which swaps
// only bg/surface/border/accent — so the two apps read as one product.
// tile/tileRaised are solid versions of the web's faint white tiles (3% /
// 5% white over surface): they look the same inside a card, but stay
// readable when a tile sits straight on the honeycomb.
const PALETTES = {
  calm: { bg: '#0d1016', surface: '#12161c', tile: '#191d23', tileRaised: '#1e2227', border: '#1c2027', accent: '#39ff14' },
  cosmic: { bg: '#0a0716', surface: '#171129', tile: '#1e182f', tileRaised: '#231d34', border: '#35285f', accent: '#39ffb0' },
} as const;

export const Colors = {
  ...PALETTES[ActiveTheme],
  text: '#eceef1',
  textSecondary: '#8790a0',
  live: '#ef4444',
  win: '#22c55e',
  loss: '#f87171',
  discord: '#5865F2',
} as const;

// A palette hex at the given opacity, e.g. the see-through surface behind
// list cards.
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
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
export const HoneycombColor = '#dc143c';

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
