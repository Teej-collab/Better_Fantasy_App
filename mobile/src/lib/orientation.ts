import { requireOptionalNativeModule } from 'expo';

// The app is portrait everywhere; only the Lounge's full-screen TV turns
// to landscape. expo-screen-orientation arrived in build 8, and OTAs
// still reach older builds, where importing it throws — so it's only
// loaded when its native module is there. Without it, the full-screen TV
// turns the picture sideways itself (components/lounge/LoungeTv.tsx).
type ScreenOrientationModule = typeof import('expo-screen-orientation');

const ScreenOrientation: ScreenOrientationModule | null =
  requireOptionalNativeModule('ExpoScreenOrientation') !== null
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('expo-screen-orientation') as ScreenOrientationModule)
    : null;

export const canRotate = ScreenOrientation !== null;

/** Landscape (either way round) for the full-screen TV. */
export async function lockLandscape() {
  await ScreenOrientation?.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
}

/** Back to the app's portrait. */
export async function lockPortrait() {
  await ScreenOrientation?.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
}
