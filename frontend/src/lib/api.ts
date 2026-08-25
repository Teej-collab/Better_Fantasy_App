import { nflTeamColor } from "@/lib/nfl-teams";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status}`);
  }
  return res.json();
}

// Same as get(), but for endpoints that require the caller to be
// signed in (chat messages, etc.) — routed through /api/backend (see
// app/api/backend/[...path]/route.ts) rather than straight to the
// backend, since a direct browser fetch depends on the browser
// sending the backend's cross-site cookie, which Safari's ITP blocks
// by default even with SameSite=None.
async function authedGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api/backend${path}`, { cache: "no-store" });
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
  // Only present for rows synced after the espn_player_id/pro_team
  // columns were added — null for historical weeks until a full resync
  // backfills them. PlayerHeadshot.tsx falls back to initials when null.
  player_id: number | null;
  pro_team: string | null;
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

// `Math.max(...seasons)` on an empty array is `-Infinity` in JS, not an
// error — silently producing a broken link like `/seasons/-Infinity/awards`
// on a fresh league with nothing synced yet. This is the one place that
// logic lives now, returning `null` instead so every call site is forced
// to branch on "no season yet" rather than trusting a numeric-looking
// value that secretly isn't one.
export function safeLatestSeason(seasons: number[]): number | null {
  return seasons.length > 0 ? Math.max(...seasons) : null;
}

// ESPN reports current_week as 0 during preseason (not a real week) —
// the same fallback to week 1 that used to be copy-pasted identically
// across NavBar.tsx, AppTickerBar.tsx, the homepage, /weekend, and the
// Team page.
export function resolveWeek(currentWeek: number | null | undefined): number {
  return currentWeek && currentWeek >= 1 ? currentWeek : 1;
}

// Where "Awards"/"Matchups" send you when no season has synced yet at
// all — one canonical answer instead of NavBar and /weekend disagreeing
// (they used to fall back to /rivalries and /standings respectively).
export const NO_SEASON_FALLBACK_HREF = "/standings";

export function awardsHrefFor(latestSeason: number | null): string {
  return latestSeason !== null ? `/seasons/${latestSeason}/awards` : NO_SEASON_FALLBACK_HREF;
}

export function matchupsHrefFor(latestSeason: number | null, week: number | null): string {
  return latestSeason !== null && week !== null
    ? `/seasons/${latestSeason}/weeks/${week}`
    : NO_SEASON_FALLBACK_HREF;
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

export type RecordEntry = {
  owner_id: number;
  owner_name: string;
  team_name: string;
  season: number;
  week: number | null;
  value: number;
  opponent_team_name: string | null;
  opponent_score: number | null;
  // Only present on the "Biggest Blowout" category — the winner's own
  // score, alongside opponent_score for the loser's.
  own_score?: number;
};

export type RecordCategory = {
  key: string;
  label: string;
  emoji: string;
  unit: string;
  entries: RecordEntry[];
};

// All-time, not season-scoped — same content regardless of which
// season's Awards page you're looking at. Computed live on every
// request (app/domain/records.py), not cached, so a newly-broken
// record shows up here the moment it's synced.
export function getRecordBook() {
  return get<{ categories: RecordCategory[] }>("/records");
}

export type AwardWinner = {
  owner_id: number;
  owner_name: string;
  wins: number;
};

export type AwardLeaderboardCategory = {
  key: string;
  label: string;
  emoji: string;
  winners: AwardWinner[];
};

// Companion to getRecordBook() — "who's won this yearly award the most,
// across the league's whole history" for every award type
// app/domain/season_awards.py hands out, plus Season Champion
// (app/domain/awards_all_time.py). Always returns every award type the
// league offers, even ones nobody's won yet (an empty `winners` list),
// unlike the record book's categories which hide entirely when empty.
export function getAwardLeaderboards() {
  return get<{ categories: AwardLeaderboardCategory[] }>("/awards/all-time");
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

// One ticker entry, rendered as a run of same-line text segments —
// most segments are plain (no color), but a team abbreviation segment
// carries that team's real color (nfl-teams.ts's NFL_TEAM_COLORS), so
// LiveTicker.tsx can render it in place without re-parsing the string.
export type TickerSegment = { text: string; color?: string };
// href is optional — set by AppTickerBar.tsx when a live NFL game also
// has a Gamecast available for it (see lib/gamecastApi.ts), so that
// one item becomes a real link instead of plain text. Every other
// ticker item (awards/rivalries blurbs, games with no Gamecast yet)
// leaves this unset and renders exactly as before.
export type TickerItem = { key: string; segments: TickerSegment[]; href?: string };

function teamSegment(abbr: string): TickerSegment {
  const color = nflTeamColor(abbr);
  return color ? { text: abbr, color } : { text: abbr };
}

// Shared by the persistent site-wide ticker (layout.tsx), the signed-out
// gate's own ticker (OpeningExperience.tsx via page.tsx), and the
// homepage dashboard's richer ticker — the exact same real NFL data
// everywhere, just without the league-specific items (awards/rivalries/
// standings) that only make sense in the homepage's own context.
export function buildNflTickerItems(nflGames: NflGame[]): TickerItem[] {
  // Every game currently on the scoreboard, not a truncated slice — a
  // real week's slate is ~16 games and the ticker scrolls continuously,
  // so there's no real reason to hide the back half of it. Game Day
  // still matters for scroll *speed* (LiveTicker's fast prop, driven by
  // isGameDay at the call site), just not for how many games show up.
  const items: TickerItem[] = [];
  for (const g of nflGames) {
    if (!g.home_team || !g.away_team) continue;
    if (g.state === "in") {
      items.push({
        key: g.id,
        segments: [
          { text: "🏈 " },
          teamSegment(g.away_team),
          { text: ` ${g.away_score} — ` },
          teamSegment(g.home_team),
          { text: ` ${g.home_score} (${g.status_detail ?? "Live"})` },
        ],
      });
    } else if (g.state === "post") {
      items.push({
        key: g.id,
        segments: [
          { text: "🏁 " },
          teamSegment(g.away_team),
          { text: ` ${g.away_score} — ` },
          teamSegment(g.home_team),
          { text: ` ${g.home_score} Final` },
        ],
      });
    } else {
      items.push({
        key: g.id,
        segments: [
          { text: "🏈 " },
          teamSegment(g.away_team),
          { text: " @ " },
          teamSegment(g.home_team),
          { text: ` — ${g.status_detail ?? "Upcoming"}` },
        ],
      });
    }
  }
  return items;
}

// ---- League scores + top-scorer ticker (the "second ticker") -------------

export type LeagueTickerTopScorer = { player_name: string; points_scored: number };

export type LeagueTickerItem = {
  matchup_id: number;
  home_team_name: string;
  home_score: number | null;
  home_top_scorer: LeagueTickerTopScorer | null;
  away_team_name: string;
  away_score: number | null;
  away_top_scorer: LeagueTickerTopScorer | null;
};

// Deliberately its own lightweight endpoint (app/domain/league_ticker.py)
// rather than reusing getWeekMatchupContext — that call also computes
// streaks/head-to-head/rivalry data this ticker never needs, and this
// renders on every app page (AppTickerBar.tsx), not just the ones
// already paying for the heavier call.
export async function getWeekLeagueTicker(season: number, week: number): Promise<{ items: LeagueTickerItem[] }> {
  try {
    return await get<{ items: LeagueTickerItem[] }>(`/seasons/${season}/weeks/${week}/ticker`);
  } catch {
    return { items: [] };
  }
}

function leagueTickerSideText(teamName: string, score: number | null, top: LeagueTickerTopScorer | null): string {
  const scoreText = score !== null ? score.toFixed(1) : "—";
  const topText = top ? ` (⭐ ${top.player_name} ${top.points_scored.toFixed(1)})` : "";
  return `${teamName} ${scoreText}${topText}`;
}

// Each owner's own top scorer shown on their own side of the matchup —
// not just whichever of the two scored higher — so a blowout's losing
// side still gets credit for its own best performer.
export function buildLeagueTickerItems(data: { items: LeagueTickerItem[] }): TickerItem[] {
  return data.items.map((m) => ({
    key: `league-${m.matchup_id}`,
    segments: [
      {
        text: `🏆 ${leagueTickerSideText(m.home_team_name, m.home_score, m.home_top_scorer)} vs ${leagueTickerSideText(m.away_team_name, m.away_score, m.away_top_scorer)}`,
      },
    ],
  }));
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
  const res = await fetch(`/api/backend/chug/standing/${ownerId}/clear-fine${qs}`, {
    method: "POST",
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
  // Both null when the signed-in owner has no team row for the active
  // season yet (e.g. before this season's ESPN sync has run).
  team_name: string | null;
  team_name_is_custom: boolean | null;
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

// Server-side counterpart to getPreferences() below — same direct-to-
// backend-with-explicit-cookie pattern as getMySettings/getMe, for
// server components (like (home)/page.tsx) that need the owner's
// preferences during SSR and can't use the client-only /api/backend
// proxy getPreferences() relies on.
export async function getMyPreferences(sessionCookie: string | undefined): Promise<OwnerPreferences | null> {
  if (!sessionCookie) return null;
  const res = await fetch(`${API_BASE_URL}/settings/preferences`, {
    cache: "no-store",
    headers: { Cookie: `session=${sessionCookie}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function _settingsRequest(path: string, method: string, body?: object): Promise<void> {
  const res = await fetch(`/api/backend/settings${path}`, {
    method,
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

// Renames the signed-in owner's team for the current season only —
// updates our own database immediately everywhere the app shows a team
// name (standings, league, rosters...). Does NOT push the new name to
// ESPN's own copy — that's a separate, not-yet-built sync (see
// ESPN_LINEUP_WRITE.md for why a team-rename write needs its own real
// captured request before it can be built safely).
export function updateTeamName(teamName: string): Promise<void> {
  return _settingsRequest("/team-name", "PUT", { team_name: teamName });
}

export function resetTeamName(): Promise<void> {
  return _settingsRequest("/team-name/reset", "POST");
}

// ---- Notification / chat / appearance preferences (Settings > Notifications,
// Settings > Chat, Settings > Appearance) — one owner_preferences row per
// owner, see backend/app/queries/owner_preferences.py for the real shape
// and defaults these mirror. quiet_hours_start/end round-trip as
// "HH:MM:SS" (backend's datetime.time serialization) — callers that feed
// them into a native <input type="time"> should slice to "HH:MM".

export type SundayMode = "full_send" | "game_day" | "leave_me_alone";

export type OwnerPreferences = {
  notify_direct_messages: boolean;
  notify_league_chat: boolean;
  notify_mentions: boolean;
  notify_replies: boolean;
  sunday_mode: SundayMode | null;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  read_receipts_enabled: boolean;
  typing_indicators_enabled: boolean;
  message_previews_enabled: boolean;
  mention_highlighting_enabled: boolean;
  neon_intensity: "subtle" | "standard" | "high";
  reduced_motion: boolean;
  accent_color: string | null;
  // JSON-encoded array of home dashboard card keys (HomeCardDeck.tsx),
  // e.g. '["standings","yourWeek",...]' — null means "use the default
  // order". Stored as a raw string, not string[], because that's
  // exactly what the backend stores and returns; parsing only happens
  // where it's actually rendered (HomeCardDeck.tsx).
  home_card_order: string | null;
  // Reflects whether the owner has at least one active push
  // subscription — set by the backend from POST /push/subscribe and
  // /push/unsubscribe (app/routers/push.py), never written directly
  // through updatePreferences (see that endpoint's own comment).
  push_enabled: boolean;
  notify_game_alerts: boolean;
  notify_my_players: boolean;
  notify_fantasy_team: boolean;
  notify_league: boolean;
};

async function _preferencesRequest(path: string, method: string, body?: object): Promise<OwnerPreferences> {
  const res = await fetch(`/api/backend/settings/preferences${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export function getPreferences(): Promise<OwnerPreferences> {
  return _preferencesRequest("", "GET");
}

export function updatePreferences(patch: Partial<OwnerPreferences>): Promise<OwnerPreferences> {
  return _preferencesRequest("", "PUT", patch);
}

export function applySundayMode(preset: SundayMode): Promise<OwnerPreferences> {
  return _preferencesRequest("/sunday-mode", "POST", { preset });
}

// HomeCardDeck.tsx's own save call — just a thin wrapper over
// updatePreferences so callers don't have to remember to JSON-encode
// the array themselves.
export function updateHomeCardOrder(order: string[]): Promise<OwnerPreferences> {
  return updatePreferences({ home_card_order: JSON.stringify(order) });
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
  const res = await fetch(`/api/backend/me/team`, { cache: "no-store" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `Failed to load team (${res.status})`);
  }
  return res.json();
}

export type LineupSwapPreview = { player_a: RosterEntry; player_b: RosterEntry };

export async function previewLineupSwap(playerA: string, playerB: string): Promise<LineupSwapPreview> {
  const res = await fetch(`/api/backend/me/team/lineup/preview-swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ player_a: playerA, player_b: playerB }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `Preview failed (${res.status})`);
  }
  return res.json();
}

// ---- Free Agents (browsing is read-only — see backend/app/providers/
// espn/free_agents.py — but adding one is now previewable, same
// PREVIEW-ONLY pattern as the lineup move/swap calls above: validates
// against your real live roster and shows exactly what would happen,
// never actually submits anything to ESPN. See
// backend/app/providers/espn/lineup_client.py's plan_add_player.) ----

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

export type AddFreeAgentPreview = {
  added_player: { player_id: number; player_name: string; position: string; pro_team: string };
  roster_size_before: number;
  roster_capacity: number;
  // The one player who'd need to be dropped to make room — null means
  // your roster already had an open spot.
  dropped_player: RosterEntry | null;
};

export type AddFreeAgentResult =
  | { status: "ok"; preview: AddFreeAgentPreview }
  // Your roster is already full — call previewAddFreeAgent again with
  // dropPlayerName set once the visitor picks who to drop.
  | { status: "roster_full"; detail: string };

export async function previewAddFreeAgent(
  player: Pick<FreeAgent, "player_id" | "name" | "position" | "pro_team">,
  dropPlayerName?: string
): Promise<AddFreeAgentResult> {
  const res = await fetch(`/api/backend/me/team/free-agents/preview-add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      player_id: player.player_id,
      player_name: player.name,
      position: player.position,
      pro_team: player.pro_team,
      drop_player_name: dropPlayerName ?? null,
    }),
  });

  if (res.status === 409) {
    const data = await res.json().catch(() => null);
    if (data?.error === "roster_full") {
      return { status: "roster_full", detail: data.detail as string };
    }
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `Preview failed (${res.status})`);
  }
  const preview = (await res.json()) as AddFreeAgentPreview;
  return { status: "ok", preview };
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
  image_url: string | null;
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
  const res = await fetch(`/api/backend/chat/members`);
  if (!res.ok) return [];
  const { members } = await res.json();
  return members;
}

export async function startDirectConversation(ownerId: number): Promise<number> {
  const res = await fetch(`/api/backend/chat/conversations/direct`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner_id: ownerId }),
  });
  if (!res.ok) throw new Error(`Failed to start conversation: ${res.status}`);
  const { conversation_id } = await res.json();
  return conversation_id;
}

export async function markConversationRead(conversationId: number): Promise<void> {
  await fetch(`/api/backend/chat/conversations/${conversationId}/read`, {
    method: "POST",
  });
}

export async function reactToMessage(messageId: number, emoji: string): Promise<void> {
  await fetch(`/api/backend/chat/messages/${messageId}/react`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emoji }),
  });
}

export async function deleteChatMessage(messageId: number): Promise<void> {
  await fetch(`/api/backend/chat/messages/${messageId}`, {
    method: "DELETE",
  });
}

// Mints a short-lived ticket via the frontend's own same-origin route
// (app/auth/ticket/route.ts), which reads the first-party cookie
// server-side — never touched by Safari's ITP — and forwards it to
// the backend. Null if the visitor isn't actually signed in (the
// ticket route reads no cookie at all) or the mint call itself fails.
export async function getChatWsTicket(): Promise<string | null> {
  const res = await fetch("/auth/ticket?purpose=ws", { method: "POST" });
  if (!res.ok) return null;
  const { ticket } = await res.json();
  return ticket ?? null;
}

// Same idea, for the chug video upload (ChugUpload.tsx) — see
// getChatWsTicket just above.
export async function getChugUploadTicket(): Promise<string | null> {
  const res = await fetch("/auth/ticket?purpose=chug_upload", { method: "POST" });
  if (!res.ok) return null;
  const { ticket } = await res.json();
  return ticket ?? null;
}

// ws:// for a plain http API_BASE_URL, wss:// for https — same origin
// and port as every other backend call, just a different scheme. The
// WS handshake itself is still a direct cross-site browser request —
// can't go through the /api/backend proxy (that's plain HTTP, not a
// protocol upgrade) — so it carries the ticket above in the URL
// instead of relying on the backend's own cookie reaching it.
export function getChatWebSocketUrl(ticket: string): string {
  return `${API_BASE_URL.replace(/^http/, "ws")}/chat/ws?ticket=${encodeURIComponent(ticket)}`;
}

