import { TurboModuleRegistry } from 'react-native';

// Skia (real blur, glow and gradient text, for the Hive Toss and Weather
// Watch) arrived with build 10. Over-the-air updates also reach older
// builds without it, where importing it throws, so anything drawn with
// Skia is only required once this says the native side is there.
export const hasSkia = TurboModuleRegistry.get('RNSkiaModule') != null;
