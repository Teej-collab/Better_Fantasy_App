import type {
  Me,
  MyTeam,
  RosterEntry,
  StandingsRow,
  WeekMatchupContext,
  WeekMatchupContextItem,
  YourWeek,
} from '@/lib/types';

// The production backend by default (mobile/.env). Point it at a local
// backend with a .env.local, e.g. EXPO_PUBLIC_API_BASE_URL=http://<your-mac>.local:8000.
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Set by AuthProvider. The backend reads `Authorization: Bearer` the
// same as its session cookie (backend/app/auth/session.py's
// get_session_token), so no backend changes are needed for native.
let sessionToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setSessionToken(token: string | null) {
  sessionToken = token;
}

export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401) onUnauthorized?.();
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body?.detail === 'string') detail = body.detail;
    } catch {
      // Not JSON; keep the status message.
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  me: () => request<Me>('/auth/me'),
  redeemNativeTicket: (ticket: string) =>
    request<{ token: string }>('/auth/native/redeem', { method: 'POST', body: JSON.stringify({ ticket }) }),
  seasons: () => request<{ seasons: number[] }>('/seasons'),
  currentWeek: (season: number) =>
    request<{ season: number; current_week: number | null }>(`/seasons/${season}/current-week`),
  myWeek: () => request<YourWeek>('/me/week'),
  standings: (season: number) => request<{ standings: StandingsRow[] }>(`/seasons/${season}/standings`),
  matchupContext: (season: number, week: number) =>
    request<WeekMatchupContext>(`/seasons/${season}/weeks/${week}/matchup-context`),
  matchup: (matchupId: number) => request<WeekMatchupContextItem>(`/matchups/${matchupId}`),
  myTeam: () => request<MyTeam>('/me/team'),
  // Both return the whole roster with new lineup_slots but without the
  // GET /me/team-only fields (points, matchup, kickoff) — see
  // applyLineupSlots in lib/queries.ts.
  moveLineup: (playerId: string, toSlot: string) =>
    request<{ roster: RosterEntry[] }>('/me/team/lineup/move', {
      method: 'POST',
      body: JSON.stringify({ sleeper_player_id: playerId, to_slot: toSlot }),
    }),
  swapLineup: (playerIdA: string, playerIdB: string) =>
    request<{ roster: RosterEntry[] }>('/me/team/lineup/swap', {
      method: 'POST',
      body: JSON.stringify({ sleeper_player_id_a: playerIdA, sleeper_player_id_b: playerIdB }),
    }),
};
