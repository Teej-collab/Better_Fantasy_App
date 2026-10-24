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

// "Get this for your league" (2026-10-24): every card shared outside the
// app carries a link to the 2027 waitlist page, tagged with which card it
// was (ref=share-week-awards…) so the waitlist shows which shares bring
// people in.
export function getItLink(source: string): string {
  const slug = source
    .toLowerCase()
    .replace(/\d+/g, '')
    .replace(/[^a-z]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
  return `${SITE}/waitlist?ref=share-${slug || 'card'}`;
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
    // iOS's own sheet sends the image and a line of text together, so the
    // link arrives tappable in a text thread.
    await Share.share({ url: uri, message: `${dialogTitle} · Get this for your league: ${getItLink(dialogTitle)}` });
    return;
  }
  await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle });
}
