export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status}`);
  }
  return res.json();
}

// Same as get(), but forwards the session cookie — for endpoints that
// require the caller to be signed in (chat messages, etc.).
async function authedGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { cache: "no-store", credentials: "include" });
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status}`);
  }
  return res.json();
}

// For endpoints where "no data" (404) is a normal, expected outcome —
// e.g. an owner with no team in a given season — not an error to throw on.
async function getOrNull<T>(path: string): Promise<T | null> {
  const res = await fetch(`${API_BASE_URL}${path}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status}`);
  }
  return res.json();
}

export type Season = number;

export type Team = {
  team_id: number;
  espn_team_id: number;
  team_name: string;
  owner_id: number;
  owner_name: string;
};

export type StandingsRow = {
  team_id: number;
  team_name: string;
  owner_name: string;
  wins: number;
  losses: number;
  ties: number;
  points_for: string;
  points_against: string;
  // ESPN's own final-season rank (accounts for the full playoff bracket).
  // Null means the season isn't finished yet — rows are then ordered by
  // regular-season record instead. A row with final_rank === 1 is the
  // champion.
  final_rank: number | null;
};

export type WeekMatchup = {
  matchup_id: number;
  is_playoff: boolean;
  home_team_id: number;
  home_team_name: string;
  home_score: string | null;
  away_team_id: number;
  away_team_name: string;
  away_score: string | null;
};

export type RosterPlayer = {
  player_name: string;
  position: string | null;
  lineup_slot: string | null;
  // FastAPI's jsonable_encoder serializes Decimal as a JSON number, not
  // a string — this type previously said string, which was never
  // actually true at runtime (Number() on either works, so it went
  // unnoticed).
  points_scored: number | null;
  points_projected: number | null;
};

export type MatchupDetail = WeekMatchup & {
  season: number;
  week: number;
  home_roster: RosterPlayer[];
  away_roster: RosterPlayer[];
};

export type TeamDetail = {
  team_id: number;
  season: number;
  espn_team_id: number;
  team_name: string;
  owner_id: number;
  owner_name: string;
};

export type TeamRoster = {
  team: TeamDetail;
  week: number;
  roster: RosterPlayer[];
};

export function listSeasons() {
  return get<{ seasons: Season[] }>("/seasons");
}

// Cached by the backend as a side effect of syncing (see league_state
// migration) — never a live ESPN call from the page. Null means no sync
// has run for that season yet, not an error.
export function getCurrentWeek(season: number) {
  return get<{ season: number; current_week: number | null }>(`/seasons/${season}/current-week`);
}

export function listTeams(season: number) {
  return get<{ teams: Team[] }>(`/seasons/${season}/teams`);
}

export function getStandings(season: number) {
  return get<{ standings: StandingsRow[] }>(`/seasons/${season}/standings`);
}

export function listWeekMatchups(season: number, week: number) {
  return get<{ matchups: WeekMatchup[] }>(`/seasons/${season}/weeks/${week}/matchups`);
}

export type Streak = "hot" | "cold" | "neutral";

export type MatchupContextSide = {
  team_id: number;
  team_name: string;
  owner_id: number;
  owner_name: string;
  score: number | null;
  record: string | null;
  streak: Streak;
  projected_total: number | null;
  roster: RosterPlayer[];
};

export type MatchupRivalry = {
  name: string;
  emoji: string | null;
  tagline: string | null;
  description: string | null;
  tier: string | null;
  all_time_wins_home: number;
  all_time_wins_away: number;
};

export type RecentMeeting = {
  season: number;
  week: number;
  home_won: boolean;
  tie: boolean;
};

export type MatchupHeadToHead = {
  wins_home: number;
  wins_away: number;
  ties: number;
  last_season: number | null;
  last_week: number | null;
  // Oldest first, most recent last — capped at 5.
  recent_meetings: RecentMeeting[];
};

export type WeekMatchupContextItem = {
  matchup_id: number;
  is_playoff: boolean;
  is_game_of_the_week: boolean;
  is_rivalry: boolean;
  rivalry: MatchupRivalry | null;
  head_to_head: MatchupHeadToHead;
  home: MatchupContextSide;
  away: MatchupContextSide;
  // The LLM narrative engine hasn't been turned on yet (real API cost
  // per generation) — always null for now, see TODO.md.
  narrative: string | null;
};

export type WeekMatchupContext = {
  season: number;
  week: number;
  game_of_the_week_matchup_id: number | null;
  matchups: WeekMatchupContextItem[];
};

export function getWeekMatchupContext(season: number, week: number) {
  return get<WeekMatchupContext>(`/seasons/${season}/weeks/${week}/matchup-context`);
}

export function getMatchup(matchupId: number) {
  return get<MatchupDetail>(`/matchups/${matchupId}`);
}

export function getTeam(teamId: number) {
  return get<TeamDetail>(`/teams/${teamId}`);
}

export function getTeamRoster(teamId: number, week: number) {
  return get<TeamRoster>(`/teams/${teamId}/roster?week=${week}`);
}

export type PeriodSummary = {
  record: string;
  pf: number;
  pa: number;
  pfpg: number;
  papg: number;
  game_count: number;
};

export type SeasonProfile = {
  team_name: string;
  regular: PeriodSummary | null;
  playoff: PeriodSummary | null;
  best_week: { week: number; score: number } | null;
  worst_week: { week: number; score: number } | null;
  avg_luck: number | null;
  avg_chaos: number | null;
  current_power_rank: number | null;
  season_awards: { award_type: string; detail: string | null }[];
};

export type Owner = {
  owner_id: number;
  display_name: string;
  latest_team_name: string;
  seasons: number[];
};

export type CareerProfile = {
  team_name: string;
  seasons: number[];
  regular: PeriodSummary | null;
  playoff: PeriodSummary | null;
  best_week: { season: number; week: number; score: number } | null;
  worst_week: { season: number; week: number; score: number } | null;
  best_season: { season: number; record: string; pf: number } | null;
  worst_season: { season: number; record: string; pf: number } | null;
};

export type OwnerBadges = {
  championship_years: number[];
  award_summary: Record<string, number[]>;
};

export type SeasonAward = {
  award_type: string;
  detail: string | null;
  owner_id: number;
  owner_name: string;
};

export type SeasonAwardsResponse = {
  champion: { team_name: string; owner_id: number; owner_name: string } | null;
  awards: SeasonAward[];
};

export type WeeklyAwards = {
  overachiever: { team_id: number; team_name: string; diff: number } | null;
  meltdown: { team_id: number; team_name: string; diff: number } | null;
  biggest_bench_crime:
    | {
        bench_player: string;
        started_player: string;
        position: string;
        // NUMERIC in Postgres -> Decimal via asyncpg -> a JSON number
        // via FastAPI's jsonable_encoder, same as RosterPlayer's
        // points_scored/points_projected above — this was typed string
        // and every caller had to remember to wrap it in Number().
        points_diff: number;
        severity: string;
        team_name: string;
      }
    | null;
  clutch: { team_name: string; margin: number; reason: string } | null;
  choke: { team_name: string; margin: number; reason: string } | null;
  boom_leaders: { player_name: string; points_scored: number; team_name: string }[];
  bust_leaders: { player_name: string; points_scored: number; team_name: string }[];
  game_of_the_week: { winner: string; score: string } | null;
};

export type Rivalry = {
  id: number;
  name: string | null;
  emoji: string | null;
  tagline: string | null;
  description: string | null;
  tier: string | null;
  all_time_wins_a: number;
  all_time_wins_b: number;
  owner_a_id: number;
  owner_a_name: string;
  owner_b_id: number;
  owner_b_name: string;
};

export function listOwners() {
  return get<{ owners: Owner[] }>("/owners");
}

export function getSeasonProfile(ownerId: number, season: number) {
  return getOrNull<SeasonProfile>(`/owners/${ownerId}/profile?season=${season}`);
}

export function getCareerProfile(ownerId: number) {
  return getOrNull<CareerProfile>(`/owners/${ownerId}/career`);
}

export function getOwnerBadges(ownerId: number) {
  return get<OwnerBadges>(`/owners/${ownerId}/badges`);
}

export function getSeasonAwards(season: number) {
  return get<SeasonAwardsResponse>(`/seasons/${season}/awards`);
}

export function getWeeklyAwards(season: number, week: number) {
  return get<WeeklyAwards>(`/seasons/${season}/weeks/${week}/awards`);
}

export function listRivalries() {
  return get<{ rivalries: Rivalry[] }>("/rivalries");
}

export type YourWeekMatchup = {
  matchup_id: number;
  is_playoff: boolean;
  started: boolean;
  record: string | null;
  my_score: number | null;
  my_projected_total: number;
  opponent_team_id: number;
  opponent_team_name: string;
  opponent_score: number | null;
  opponent_projected_total: number;
  // Our own estimate from real inputs (current score + season
  // projections + league scoring volatility) — ESPN's API doesn't
  // expose a win-probability field, confirmed directly against their
  // raw responses. Null until the matchup has real scores to work with.
  win_probability: number | null;
};

export type YourWeek = {
  season: number;
  week: number | null;
  team_id: number;
  team_name: string;
  matchup: YourWeekMatchup | null;
};

// Session-aware — only meaningful server-side, where the incoming
// request's own session cookie can be forwarded. Returns null rather
// than throwing for "not signed in" / "no team this season", both of
// which are normal, expected states for a homepage that has to render
// for logged-out visitors too.
export async function getMyWeek(sessionCookie: string | undefined): Promise<YourWeek | null> {
  if (!sessionCookie) return null;
  const res = await fetch(`${API_BASE_URL}/me/week`, {
    cache: "no-store",
    headers: { Cookie: `session=${sessionCookie}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export type NflGame = {
  id: string;
  name: string;
  home_team: string | null;
  home_score: string | null;
  away_team: string | null;
  away_score: string | null;
  state: "pre" | "in" | "post" | null;
  status_detail: string | null;
  completed: boolean;
};

export async function getNflScoreboard(): Promise<NflGame[]> {
  try {
    const { games } = await get<{ games: NflGame[] }>("/nfl/scoreboard");
    return games;
  } catch {
    // ESPN's public scoreboard is unauthenticated, external, and not
    // load-bearing for the rest of the homepage — never let it break
    // the page if it's briefly unreachable.
    return [];
  }
}

// Real Game Day detection: true iff a real NFL game is in progress
// right now, per ESPN's own live status for each game. Derived locally
// from the same scoreboard data every caller already fetches via
// getNflScoreboard() (buildNflTickerItems, below) instead of a second
// backend round trip — every call site needed both together anyway, so
// a separate GET /game-day fetch was just doubling the real ESPN calls
// per page load for no benefit. Same logic as the backend's own
// is_nfl_game_live (app/providers/nfl_scoreboard.py), which the
// live-sync scheduler and this endpoint's callers both rely on staying
// in agreement — this replaced a day-of-week/hour heuristic (see
// TODO.md, Aug 19 2026) that could miss a real game outside its fixed
// windows or false-positive on an empty evening inside them.
export function isNflGameLive(nflGames: NflGame[]): boolean {
  return nflGames.some((g) => g.state === "in");
}

// Shared by the persistent site-wide ticker (layout.tsx), the signed-out
// gate's own ticker (OpeningExperience.tsx via page.tsx), and the
// homepage dashboard's richer ticker — the exact same real NFL data
// everywhere, just without the league-specific items (awards/rivalries/
// standings) that only make sense in the homepage's own context.
export function buildNflTickerItems(nflGames: NflGame[]): string[] {
  // Every game currently on the scoreboard, not a truncated slice — a
  // real week's slate is ~16 games and the ticker scrolls continuously,
  // so there's no real reason to hide the back half of it. Game Day
  // still matters for scroll *speed* (LiveTicker's fast prop, driven by
  // isGameDay at the call site), just not for how many games show up.
  const items: string[] = [];
  for (const g of nflGames) {
    if (!g.home_team || !g.away_team) continue;
    if (g.state === "in") {
      items.push(`🏈 ${g.away_team} ${g.away_score} — ${g.home_team} ${g.home_score} (${g.status_detail ?? "Live"})`);
    } else if (g.state === "post") {
      items.push(`🏁 ${g.away_team} ${g.away_score} — ${g.home_team} ${g.home_score} Final`);
    } else {
      items.push(`🏈 ${g.away_team} @ ${g.home_team} — ${g.status_detail ?? "Upcoming"}`);
    }
  }
  return items;
}

export type ChugLeaderboardRow = {
  owner_id: number;
  owner_name: string;
  owed: number;
  completed: number;
  avg_grade: number | null;
  // Every real chug this owner has ever posted, uncapped by what was
  // ever owed — see app/domain/chug_standing.py's module docstring.
  lifetime_completed: number;
  // Jeffrey's Rule's real running balance for the active season only
  // (always 0 when viewing a past season) — see chug_standing.
  outstanding_owed: number;
  fined_owed: number;
  fine_amount: number;
};

export type ChugLeaderboard = {
  season: number | null;
  leaderboard: ChugLeaderboardRow[];
};

// Seasons that actually have a chug_debts row — a subset of listSeasons(),
// since not every league season has roster data to compute the rule
// against (e.g. a season that hasn't started yet).
export function getChugSeasons() {
  return get<{ seasons: Season[] }>("/chug/seasons");
}

// season omitted -> all-time (summed across every season), matching the
// Discord bot's /chug_leaderboard default view.
export function getChugLeaderboard(season?: number) {
  return get<ChugLeaderboard>(season !== undefined ? `/chug/leaderboard?season=${season}` : "/chug/leaderboard");
}

// Commissioner-only — marks a real-life chug fine as paid, clearing it
// off the owed total. amount omitted clears the entire fine.
export async function clearChugFine(ownerId: number, amount?: number): Promise<{ cleared: number }> {
  const qs = amount !== undefined ? `?amount=${amount}` : "";
  const res = await fetch(`${API_BASE_URL}/chug/standing/${ownerId}/clear-fine${qs}`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Failed to clear fine: ${res.status}`);
  return res.json();
}

export type Me = { owner_id: number; display_name: string | null; is_commissioner: boolean };

// Server-side counterpart to AuthStatus's client-side /auth/me fetch —
// used by pages that need to know who's signed in during SSR (e.g. to
// tell the chat room which messages are "mine").
export async function getMe(sessionCookie: string | undefined): Promise<Me | null> {
  if (!sessionCookie) return null;
  const res = await fetch(`${API_BASE_URL}/auth/me`, {
    cache: "no-store",
    headers: { Cookie: `session=${sessionCookie}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export type MySettings = {
  display_name: string;
  display_name_is_custom: boolean;
  chat_color: string | null;
  discord_username: string | null;
};

export async function getMySettings(sessionCookie: string | undefined): Promise<MySettings | null> {
  if (!sessionCookie) return null;
  const res = await fetch(`${API_BASE_URL}/settings/me`, {
    cache: "no-store",
    headers: { Cookie: `session=${sessionCookie}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function _settingsRequest(path: string, method: string, body?: object): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/settings${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `Request failed (${res.status})`);
  }
}

export function updateDisplayName(displayName: string): Promise<void> {
  return _settingsRequest("/display-name", "PUT", { display_name: displayName });
}

export function resetDisplayName(): Promise<void> {
  return _settingsRequest("/display-name/reset", "POST");
}

export function updateChatColor(chatColor: string | null): Promise<void> {
  return _settingsRequest("/chat-color", "PUT", { chat_color: chatColor });
}

// ---- My Team (real-time ESPN data, lineup preview only — no real
// submission exists yet, see backend/ESPN_LINEUP_WRITE.md) ----------------

export type EligibleSlot = { id: number; label: string };

export type RosterEntry = {
  player_id: number;
  player_name: string;
  lineup_slot_id: number;
  lineup_slot_label: string;
  eligible_slots: EligibleSlot[];
  pro_team: string;
  injury_status: string | null;
  game_start: string | null;
  is_locked: boolean;
  points_scored: number | null;
  points_projected: number | null;
};

export type MyTeam = {
  team_name: string;
  season: number;
  roster: RosterEntry[];
};

export async function getMyTeam(): Promise<MyTeam> {
  const res = await fetch(`${API_BASE_URL}/me/team`, { credentials: "include", cache: "no-store" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `Failed to load team (${res.status})`);
  }
  return res.json();
}

export type LineupMovePreview = {
  player: RosterEntry;
  from_slot: EligibleSlot;
  to_slot: EligibleSlot;
  displaced_player: RosterEntry | null;
};

export async function previewLineupMove(playerName: string, toSlot: string): Promise<LineupMovePreview> {
  const res = await fetch(`${API_BASE_URL}/me/team/lineup/preview-move`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ player_name: playerName, to_slot: toSlot }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `Preview failed (${res.status})`);
  }
  return res.json();
}

export type LineupSwapPreview = { player_a: RosterEntry; player_b: RosterEntry };

export async function previewLineupSwap(playerA: string, playerB: string): Promise<LineupSwapPreview> {
  const res = await fetch(`${API_BASE_URL}/me/team/lineup/preview-swap`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ player_a: playerA, player_b: playerB }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `Preview failed (${res.status})`);
  }
  return res.json();
}

// ---- Free Agents (read-only — see backend/app/providers/espn/free_agents.py) ----

export type FreeAgent = {
  player_id: number;
  name: string;
  position: string;
  pro_team: string;
  injury_status: string | null;
  percent_owned: number;
  percent_started: number;
  projected_points: number | null;
  points: number | null;
};

export async function getFreeAgents(position?: string, size = 50): Promise<{ season: number; players: FreeAgent[] }> {
  const params = new URLSearchParams({ size: String(size) });
  if (position) params.set("position", position);
  const { season, players } = await get<{ season: number; players: FreeAgent[] }>(`/free-agents?${params}`);
  return { season, players };
}

export type WaiverSettings = { uses_faab: boolean; acquisition_budget: number };

export function getWaiverSettings(): Promise<WaiverSettings> {
  return get<WaiverSettings>("/free-agents/waiver-settings");
}

export type ChatReaction = { emoji: string; count: number; reacted_by_me: boolean };

export type ChatReplyPreview = { id: number; owner_name: string; body: string };

export type ChatMessage = {
  id: number;
  conversation_id: number;
  owner_id: number;
  owner_name: string;
  owner_chat_color: string | null;
  body: string;
  deleted: boolean;
  created_at: string;
  reply_to: ChatReplyPreview | null;
  mentions: number[];
  reactions: ChatReaction[];
};

export type ChatConversation = {
  id: number;
  type: "league" | "direct";
  member_count: number;
  other_owner_id: number | null;
  other_owner_name: string | null;
  unread_count: number;
  last_message: { id: number; owner_name: string; body: string; created_at: string } | null;
};

export type ChatMember = { owner_id: number; display_name: string; team_name: string };

// Session-aware, same forwarded-cookie pattern as getMyWeek — returns
// null rather than throwing for "not signed in", which the chat page
// treats as "show a sign-in prompt instead of the app."
export async function getChatConversations(sessionCookie: string | undefined): Promise<ChatConversation[] | null> {
  if (!sessionCookie) return null;
  const res = await fetch(`${API_BASE_URL}/chat/conversations`, {
    cache: "no-store",
    headers: { Cookie: `session=${sessionCookie}` },
  });
  if (!res.ok) return null;
  const { conversations } = await res.json();
  return conversations;
}

export async function getChatConversationMessages(
  conversationId: number,
  opts?: { before?: number }
): Promise<ChatMessage[]> {
  const qs = opts?.before ? `?before=${opts.before}` : "";
  const { messages } = await authedGet<{ messages: ChatMessage[] }>(
    `/chat/conversations/${conversationId}/messages${qs}`
  );
  return messages;
}

export async function getChatMembers(): Promise<ChatMember[]> {
  const res = await fetch(`${API_BASE_URL}/chat/members`, { credentials: "include" });
  if (!res.ok) return [];
  const { members } = await res.json();
  return members;
}

export async function startDirectConversation(ownerId: number): Promise<number> {
  const res = await fetch(`${API_BASE_URL}/chat/conversations/direct`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner_id: ownerId }),
  });
  if (!res.ok) throw new Error(`Failed to start conversation: ${res.status}`);
  const { conversation_id } = await res.json();
  return conversation_id;
}

export async function markConversationRead(conversationId: number): Promise<void> {
  await fetch(`${API_BASE_URL}/chat/conversations/${conversationId}/read`, {
    method: "POST",
    credentials: "include",
  });
}

export async function reactToMessage(messageId: number, emoji: string): Promise<void> {
  await fetch(`${API_BASE_URL}/chat/messages/${messageId}/react`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emoji }),
  });
}

export async function deleteChatMessage(messageId: number): Promise<void> {
  await fetch(`${API_BASE_URL}/chat/messages/${messageId}`, {
    method: "DELETE",
    credentials: "include",
  });
}

// ws:// for a plain http API_BASE_URL, wss:// for https — same origin
// and port as every other backend call, just a different scheme.
export function getChatWebSocketUrl(): string {
  return `${API_BASE_URL.replace(/^http/, "ws")}/chat/ws`;
}

