import { requireOptionalNativeModule } from 'expo';
import type { RefObject } from 'react';
import { Platform, Share, TurboModuleRegistry, type View } from 'react-native';

import { WEB_BASE_URL } from '@/lib/api';

// Share a piece of the screen as an image (react-native-view-shot to
// capture it, expo-sharing for the share sheet). Both are native, and an
// over-the-air update also reaches app builds made before they were
// added — importing either there throws at load and would crash the
// app. So they're only loaded when used, and Share is hidden on a build
// that doesn't have them (it appears after the next install).
export const canShareImages =
  requireOptionalNativeModule('ExpoSharing') !== null && TurboModuleRegistry.get('RNViewShot') !== null;

const SITE = WEB_BASE_URL || 'https://weekend-league-web.vercel.app';

/** One line of text and one link, the way every share goes out
 *  (2026-11-17): on iOS the link is its own item, so Messages shows its
 *  preview card under the line; Android sends them together. */
export function shareLineAndLink(line: string, link: string): Promise<unknown> {
  return Share.share(Platform.OS === 'ios' ? { message: line, url: link } : { message: `${line}\n${link}` });
}

/** The short form printed on a shared image, where a link can't be tapped. */
export const GET_IT_TEXT = `Get it for your league · ${SITE.replace(/^https?:\/\//, '')}/waitlist`;

export async function shareViewAsImage(ref: RefObject<View | null>, dialogTitle: string): Promise<void> {
  if (!canShareImages || !ref.current) return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { captureRef } = require('react-native-view-shot') as typeof import('react-native-view-shot');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sharing = require('expo-sharing') as typeof import('expo-sharing');
  const uri = await captureRef(ref, { format: 'png', quality: 1, result: 'tmpfile' });
  if (Platform.OS === 'ios') {
    // The picture alone, like the share sheet's Post (2026-11-23): the
    // waitlist link that rode along sent friends to the website instead
    // of the app. The picture still says where to get it.
    await Share.share({ url: uri });
    return;
  }
  await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle });
}
