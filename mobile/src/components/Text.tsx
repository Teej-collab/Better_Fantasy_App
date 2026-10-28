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

// How far text grows with iOS Larger Text / Android font size. Was 1.5×,
// but at the larger standard sizes (2026-10, a real phone set one or two
// steps up) score blocks overlapped, table headers broke mid-word and
// the points column clipped. 1.3× still grows text noticeably for
// anyone who's turned it up while keeping these dense, number-heavy
// screens intact; tight spots also shrink to fit (adjustsFontSizeToFit).
export const MAX_FONT_SCALE = 1.3;

// Text that's already big (scores, headings) grows less, the way Apple's
// own large titles do: a 30pt score at 1.3× crowded everything around it
// on a small phone (2026-10-28 text-size pass).
const LARGE_TEXT = 24;
const LARGE_FONT_SCALE = 1.15;

// A fixed width this narrow is a column or a short label (ranks, points,
// "100%", slot names): it stays on one line and shrinks to fit instead of
// breaking mid-word when text is set larger.
const NARROW_COLUMN = 140;

// Drop-in for react-native's Text with the app's body font and color.
//
// Every Text can shrink inside a row (styles.base): React Native's
// default is not to, so a long label or a big score ran past its
// neighbor instead of wrapping (the overlapping scores a manager sent,
// 2026-10-28). A style can still set flexShrink: 0.
export function Text({ style, maxFontSizeMultiplier, numberOfLines, adjustsFontSizeToFit, minimumFontScale, ...props }: TextProps) {
  const flat = StyleSheet.flatten(style) ?? {};
  const { fontWeight, ...rest } = flat;
  const resolved = flat.fontFamily ? flat : { ...rest, fontFamily: bodyFamily(fontWeight) };
  const large = typeof flat.fontSize === 'number' && flat.fontSize >= LARGE_TEXT;
  const narrow = typeof flat.width === 'number' && flat.width <= NARROW_COLUMN && numberOfLines === undefined;
  return (
    <RNText
      {...props}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? (large ? LARGE_FONT_SCALE : MAX_FONT_SCALE)}
      numberOfLines={narrow ? 1 : numberOfLines}
      adjustsFontSizeToFit={adjustsFontSizeToFit ?? narrow}
      minimumFontScale={minimumFontScale ?? (narrow ? 0.7 : undefined)}
      style={[styles.base, resolved]}
    />
  );
}

// Oswald, uppercase, tracked out: the web's .font-display headings.
export function Display({ style, ...props }: TextProps) {
  return <Text {...props} style={[styles.display, style]} />;
}

const styles = StyleSheet.create({
  base: { color: Colors.text, flexShrink: 1 },
  display: { fontFamily: Fonts.display, textTransform: 'uppercase', letterSpacing: 1, color: Colors.text },
});
