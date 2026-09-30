// The web app's default dark palette (frontend/src/app/globals.css,
// :root --wl-* tokens), so the two apps read as one product.
export const Colors = {
  bg: '#0d1016',
  surface: '#12161c',
  border: '#1c2027',
  accent: '#39ff14',
  text: '#eceef1',
  textSecondary: '#8790a0',
  live: '#ef4444',
  win: '#22c55e',
  loss: '#f87171',
  discord: '#5865F2',
} as const;

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
