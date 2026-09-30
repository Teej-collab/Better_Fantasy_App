import type {
  AddFreeAgentResult,
  ChatConversation,
  FreeAgent,
  ChatMessage,
  DraftPoolPlayer,
  DraftState,
  FantasyImpact,
  GamecastGameSummary,
  LiveGame,
  Me,
  MyTeam,
  NflGame,
  PlayerCard,
  PlayFantasyPlayer,
  RosterEntry,
  StandingsRow,
  WaiverClaim,
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
    // The parsed JSON error body, for endpoints whose 409s carry a
    // machine-readable `error` code (e.g. roster_full, on_waivers).
    public body: Record<string, unknown> | null = null,
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
    let body: Record<string, unknown> | null = null;
    try {
      body = await res.json();
      if (typeof body?.detail === 'string') detail = body.detail;
    } catch {
      // Not JSON; keep the status message.
    }
    throw new ApiError(res.status, detail, body);
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
  nflScoreboard: () => request<{ games: NflGame[] }>('/nfl/scoreboard'),
  // Every game this week that has a Gamecast (live, upcoming or final).
  gamecastGames: () => request<{ games: GamecastGameSummary[] }>('/nfl/live-games'),
  gamecastGame: (gameId: string) => request<LiveGame>(`/nfl/games/${encodeURIComponent(gameId)}`),
  fantasyImpact: (gameId: string) => request<FantasyImpact>(`/nfl/games/${encodeURIComponent(gameId)}/fantasy-impact`),
  playFantasy: (gameId: string, playId: string) =>
    request<{ players: PlayFantasyPlayer[] }>(
      `/nfl/games/${encodeURIComponent(gameId)}/plays/${encodeURIComponent(playId)}/fantasy`,
    ),
  standings: (season: number) => request<{ standings: StandingsRow[] }>(`/seasons/${season}/standings`),
  matchupContext: (season: number, week: number) =>
    request<WeekMatchupContext>(`/seasons/${season}/weeks/${week}/matchup-context`),
  matchup: (matchupId: number) => request<WeekMatchupContextItem>(`/matchups/${matchupId}`),
  myTeam: () => request<MyTeam>('/me/team'),
  playerCard: (sleeperPlayerId: string) =>
    request<PlayerCard>(`/players/${encodeURIComponent(sleeperPlayerId)}/card`),
  // Both return the whole roster with new lineup_slots but without the
  // GET /me/team-only fields (points, matchup, kickoff) — see
  // applyLineupSlots in lib/queries.ts.
  moveLineup: (playerId: string, toSlot: string) =>
    request<{ roster: RosterEntry[] }>('/me/team/lineup/move', {
      method: 'POST',
      body: JSON.stringify({ sleeper_player_id: playerId, to_slot: toSlot }),
    }),
  // `position` is the stored value (defenses are "DEF", shown as "D/ST").
  freeAgents: (position?: string, search?: string) => {
    const params = [position && `position=${encodeURIComponent(position)}`, search && `search=${encodeURIComponent(search)}`]
      .filter(Boolean)
      .join('&');
    return request<{ players: FreeAgent[] }>(`/me/team/free-agents${params ? `?${params}` : ''}`);
  },
  // Two 409s are decisions, not failures: roster_full (pick someone to
  // drop and call again) and on_waivers (file a waiver claim instead).
  // Same handling as the web's addFreeAgent (frontend/src/lib/api.ts).
  addFreeAgent: async (playerId: string, dropPlayerId?: string): Promise<AddFreeAgentResult> => {
    try {
      const result = await request<{ roster: RosterEntry[]; dropped_player: RosterEntry | null }>(
        '/me/team/free-agents/add',
        { method: 'POST', body: JSON.stringify({ sleeper_player_id: playerId, drop_sleeper_player_id: dropPlayerId ?? null }) },
      );
      return { status: 'ok', ...result };
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body?.error === 'roster_full') {
        return { status: 'roster_full', detail: e.message };
      }
      if (e instanceof ApiError && e.status === 409 && e.body?.error === 'on_waivers') {
        return { status: 'on_waivers', detail: e.message, clears_at: (e.body.clears_at as string | null) ?? null };
      }
      throw e;
    }
  },
  waiverClaims: () => request<{ claims: WaiverClaim[] }>('/me/team/waivers'),
  submitWaiverClaim: (addPlayerId: string, dropPlayerId: string | null) =>
    request<WaiverClaim>('/me/team/waivers/claim', {
      method: 'POST',
      body: JSON.stringify({ add_sleeper_player_id: addPlayerId, drop_sleeper_player_id: dropPlayerId }),
    }),
  cancelWaiverClaim: (claimId: number) =>
    request<unknown>(`/me/team/waivers/claim/${claimId}/cancel`, { method: 'POST' }),
  draftState: () => request<DraftState>('/draft/state'),
  draftPool: (position?: string, search?: string) => {
    const params = [position && `position=${encodeURIComponent(position)}`, search && `search=${encodeURIComponent(search)}`]
      .filter(Boolean)
      .join('&');
    return request<{ players: DraftPoolPlayer[] }>(`/draft/pool${params ? `?${params}` : ''}`);
  },
  // Your queue: Sleeper player ids, best first.
  draftQueue: () => request<{ queue: string[] }>('/draft/queue'),
  addToDraftQueue: (playerId: string) =>
    request<{ queue: string[] }>('/draft/queue', { method: 'POST', body: JSON.stringify({ sleeper_player_id: playerId }) }),
  removeFromDraftQueue: (playerId: string) =>
    request<{ queue: string[] }>(`/draft/queue/${encodeURIComponent(playerId)}`, { method: 'DELETE' }),
  // Send the whole new order; the server reassigns ranks from it.
  reorderDraftQueue: (playerIds: string[]) =>
    request<{ queue: string[] }>('/draft/queue/reorder', {
      method: 'PUT',
      body: JSON.stringify({ sleeper_player_ids: playerIds }),
    }),
  draftPick: (playerId: string) =>
    request<unknown>('/draft/pick', { method: 'POST', body: JSON.stringify({ sleeper_player_id: playerId }) }),
  // Commissioner only.
  draftControl: (action: 'start' | 'pause' | 'resume' | 'undo-last-pick') =>
    request<unknown>(`/draft/${action}`, { method: 'POST' }),
  chatConversations: () => request<{ conversations: ChatConversation[] }>('/chat/conversations'),
  // Chronological, 50 per page; `before` pages back from a message id.
  chatMessages: (conversationId: number, before?: number) =>
    request<{ messages: ChatMessage[] }>(
      `/chat/conversations/${conversationId}/messages${before ? `?before=${before}` : ''}`,
    ),
  markChatRead: (conversationId: number) =>
    request<{ last_read_message_id: number | null }>(`/chat/conversations/${conversationId}/read`, { method: 'POST' }),
  // Toggles; the server broadcasts the result to everyone over the socket.
  reactToMessage: (messageId: number, emoji: string) =>
    request<{ added: boolean }>(`/chat/messages/${messageId}/react`, { method: 'POST', body: JSON.stringify({ emoji }) }),
  // Short-lived ticket for the chat WebSocket handshake, which can't
  // carry the Authorization header (backend/app/routers/auth.py's issue_ticket).
  chatSocketTicket: () => request<{ ticket: string }>('/auth/ticket?purpose=ws', { method: 'POST' }),
  swapLineup: (playerIdA: string, playerIdB: string) =>
    request<{ roster: RosterEntry[] }>('/me/team/lineup/swap', {
      method: 'POST',
      body: JSON.stringify({ sleeper_player_id_a: playerIdA, sleeper_player_id_b: playerIdB }),
    }),
};

export function chatSocketUrl(ticket: string): string {
  return `${API_BASE_URL.replace(/^http/, 'ws')}/chat/ws?ticket=${encodeURIComponent(ticket)}`;
}

export function draftSocketUrl(ticket: string, season: number): string {
  return `${API_BASE_URL.replace(/^http/, 'ws')}/draft/ws?ticket=${encodeURIComponent(ticket)}&season=${season}`;
}

export function gamecastSocketUrl(ticket: string, gameId: string): string {
  return `${API_BASE_URL.replace(/^http/, 'ws')}/nfl/gamecast/ws?ticket=${encodeURIComponent(ticket)}&game_id=${encodeURIComponent(gameId)}`;
}
