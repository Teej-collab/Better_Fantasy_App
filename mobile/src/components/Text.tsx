import { StyleSheet, Text as RNText, type TextProps } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';

// Custom fonts on iOS don't synthesize weights: each weight is its own
// family, and setting fontWeight on top of one can fall back to the
// system font. So pick the IBM Plex family from fontWeight here, and
// drop fontWeight, unless a style already chose its own family (Oswald
// headings, Geist Mono numbers).
function bodyFamily(weight: string | number | undefined): string {
  const w = Number(weight === 'bold' ? 700 : weight === 'normal' || weight === undefined ? 400 : weight);
  if (w >= 700) return Fonts.bodyBold;
  if (w >= 600) return Fonts.bodySemiBold;
  if (w >= 500) return Fonts.bodyMedium;
  return Fonts.body;
}

// How far text grows with iOS Larger Text / Android font size. 1.5×
// covers every standard size (the largest is about 1.35×) and the first
// accessibility sizes; past that, fixed-size rows, pills and score
// blocks would clip. Tight spots pass a lower maxFontSizeMultiplier.
export const MAX_FONT_SCALE = 1.5;

// Drop-in for react-native's Text with the app's body font and color.
export function Text({ style, maxFontSizeMultiplier = MAX_FONT_SCALE, ...props }: TextProps) {
  const flat = StyleSheet.flatten(style) ?? {};
  const { fontWeight, ...rest } = flat;
  const resolved = flat.fontFamily ? flat : { ...rest, fontFamily: bodyFamily(fontWeight) };
  return <RNText {...props} maxFontSizeMultiplier={maxFontSizeMultiplier} style={[styles.base, resolved]} />;
}

// Oswald, uppercase, tracked out: the web's .font-display headings.
export function Display({ style, ...props }: TextProps) {
  return <Text {...props} style={[styles.display, style]} />;
}

const styles = StyleSheet.create({
  base: { color: Colors.text },
  display: { fontFamily: Fonts.display, textTransform: 'uppercase', letterSpacing: 1, color: Colors.text },
});
