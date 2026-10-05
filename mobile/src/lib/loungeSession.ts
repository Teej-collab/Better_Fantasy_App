import { NativeModules } from 'react-native';

// The native Lounge (components/lounge/LeagueLoungeRoom.tsx) needs
// LiveKit's WebRTC module, which only exists in our own Xcode builds —
// Expo Go doesn't have it. Checked before ever loading LiveKit, so an
// Expo Go session falls back to the web Lounge instead of crashing.
export function nativeLoungeAvailable(): boolean {
  return NativeModules.WebRTCModule != null;
}

export type LoungeTicket = { token: string; url: string; roomName: string; slug: string };

// Watch Party calls (League Lounge included) use the same native room
// screen, under a "party-<id>" slug so it knows which token endpoint to
// use and that there's no invite link to share.
export function partySlug(roomId: number): string {
  return `party-${roomId}`;
}

export function partyIdFromSlug(slug: string): number | null {
  const m = slug.match(/^party-(\d+)$/);
  return m ? Number(m[1]) : null;
}

// The join call happens on the Lounge screen (so a wrong password shows
// right there); its token is handed to the room screen through here
// rather than through route params, which would put it in navigation state.
let pending: LoungeTicket | null = null;

export function setLoungeTicket(ticket: LoungeTicket): void {
  pending = ticket;
}

export function takeLoungeTicket(slug: string): LoungeTicket | null {
  const ticket = pending && pending.slug === slug ? pending : null;
  pending = null;
  return ticket;
}

/** A pasted invite link (https://…/lounge/<slug>) or a bare slug → slug. */
export function loungeSlugFrom(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/\/lounge\/([A-Za-z0-9_-]+)/);
  if (match) return match[1];
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null;
}
