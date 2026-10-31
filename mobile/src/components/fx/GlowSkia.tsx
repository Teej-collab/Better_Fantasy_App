import { BlurMask, Canvas, Glyphs, Group, Path, RoundedRect, Skia, type SkTypeface } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Image, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type TextLayoutLine, type TextStyle, type ViewStyle } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { Text } from '@/components/Text';
import { canvasFits } from '@/lib/skia';

// The real-light versions of the app's glows (build 10 on), behind the
// plain ones in Glow.tsx: a box's halo, a line drawing's neon, and text
// glowing in its own shape. Only required where Skia exists.

// ---- A box's halo ----

export function GlowBoxSkia(props: {
  color: string;
  radius: number;
  intensity: number;
  spread: number;
  opacity?: SharedValue<number>;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const { color, radius, intensity, spread, opacity, style, children } = props;
  const [size, setSize] = useState({ w: 0, h: 0 });
  const pad = spread * 2;
  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  return (
    <View style={style} onLayout={onLayout}>
      {size.w > 0 && canvasFits(size.w + pad * 2, size.h + pad * 2) && (
        <Canvas pointerEvents="none" style={{ position: 'absolute', left: -pad, top: -pad, width: size.w + pad * 2, height: size.h + pad * 2 }}>
          <Group opacity={opacity ?? 1}>
            <RoundedRect x={pad} y={pad} width={size.w} height={size.h} r={radius} color={color} opacity={intensity}>
              <BlurMask blur={spread} style="outer" />
            </RoundedRect>
          </Group>
        </Canvas>
      )}
      {children}
    </View>
  );
}

// ---- A line drawing in neon (24-unit SVG paths) ----

export function GlowIconSkia({ paths, color, size, width }: { paths: string[]; color: string; size: number; width: number }) {
  const pad = 8;
  const path = useMemo(() => {
    const p = Skia.Path.Make();
    paths.forEach((d) => {
      const one = Skia.Path.MakeFromSVGString(d);
      if (one) p.addPath(one);
    });
    p.transform(Skia.Matrix().translate(pad, pad).scale(size / 24, size / 24));
    return p;
  }, [paths, size]);
  return (
    <View style={{ width: size, height: size }}>
      <Canvas pointerEvents="none" style={{ position: 'absolute', left: -pad, top: -pad, width: size + pad * 2, height: size + pad * 2 }}>
        <Path path={path} style="stroke" strokeWidth={width * 2.4} strokeCap="round" strokeJoin="round" color={color} opacity={0.55}>
          <BlurMask blur={4} style="normal" />
        </Path>
        <Path path={path} style="stroke" strokeWidth={width} strokeCap="round" strokeJoin="round" color={color}>
          <BlurMask blur={0.8} style="solid" />
        </Path>
        <Path path={path} style="stroke" strokeWidth={width * 0.4} strokeCap="round" strokeJoin="round" color="rgba(255,255,255,0.55)" />
      </Canvas>
    </View>
  );
}

// ---- Text glowing in its own shape ----

// The app's fonts (app/_layout.tsx) as files Skia can read.
const FONT_FILES: Record<string, number> = {
  Anton_400Regular: require('@expo-google-fonts/anton/400Regular/Anton_400Regular.ttf'),
  Satisfy_400Regular: require('@expo-google-fonts/satisfy/400Regular/Satisfy_400Regular.ttf'),
  Oswald_500Medium: require('@expo-google-fonts/oswald/500Medium/Oswald_500Medium.ttf'),
  Oswald_600SemiBold: require('@expo-google-fonts/oswald/600SemiBold/Oswald_600SemiBold.ttf'),
  Oswald_700Bold: require('@expo-google-fonts/oswald/700Bold/Oswald_700Bold.ttf'),
  IBMPlexSans_400Regular: require('@expo-google-fonts/ibm-plex-sans/400Regular/IBMPlexSans_400Regular.ttf'),
  IBMPlexSans_500Medium: require('@expo-google-fonts/ibm-plex-sans/500Medium/IBMPlexSans_500Medium.ttf'),
  IBMPlexSans_600SemiBold: require('@expo-google-fonts/ibm-plex-sans/600SemiBold/IBMPlexSans_600SemiBold.ttf'),
  IBMPlexSans_700Bold: require('@expo-google-fonts/ibm-plex-sans/700Bold/IBMPlexSans_700Bold.ttf'),
  GeistMono_500Medium: require('@expo-google-fonts/geist-mono/500Medium/GeistMono_500Medium.ttf'),
  GeistMono_700Bold: require('@expo-google-fonts/geist-mono/700Bold/GeistMono_700Bold.ttf'),
};

// Each font is read once for the whole app.
const typefaces = new Map<string, Promise<SkTypeface | null>>();
function loadTypeface(family: string): Promise<SkTypeface | null> {
  let p = typefaces.get(family);
  if (!p) {
    const file = FONT_FILES[family];
    p = file
      ? Skia.Data.fromURI(Image.resolveAssetSource(file).uri)
          .then((data) => Skia.Typeface.MakeFreeTypeFaceFromData(data))
          .catch(() => null)
      : Promise.resolve(null);
    typefaces.set(family, p);
  }
  return p;
}

function familyOf(style: TextStyle): string {
  if (style.fontFamily && FONT_FILES[style.fontFamily]) return style.fontFamily;
  const w = String(style.fontWeight ?? '400');
  return w === '700' || w === 'bold' || w === '800' || w === '900' ? 'IBMPlexSans_700Bold' : w === '600' ? 'IBMPlexSans_600SemiBold' : w === '500' ? 'IBMPlexSans_500Medium' : 'IBMPlexSans_400Regular';
}

/** Text with a real glow drawn in its own letter shapes behind it. The
 *  glow's color and size come from the style's textShadowColor and
 *  textShadowRadius, so it drops in where those were faking it. */
export function GlowTextSkia({ style, children, numberOfLines }: { style?: StyleProp<TextStyle>; children: string; numberOfLines?: number }) {
  const flat = StyleSheet.flatten(style) ?? {};
  const { textShadowColor, textShadowRadius, textShadowOffset: _offset, ...rest } = flat;
  // Placement in the parent (margins, flex, alignSelf, position) moves to
  // the wrapper so the text sits where it did; the rest stays on the text.
  const outer: ViewStyle = {};
  const textStyle: TextStyle = {};
  for (const [k, v] of Object.entries(rest)) {
    if (/^(margin|flex|alignSelf|position|top|left|right|bottom|zIndex|maxWidth|minWidth|width)/.test(k)) (outer as Record<string, unknown>)[k] = v;
    else (textStyle as Record<string, unknown>)[k] = v;
  }
  if (outer.flexShrink === undefined) outer.flexShrink = 1;
  const family = familyOf(flat);
  const [typeface, setTypeface] = useState<SkTypeface | null>(null);
  const [lines, setLines] = useState<TextLayoutLine[]>([]);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    let live = true;
    void loadTypeface(family).then((t) => live && setTypeface(t));
    return () => {
      live = false;
    };
  }, [family]);

  const fontSize = flat.fontSize ?? 14;
  const spacing = flat.letterSpacing ?? 0;
  const color = (textShadowColor as string | undefined) ?? (flat.color as string | undefined) ?? '#ffffff';
  const blur = Math.max(3, (textShadowRadius ?? 10) * 0.8);
  const pad = blur * 3;
  const glyphRuns = useMemo(() => {
    if (!typeface) return [];
    const base = Skia.Font(typeface, fontSize);
    const ascent = -base.getMetrics().ascent;
    return lines.map((line) => {
      // Larger Text scales the real text; match it from the line's own height.
      const font = ascent > 0 && line.ascender > 0 ? Skia.Font(typeface, (fontSize * line.ascender) / ascent) : base;
      const ids = font.getGlyphIDs(line.text.replace(/\n$/, ''));
      const widths = font.getGlyphWidths(ids);
      let x = line.x + pad;
      const y = line.y + line.ascender + pad;
      const glyphs = ids.map((id, i) => {
        const g = { id, pos: { x, y } };
        x += widths[i] + spacing;
        return g;
      });
      return { font, glyphs };
    });
  }, [typeface, lines, fontSize, spacing, pad]);

  return (
    <View style={outer} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {box.w > 0 && glyphRuns.length > 0 && canvasFits(box.w + pad * 2, box.h + pad * 2) && (
        <Canvas pointerEvents="none" style={{ position: 'absolute', left: -pad, top: -pad, width: box.w + pad * 2, height: box.h + pad * 2 }}>
          {glyphRuns.map((run, i) => (
            <Group key={i}>
              <Glyphs font={run.font} glyphs={run.glyphs} color={color} opacity={0.9}>
                <BlurMask blur={blur} style="normal" />
              </Glyphs>
              <Glyphs font={run.font} glyphs={run.glyphs} color={color} opacity={0.6}>
                <BlurMask blur={blur * 0.35} style="normal" />
              </Glyphs>
            </Group>
          ))}
        </Canvas>
      )}
      <Text style={textStyle} numberOfLines={numberOfLines} onTextLayout={(e) => setLines(e.nativeEvent.lines)}>
        {children}
      </Text>
    </View>
  );
}
