import type * as A from '@/lib/adminTypes';
import type {
  AddFreeAgentResult,
  ChatMember,
  CommissionerAddResult,
  EspnConnectionStatus,
  LeagueInfo,
  LeagueMember,
  LeagueTeam,
  PlayoffSettings,
  ScoringRule,
  TradeSettings,
  LoungeRoom,
  WatchPartyRoomMember,
  WatchPartyRoomsResponse,
  FeedbackItem,
  MySettings,
  SundayMode,
  AllTimePowerCategory,
  AwardLeaderboardCategory,
  CareerProfile,
  DraftGrade,
  Owner,
  OwnerBadges,
  PlayoffBracketNode,
  Poll,
  PowerRankTrendTeam,
  ProjectedPlayoffMatchup,
  RecordCategory,
  SeasonAwards,
  SeasonProfile,
  Team,
  TeamDetail,
  Trade,
  TradeRosterPlayer,
  KeeperRules,
  MyKeepers,
  ChugDeadline,
  ChugLeaderboardRow,
  ChugUploadResult,
  ChugFeedEntry,
  LeagueActivityItem,
  LeagueTickerItem,
  OwnerPreferences,
  Rivalry,
  WeeklyAwards,
  WeeklyNarrative,
  WeekPowerRanking,
  ChatConversation,
  FreeAgent,
  ChatMessage,
  DraftPick,
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
  RosterPlayer,
  StandingsRow,
  WaiverClaim,
  WeekMatchupContext,
  WeekMatchupContextItem,
  YourWeek,
} from '@/lib/types';

// The production backend by default (mobile/.env). Point it at a local
// backend with a .env.local, e.g. EXPO_PUBLIC_API_BASE_URL=http://<your-mac>.local:8000.
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
// The Next.js app, for the one route that lives there rather than on
// the backend: chat photo uploads (uploadChatImage below).
export const WEB_BASE_URL = process.env.EXPO_PUBLIC_WEB_BASE_URL ?? '';

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

// Fire-and-forget POST for analytics and error reports: never throws,
// and a 401 here doesn't sign anyone out (that's request()'s job).
export function sendQuietly(path: string, body: unknown): void {
  fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    body: JSON.stringify(body),
  }).catch(() => {});
}

export function hasSessionToken(): boolean {
  return sessionToken !== null;
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
  // 204 No Content (logout, account deletion, some settings writes).
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  me: () => request<Me>('/auth/me'),
  redeemNativeTicket: (ticket: string) =>
    request<{ token: string }>('/auth/native/redeem', { method: 'POST', body: JSON.stringify({ ticket }) }),
  seasons: () => request<{ seasons: number[] }>('/seasons'),
  currentWeek: (season: number) =>
    request<{ season: number; current_week: number | null }>(`/seasons/${season}/current-week`),
  myWeek: () => request<YourWeek>('/me/week'),
  preferences: () => request<OwnerPreferences>('/settings/preferences'),
  updatePreferences: (patch: Partial<OwnerPreferences>) =>
    request<OwnerPreferences>('/settings/preferences', { method: 'PUT', body: JSON.stringify(patch) }),
  applySundayMode: (preset: SundayMode) =>
    request<OwnerPreferences>('/settings/preferences/sunday-mode', { method: 'POST', body: JSON.stringify({ preset }) }),
  mySettings: () => request<MySettings>('/settings/me'),
  updateDisplayName: (displayName: string) =>
    request<void>('/settings/display-name', { method: 'PUT', body: JSON.stringify({ display_name: displayName }) }),
  resetDisplayName: () => request<void>('/settings/display-name/reset', { method: 'POST' }),
  updateTeamName: (teamName: string) =>
    request<void>('/settings/team-name', { method: 'PUT', body: JSON.stringify({ team_name: teamName }) }),
  resetTeamName: () => request<void>('/settings/team-name/reset', { method: 'POST' }),
  updateChatColor: (chatColor: string | null) =>
    request<void>('/settings/chat-color', { method: 'PUT', body: JSON.stringify({ chat_color: chatColor }) }),
  updateLogo: (logoUrl: string | null) =>
    request<void>('/settings/logo', { method: 'PUT', body: JSON.stringify({ logo_url: logoUrl }) }),
  // Bumps the account's token_version, so every session (web too) ends.
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  deleteAccount: () => request<void>('/auth/me', { method: 'DELETE' }),
  submitFeedback: (message: string, imageUrl: string | null) =>
    request<void>('/feedback', { method: 'POST', body: JSON.stringify({ message, page_url: 'native-app', image_url: imageUrl }) }),
  // Commissioner only.
  feedback: () => request<{ items: FeedbackItem[] }>('/feedback'),
  myLeagues: () =>
    request<{ leagues: { id: number; name: string }[]; active_league_id: number | null }>('/leagues/mine'),
  weeklyAwards: (season: number, week: number) => request<WeeklyAwards>(`/seasons/${season}/weeks/${week}/awards`),
  weeklyRecap: (season: number, week: number) =>
    request<{ narrative: WeeklyNarrative | null }>(`/seasons/${season}/weeks/${week}/recap`),
  leagueTicker: (season: number, week: number) =>
    request<{ items: LeagueTickerItem[] }>(`/seasons/${season}/weeks/${week}/ticker`),
  // The most recent locked week, not the one in progress.
  latestPowerRankings: async (season: number) => {
    const { week } = await request<{ week: number | null }>(`/seasons/${season}/power-rankings/latest-week`);
    if (week === null) return { week: null, rankings: [] as WeekPowerRanking[] };
    const { rankings } = await request<{ rankings: WeekPowerRanking[] }>(
      `/seasons/${season}/weeks/${week}/power-rankings`,
    );
    return { week, rankings };
  },
  rivalries: () => request<{ rivalries: Rivalry[] }>('/rivalries'),
  seasonTeams: (season: number) => request<{ teams: Team[] }>(`/seasons/${season}/teams`),
  polls: (leagueId: number) => request<{ polls: Poll[] }>(`/leagues/${leagueId}/polls`),
  votePoll: (leagueId: number, pollId: number, optionIndex: number) =>
    request<Poll>(`/leagues/${leagueId}/polls/${pollId}/vote`, { method: 'POST', body: JSON.stringify({ option_index: optionIndex }) }),
  playoffBracket: (season: number) => request<{ nodes: PlayoffBracketNode[] }>(`/seasons/${season}/playoffs/bracket`),
  // "If the season ended today"; null once a real bracket exists.
  projectedPlayoffs: (season: number) =>
    request<{ matchups: ProjectedPlayoffMatchup[] | null }>(`/seasons/${season}/playoffs/projected`),
  weekPowerRankings: (season: number, week: number) =>
    request<{ rankings: WeekPowerRanking[] }>(`/seasons/${season}/weeks/${week}/power-rankings`),
  latestPowerRankingsWeek: (season: number) => request<{ week: number | null }>(`/seasons/${season}/power-rankings/latest-week`),
  powerRankingsTrend: (season: number) => request<{ teams: PowerRankTrendTeam[] }>(`/seasons/${season}/power-rankings/trend`),
  allTimePowerRankings: () => request<{ categories: AllTimePowerCategory[] }>('/power-rankings/all-time'),
  seasonAwards: (season: number) => request<SeasonAwards>(`/seasons/${season}/awards`),
  recordBook: () => request<{ categories: RecordCategory[] }>('/records'),
  awardLeaderboards: () => request<{ categories: AwardLeaderboardCategory[] }>('/awards/all-time'),
  owners: () => request<{ owners: Owner[] }>('/owners'),
  careerProfile: (ownerId: number) => request<CareerProfile>(`/owners/${ownerId}/career`),
  ownerBadges: (ownerId: number) => request<OwnerBadges>(`/owners/${ownerId}/badges`),
  seasonProfile: (ownerId: number, season: number) => request<SeasonProfile | null>(`/owners/${ownerId}/profile?season=${season}`),
  ownerDraftGrade: (season: number, ownerId: number) =>
    request<{ grade: DraftGrade | null; narrative: string | null }>(`/seasons/${season}/owners/${ownerId}/draft-grade`),
  seasonDraftGrades: (season: number) =>
    request<{ picks: DraftPick[]; grades: DraftGrade[]; narratives: Record<string, string | null> }>(
      `/seasons/${season}/draft-grades`,
    ),
  team: (teamId: number) => request<TeamDetail>(`/teams/${teamId}`),
  teamRoster: (teamId: number, week: number) => request<{ roster: RosterPlayer[] }>(`/teams/${teamId}/roster?week=${week}`),
  chugDeadline: () => request<ChugDeadline>('/chug/deadline'),
  chugFeed: (season?: number) =>
    request<{ chugs: ChugFeedEntry[] }>(season !== undefined ? `/chug/feed?season=${season}` : '/chug/feed'),
  chugSeasons: () => request<{ seasons: number[] }>('/chug/seasons'),
  // No season = all-time.
  chugLeaderboard: (season?: number) =>
    request<{ season: number | null; leaderboard: ChugLeaderboardRow[] }>(
      season !== undefined ? `/chug/leaderboard?season=${season}` : '/chug/leaderboard',
    ),
  // Commissioner only.
  recordChugPayment: (ownerId: number, amount = 1) =>
    request<{ applied: number }>(`/chug/standing/${ownerId}/record-payment?amount=${amount}`, { method: 'POST' }),
  clearChugFine: (ownerId: number) => request<{ cleared: number }>(`/chug/standing/${ownerId}/clear-fine`, { method: 'POST' }),
  waiveChugDoubling: (ownerId: number, week: number) =>
    request<{ waived: number }>(`/chug/standing/${ownerId}/waive-doubling?week=${week}`, { method: 'POST' }),
  chugVideoUrl: (chugId: number) => request<{ url: string; expires_in: number }>(`/chug/${chugId}/video`),
  leagueActivity: (season: number, limit?: number) =>
    request<{ items: LeagueActivityItem[] }>(`/seasons/${season}/activity${limit !== undefined ? `?limit=${limit}` : ''}`),
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
  // A given season's rates (a past matchup needs its own season's rules).
  scoringRules: (season: number) =>
    request<{ season: number; rules: { stat_category: string; points_per_unit: number }[] }>(
      `/league/scoring-rules?season=${season}`,
    ),
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
  tradeTeams: () => request<{ teams: Team[] }>('/trades/teams'),
  tradeRoster: (teamId: number) => request<{ roster: TradeRosterPlayer[] }>(`/trades/teams/${teamId}/roster`),
  myTrades: () => request<{ trades: Trade[] }>('/trades/mine'),
  proposeTrade: (receivingTeamId: number, give: string[], receive: string[]) =>
    request<Trade>('/trades', { method: 'POST', body: JSON.stringify({ receiving_team_id: receivingTeamId, give, receive }) }),
  tradeAction: (tradeId: number, action: 'accept' | 'reject' | 'cancel') =>
    request<Trade>(`/trades/${tradeId}/${action}`, { method: 'POST', body: '{}' }),
  myKeepers: () => request<MyKeepers>('/keepers/me'),
  saveKeepers: (espnPlayerIds: number[]) =>
    request<unknown>('/keepers/me', { method: 'PUT', body: JSON.stringify({ espn_player_ids: espnPlayerIds }) }),
  // Commissioner only.
  setKeeperRules: (rules: { season: number; max_keepers: number; max_consecutive_years: number | null; keeper_deadline: string | null }) =>
    request<KeeperRules>('/keepers/rules', { method: 'PUT', body: JSON.stringify(rules) }),
  setKeepersLocked: (season: number, locked: boolean) =>
    request<KeeperRules>(`/keepers/rules/${locked ? 'lock' : 'unlock'}`, { method: 'POST', body: JSON.stringify({ season }) }),
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
  chatMembers: async () => (await request<{ members: ChatMember[] }>('/chat/members')).members,
  // A single-use, 60-second sign-in link for the in-app browser
  // (backend/app/routers/auth.py's native_web_handoff) — see lib/webHandoff.ts.
  webHandoff: () => request<{ ticket: string }>('/auth/native/web-handoff', { method: 'POST' }),
  watchPartyRooms: () => request<WatchPartyRoomsResponse>('/watch-party/rooms'),
  createWatchPartyRoom: (name: string, invitedOwnerIds: number[]) =>
    request<{ id: number }>('/watch-party/rooms', { method: 'POST', body: JSON.stringify({ name, invited_owner_ids: invitedOwnerIds }) }),
  watchPartyMembers: (roomId: number) =>
    request<{ members: WatchPartyRoomMember[]; created_by_owner_id: number }>(`/watch-party/rooms/${roomId}/members`),
  removeWatchPartyMember: (roomId: number, ownerId: number) =>
    request<unknown>(`/watch-party/rooms/${roomId}/members/${ownerId}`, { method: 'DELETE' }),
  // Long-lived (one sitting) ticket for the fantasy-digest socket.
  watchPartySocketTicket: () => request<{ ticket: string }>('/auth/ticket?purpose=watch_party_ws', { method: 'POST' }),
  loungeRooms: async () => (await request<{ rooms: LoungeRoom[] }>('/lounge/rooms')).rooms,
  createLoungeRoom: (name: string, password: string) =>
    request<{ id: number; slug: string; name: string }>('/lounge/rooms', { method: 'POST', body: JSON.stringify({ name, password }) }),
  closeLoungeRoom: (roomId: number) => request<unknown>(`/lounge/rooms/${roomId}`, { method: 'DELETE' }),
  // ---- Commissioner tools (backend enforces commissioner-only) ----
  leaguesMine: () => request<{ leagues: LeagueInfo[]; active_league_id: number | null }>('/leagues/mine'),
  renameLeague: (leagueId: number, name: string) =>
    request<LeagueInfo>(`/leagues/${leagueId}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  playoffSettings: () => request<PlayoffSettings>('/league/playoff-settings'),
  updatePlayoffSettings: (season: number, playoffTeamCount: number, weeksPerMatchup: number, startWeek: number | null) =>
    request<PlayoffSettings>('/league/playoff-settings', {
      method: 'PUT',
      body: JSON.stringify({ season, playoff_team_count: playoffTeamCount, weeks_per_matchup: weeksPerMatchup, start_week: startWeek }),
    }),
  leagueMembers: async (leagueId: number) =>
    (await request<{ members: LeagueMember[] }>(`/leagues/${leagueId}/members`)).members,
  setMemberRole: (leagueId: number, userId: number, role: 'commissioner' | 'member') =>
    request<unknown>(`/leagues/${leagueId}/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  removeMember: (leagueId: number, userId: number) =>
    request<unknown>(`/leagues/${leagueId}/members/${userId}`, { method: 'DELETE' }),
  leagueTeams: async (leagueId: number) => (await request<{ teams: LeagueTeam[] }>(`/leagues/${leagueId}/teams`)).teams,
  reassignTeam: (leagueId: number, teamId: number, userId: number) =>
    request<LeagueTeam>(`/leagues/${leagueId}/teams/${teamId}/reassign`, { method: 'POST', body: JSON.stringify({ user_id: userId }) }),
  createTeamForMember: (leagueId: number, userId: number, teamName: string) =>
    request<LeagueTeam>(`/leagues/${leagueId}/teams/for-member`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, team_name: teamName }),
    }),
  scoringRulesEditor: () => request<{ season: number; rules: ScoringRule[] }>('/league/scoring-rules'),
  updateScoringRules: (season: number, rules: Record<string, number>) =>
    request<{ season: number; rules: ScoringRule[] }>('/league/scoring-rules', { method: 'PUT', body: JSON.stringify({ season, rules }) }),
  keeperRules: () => request<KeeperRules>('/keepers/rules'),
  rosterSlots: () => request<{ roster_slots: Record<string, number> | null; editable: boolean }>('/draft/roster-slots'),
  setRosterSlots: (rosterSlots: Record<string, number>) =>
    request<{ roster_slots: Record<string, number>; editable: boolean }>('/draft/roster-slots', {
      method: 'PUT',
      body: JSON.stringify({ roster_slots: rosterSlots }),
    }),
  positionMax: () => request<{ position_max: Record<string, number> | null; editable: boolean }>('/draft/position-max'),
  setPositionMax: (positionMax: Record<string, number>) =>
    request<unknown>('/draft/position-max', { method: 'PUT', body: JSON.stringify({ position_max: positionMax }) }),
  teamCurrentRoster: async (leagueId: number, teamId: number) =>
    (await request<{ roster: RosterEntry[] }>(`/leagues/${leagueId}/teams/${teamId}/roster`)).roster,
  commissionerDrop: (leagueId: number, teamId: number, playerId: string) =>
    request<{ roster: RosterEntry[] }>(`/leagues/${leagueId}/teams/${teamId}/roster/drop`, {
      method: 'POST',
      body: JSON.stringify({ sleeper_player_id: playerId }),
    }),
  commissionerMove: (leagueId: number, teamId: number, playerId: string, toSlot: string) =>
    request<{ roster: RosterEntry[] }>(`/leagues/${leagueId}/teams/${teamId}/roster/move`, {
      method: 'POST',
      body: JSON.stringify({ sleeper_player_id: playerId, to_slot: toSlot }),
    }),
  // Same two 409s as addFreeAgent; on_waivers can be overridden.
  commissionerAdd: async (leagueId: number, teamId: number, playerId: string, overrideWaivers?: boolean): Promise<CommissionerAddResult> => {
    try {
      const { roster } = await request<{ roster: RosterEntry[] }>(`/leagues/${leagueId}/teams/${teamId}/roster/add`, {
        method: 'POST',
        body: JSON.stringify({ sleeper_player_id: playerId, override_waivers: overrideWaivers }),
      });
      return { status: 'ok', roster };
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body?.error === 'on_waivers') {
        return { status: 'on_waivers', detail: e.message, clears_at: (e.body.clears_at as string | null) ?? null };
      }
      if (e instanceof ApiError && e.status === 409) return { status: 'roster_full' };
      throw e;
    }
  },
  tradeSettings: () => request<TradeSettings>('/trades/settings'),
  updateTradeSettings: (season: number, tradeDeadline: string | null, reviewRequired: boolean) =>
    request<TradeSettings>('/trades/settings', {
      method: 'PUT',
      body: JSON.stringify({ season, trade_deadline: tradeDeadline, review_required: reviewRequired }),
    }),
  pendingTrades: async () => (await request<{ trades: Trade[] }>('/trades/pending')).trades,
  reviewTrade: (tradeId: number, approve: boolean) =>
    request<Trade>(`/trades/${tradeId}/review`, { method: 'POST', body: JSON.stringify({ approve }) }),
  createPoll: (leagueId: number, question: string, options: string[]) =>
    request<Poll>(`/leagues/${leagueId}/polls`, { method: 'POST', body: JSON.stringify({ question, options }) }),
  closePoll: (leagueId: number, pollId: number) => request<Poll>(`/leagues/${leagueId}/polls/${pollId}`, { method: 'PATCH' }),
  espnConnection: () => request<EspnConnectionStatus>('/league/espn-connection'),
  connectEspn: (espnLeagueId: number, espnS2: string, espnSwid: string) =>
    request<unknown>('/league/espn-connection', {
      method: 'POST',
      body: JSON.stringify({ espn_league_id: espnLeagueId, espn_s2: espnS2, espn_swid: espnSwid }),
    }),
  disconnectEspn: () => request<unknown>('/league/espn-connection', { method: 'DELETE' }),
  syncEspn: () => request<unknown>('/league/espn-connection/sync', { method: 'POST', body: '{}' }),
  // ---- Admin dashboard (site owner only; the backend checks every call) ----
  admin: {
    badges: () => request<A.AdminBadges>('/admin/badges'),
    overview: (days = 7) => request<A.AdminOverview>(`/admin/overview?days=${days}`),
    timeseries: (days = 30) => request<A.AdminTimeseries>(`/admin/timeseries?days=${days}`),
    features: (days = 30) => request<A.FeatureUsage>(`/admin/features?days=${days}`),
    activity: (limit = 15) => request<A.AdminActivity>(`/admin/activity?limit=${limit}`),
    alerts: () => request<A.AdminAlerts>('/admin/alerts'),
    systemHealth: () => request<A.AdminSystemHealth>('/admin/system-health'),
    online: () => request<{ owners: A.OnlineOwner[] }>('/admin/online'),
    live: () => request<A.AdminLive>('/admin/live'),
    engagement: (days = 30) => request<A.AdminEngagement>(`/admin/engagement?days=${days}`),
    navigation: (days = 30) => request<A.NavigationHeatmap>(`/admin/navigation?days=${days}`),
    paths: (days = 30) => request<A.AdminPaths>(`/admin/paths?days=${days}`),
    users: (search: string, status: A.AdminUserStatus) =>
      request<A.AdminUserList>(`/admin/users?status=${status}${search ? `&search=${encodeURIComponent(search)}` : ''}`),
    user: (userId: number) => request<A.AdminUserDetail>(`/admin/users/${userId}`),
    setUserIsAdmin: (userId: number, isAdmin: boolean) =>
      request<A.AdminUserDetail>(`/admin/users/${userId}/admin`, { method: 'PATCH', body: JSON.stringify({ is_admin: isAdmin }) }),
    // A refusal lists its reasons in detail.blockers.
    deleteUser: async (userId: number) => {
      try {
        await request<unknown>(`/admin/users/${userId}`, { method: 'DELETE' });
      } catch (e) {
        const blockers = e instanceof ApiError ? ((e.body?.detail as { blockers?: string[] } | undefined)?.blockers ?? null) : null;
        if (blockers?.length) throw new Error(blockers.join('; '));
        throw e;
      }
    },
    leagues: (days = 7) => request<A.AdminLeagueList>(`/admin/leagues?days=${days}`),
    league: (leagueId: number, days = 7) => request<A.AdminLeagueDetail>(`/admin/leagues/${leagueId}?days=${days}`),
    crashes: (days = 30) => request<A.CrashReports>(`/admin/crashes?days=${days}`),
    errors: (days = 7) => request<A.AdminErrors>(`/admin/errors?days=${days}`),
    error: (fingerprint: string) => request<A.AdminErrorDetail>(`/admin/errors/${encodeURIComponent(fingerprint)}`),
    security: (days = 7) => request<A.AdminSecurity>(`/admin/security?days=${days}`),
    audit: (limit = 50, offset = 0) => request<A.AdminAuditLog>(`/admin/audit?limit=${limit}&offset=${offset}`),
  },
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

export function watchPartySocketUrl(ticket: string, roomId: number): string {
  return `${API_BASE_URL.replace(/^http/, 'ws')}/watch-party/ws?ticket=${encodeURIComponent(ticket)}&room_id=${roomId}`;
}

export function gamecastSocketUrl(ticket: string, gameId: string): string {
  return `${API_BASE_URL.replace(/^http/, 'ws')}/nfl/gamecast/ws?ticket=${encodeURIComponent(ticket)}&game_id=${encodeURIComponent(gameId)}`;
}

// Chat photos go to the web app's Blob store, the one image host the
// backend accepts for chat (backend/app/image_url.py), through a route
// built for the native app (frontend/src/app/api/chat/upload-native).
// `uri` is a local, already-compressed JPEG (lib/chatImage.ts).
export async function uploadChatImage(uri: string): Promise<string> {
  const form = new FormData();
  // React Native's FormData takes a { uri, name, type } file descriptor.
  form.append('file', { uri, name: 'photo.jpg', type: 'image/jpeg' } as unknown as Blob);
  const res = await fetch(`${WEB_BASE_URL}/api/chat/upload-native`, {
    method: 'POST',
    headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : undefined,
    body: form,
  });
  if (!res.ok) throw new ApiError(res.status, `Upload failed (${res.status})`);
  const { url } = (await res.json()) as { url: string };
  return url;
}

// Chug videos go straight to the backend (a whole video is too big for
// a Vercel function), authorized by a short-lived chug_upload ticket in
// the URL, same as the web's ChugUpload. The response streams progress
// lines while the video is graded; the last line is the result.
// `ownerId` credits someone else (commissioner only).
export async function uploadChugVideo(uri: string, mimeType: string, ownerId?: number): Promise<ChugUploadResult> {
  const { ticket } = await request<{ ticket: string }>('/auth/ticket?purpose=chug_upload', { method: 'POST' });
  const form = new FormData();
  const ext = mimeType.includes('quicktime') ? 'mov' : 'mp4';
  form.append('video', { uri, name: `chug.${ext}`, type: mimeType } as unknown as Blob);
  const onBehalf = ownerId !== undefined ? `&owner_id=${ownerId}` : '';
  const res = await fetch(`${API_BASE_URL}/chug/upload?ticket=${encodeURIComponent(ticket)}${onBehalf}`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    let detail = `Upload failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body?.detail === 'string') detail = body.detail;
    } catch {
      // Not JSON.
    }
    throw new ApiError(res.status, detail);
  }
  const lines = (await res.text()).split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last) throw new ApiError(500, 'Upload failed — empty response');
  const data = JSON.parse(last);
  if (data.error) throw new ApiError(data.status ?? 500, data.message ?? 'Upload failed');
  return data as ChugUploadResult;
}
