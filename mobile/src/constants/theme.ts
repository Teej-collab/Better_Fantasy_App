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
