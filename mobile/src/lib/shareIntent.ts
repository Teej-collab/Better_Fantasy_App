import { clearSharedPayloads, getResolvedSharedPayloadsAsync } from 'expo-sharing';

// The Weekend in the share sheet (expo-sharing's share extension,
// app.json): sharing a bet slip from a sportsbook app opens the app
// with a weekendleague://expo-sharing link, which app/+native-intent.tsx
// turns into Add a Bet; that screen takes the image from here.

export function isShareLink(path: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\/expo-sharing(?:[/?#]|$)/i.test(path);
}

/** The first shared image's file, then forgets the share. Null if none. */
export async function takeSharedSlipImage(): Promise<string | null> {
  try {
    const payloads = await getResolvedSharedPayloadsAsync();
    const image = payloads.find((p) => p.contentUri && (p.contentType === 'image' || p.contentMimeType?.startsWith('image/')));
    return image?.contentUri ?? null;
  } catch {
    return null;
  } finally {
    try {
      clearSharedPayloads();
    } catch {
      // Nothing to clear.
    }
  }
}
