import { clearSharedPayloads, getResolvedSharedPayloadsAsync, getSharedPayloads } from 'expo-sharing';

// The Weekend in the share sheet (expo-sharing's share extension,
// app.json): sharing a bet slip from a sportsbook app opens the app
// with a weekendleague://expo-sharing link, which app/+native-intent.tsx
// turns into Add a Bet; that screen takes the share from here — a
// screenshot, or a shared-bet link (DraftKings' Share button), which
// components/bets/BetLinkReader.tsx opens and reads.

export type SharedSlip = { kind: 'image'; uri: string } | { kind: 'link'; url: string };

export function isShareLink(path: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\/expo-sharing(?:[/?#]|$)/i.test(path);
}

/** What was shared — an image wins over a link — then forgets the
 *  share. Null if it was neither. */
export async function takeSharedSlip(): Promise<SharedSlip | null> {
  try {
    const raw = getSharedPayloads();
    // Anything besides text and links might be the screenshot.
    if (raw.some((p) => p.shareType !== 'url' && p.shareType !== 'text')) {
      const payloads = await getResolvedSharedPayloadsAsync();
      const image = payloads.find((p) => p.contentUri && (p.contentType === 'image' || p.contentMimeType?.startsWith('image/')));
      if (image?.contentUri) return { kind: 'image', uri: image.contentUri };
    }
    // A link comes as a url, or inside a message ("Check out my bet! https://…").
    for (const p of raw) {
      const url = p.shareType === 'url' || p.shareType === 'text' ? firstLink(p.value) : null;
      if (url) return { kind: 'link', url };
    }
    return null;
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

export function firstLink(text: string | undefined): string | null {
  const match = text?.match(/https:\/\/[^\s<>"']+/i);
  return match ? match[0].replace(/[).,!?]+$/, '') : null;
}
