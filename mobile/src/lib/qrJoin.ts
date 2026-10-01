import { requireOptionalNativeModule } from 'expo';

import { WEB_BASE_URL } from '@/lib/api';

// Scan-to-join. A league's QR code is a link to the web's /leagues page
// with the invite code filled in, so it works from any phone's camera
// app too — the app's own scanner just reads the code out of it.

export function joinLinkFor(inviteCode: string): string {
  return `${WEB_BASE_URL}/leagues?join=${encodeURIComponent(inviteCode)}#join-league`;
}

export type ScannedInvite = { kind: 'league' | 'co-owner'; code: string };

// Accepts a league join link, a co-owner link (/join-co-owner?code=…),
// either as an app link (weekendleague://…), or a bare code.
export function parseScannedInvite(data: string): ScannedInvite | null {
  const text = data.trim();
  const query = (name: string) => text.match(new RegExp(`[?&]${name}=([^&#]+)`))?.[1];
  const join = query('join');
  if (join) return { kind: 'league', code: decodeURIComponent(join) };
  const coOwner = /join-co-owner/.test(text) ? query('code') : undefined;
  if (coOwner) return { kind: 'co-owner', code: decodeURIComponent(coOwner) };
  // Invite codes are secrets.token_urlsafe(8) (backend routers/leagues.py).
  if (/^[A-Za-z0-9_-]{6,32}$/.test(text)) return { kind: 'league', code: text };
  return null;
}

// The camera arrived in a native build; builds from before it get this
// code over the air without the module, and expo-camera throws on
// import there.
export const canScanQr = requireOptionalNativeModule('ExpoCamera') !== null;

type CameraModule = typeof import('expo-camera');

// Closing the scanner without scanning anything sends no event, so the
// last scan's listener is dropped when the next one starts.
let activeSubscription: { remove: () => void } | null = null;

// Opens the system's own scanner (VisionKit on iOS, Google's code scanner
// on Android) and calls back with the first Weekend League invite it
// reads. Codes that aren't invites are ignored so the scanner stays up.
export async function scanInvite(onInvite: (invite: ScannedInvite) => void): Promise<'started' | 'denied' | 'unavailable'> {
  if (!canScanQr) return 'unavailable';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { CameraView, Camera } = require('expo-camera') as CameraModule;
  if (!CameraView.isModernBarcodeScannerAvailable) return 'unavailable';
  const permission = await Camera.requestCameraPermissionsAsync();
  if (!permission.granted) return 'denied';
  activeSubscription?.remove();
  const subscription = CameraView.onModernBarcodeScanned((event) => {
    const invite = parseScannedInvite(event.data);
    if (!invite) return;
    subscription.remove();
    activeSubscription = null;
    void CameraView.dismissScanner().catch(() => {});
    onInvite(invite);
  });
  activeSubscription = subscription;
  try {
    await CameraView.launchScanner({ barcodeTypes: ['qr'], isGuidanceEnabled: true, isHighlightingEnabled: true });
  } catch {
    subscription.remove();
    activeSubscription = null;
    return 'unavailable';
  }
  return 'started';
}
