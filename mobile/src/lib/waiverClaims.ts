import { Colors } from '@/constants/theme';
import type { WaiverClaim } from '@/lib/types';

// How a finished claim turned out, in the words the claims screens use.
export const OUTCOME: Record<Exclude<WaiverClaim['status'], 'pending'>, { label: string; color: string }> = {
  successful: { label: 'Won', color: Colors.win },
  failed: { label: 'Missed', color: '#ff9d5c' },
  cancelled: { label: 'Cancelled', color: Colors.textSecondary },
};

export function pendingClaims(claims: WaiverClaim[]): WaiverClaim[] {
  return claims.filter((c) => c.status === 'pending');
}

// Finished claims, newest first.
export function pastClaims(claims: WaiverClaim[]): WaiverClaim[] {
  return claims
    .filter((c) => c.status !== 'pending')
    .sort((a, b) => (b.processed_at ?? b.created_at).localeCompare(a.processed_at ?? a.created_at));
}

// The claims settled by the most recent waiver run: every won or missed
// claim processed within an hour of the newest one. Cancellations aren't
// part of a run.
export function lastRun(claims: WaiverClaim[]): WaiverClaim[] {
  const settled = pastClaims(claims).filter((c) => c.status !== 'cancelled' && c.processed_at);
  if (settled.length === 0) return [];
  const newest = new Date(settled[0].processed_at!).getTime();
  return settled.filter((c) => newest - new Date(c.processed_at!).getTime() < 60 * 60 * 1000);
}

// The soonest a pending claim can process, or null.
export function nextClear(claims: WaiverClaim[]): string | null {
  return claims.map((c) => c.clears_at).filter((x): x is string => x !== null).sort()[0] ?? null;
}

// "Wed 3:00 AM" (this week) or "Wed, Oct 14 3:00 AM" (further out), in
// the phone's own time zone.
export function shortWhen(iso: string): string {
  const when = new Date(iso);
  const soon = when.getTime() - Date.now() < 6 * 24 * 60 * 60 * 1000;
  const day = when.toLocaleDateString(undefined, soon ? { weekday: 'short' } : { weekday: 'short', month: 'short', day: 'numeric' });
  const time = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} ${time}`;
}

// Past claims grouped by the day they were settled ("Wed, Oct 7"), newest first.
export function byDay(claims: WaiverClaim[]): { day: string; claims: WaiverClaim[] }[] {
  const groups: { day: string; claims: WaiverClaim[] }[] = [];
  for (const claim of claims) {
    const day = new Date(claim.processed_at ?? claim.created_at).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const last = groups[groups.length - 1];
    if (last?.day === day) last.claims.push(claim);
    else groups.push({ day, claims: [claim] });
  }
  return groups;
}
