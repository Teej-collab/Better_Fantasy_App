// Every color choice in Settings > Appearance (and Chat Bubble Color) works
// the same way (2026-10): Default, Multi, a few curated colors, or any color
// from the picker. "multi" means something per setting — see lib/appearance.ts.
export const MULTI = 'multi';

// Multi's colors, in order (also the web's — keep the two the same).
export const MULTI_COLORS = ['#ec4899', '#0ea5e9', '#39ff14', '#a855f7', '#facc15'];

export const COLOR_PRESETS = [
  { name: 'Green', hex: '#39ff14' },
  { name: 'Blue', hex: '#0ea5e9' },
  { name: 'Pink', hex: '#ec4899' },
  { name: 'Gold', hex: '#facc15' },
  { name: 'Purple', hex: '#a855f7' },
];

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: string | null | undefined): value is string {
  return !!value && HEX.test(value);
}

export function isMulti(value: string | null | undefined): boolean {
  return value === MULTI;
}
