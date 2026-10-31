import { PixelRatio, TurboModuleRegistry } from 'react-native';

// Skia (real blur, glow and gradient text, for the Hive Toss and Weather
// Watch) arrived with build 10. Over-the-air updates also reach older
// builds without it, where importing it throws, so anything drawn with
// Skia is only required once this says the native side is there.
export const hasSkia = TurboModuleRegistry.get('RNSkiaModule') != null;

// Whether a Skia canvas `w`×`h` points can be drawn. Its drawing surface
// is a GPU texture at the screen's pixel scale, and iOS aborts the app
// when that texture is too big for the GPU (or empty) — Lorenzo's
// iPhone 14 on Free Agents, 2026-10-31: MTLTextureDescriptor validation
// in RNSkMetalCanvasProvider. Glows sized to what they wrap (a card, a
// long list) are skipped past this size instead; the card still shows.
const MAX_CANVAS_PIXELS = 8192;

export function canvasFits(w: number, h: number): boolean {
  const scale = PixelRatio.get();
  return Number.isFinite(w) && Number.isFinite(h) && w >= 1 && h >= 1 && w * scale <= MAX_CANVAS_PIXELS && h * scale <= MAX_CANVAS_PIXELS;
}
