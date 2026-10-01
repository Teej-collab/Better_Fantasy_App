import { requireOptionalNativeModule } from 'expo';
import type { RefObject } from 'react';
import { TurboModuleRegistry, type View } from 'react-native';

// Share a piece of the screen as an image (react-native-view-shot to
// capture it, expo-sharing for the share sheet). Both are native, and an
// over-the-air update also reaches app builds made before they were
// added — importing either there throws at load and would crash the
// app. So they're only loaded when used, and Share is hidden on a build
// that doesn't have them (it appears after the next install).
export const canShareImages =
  requireOptionalNativeModule('ExpoSharing') !== null && TurboModuleRegistry.get('RNViewShot') !== null;

export async function shareViewAsImage(ref: RefObject<View | null>, dialogTitle: string): Promise<void> {
  if (!canShareImages || !ref.current) return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { captureRef } = require('react-native-view-shot') as typeof import('react-native-view-shot');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sharing = require('expo-sharing') as typeof import('expo-sharing');
  const uri = await captureRef(ref, { format: 'png', quality: 1, result: 'tmpfile' });
  await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle });
}
