// Create/join a league, and create a team within one — see
// backend/app/routers/leagues.py's module docstring for the full
// picture. Same same-origin /api/backend proxy every other
// authenticated call in this app uses.

export type League = {
  id: number;
  name: string;
  invite_code: string;
  created_at: string;
  role: "commissioner" | "member";
};

export type Team = {
  team_id: number;
  team_name: string;
  owner_id: number;
  owner_name: string;
};

export type UnclaimedOwner = {
  owner_id: number;
  display_name: string;
};

export type Member = {
  user_id: number;
  role: "commissioner" | "member";
  joined_at: string;
  display_name: string;
};

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api/backend${path}`, { cache: "no-store" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `GET ${path} failed: ${res.status}`);
  }
  return res.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/backend${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `POST ${path} failed: ${res.status}`);
  }
  return res.json();
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/backend${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `PATCH ${path} failed: ${res.status}`);
  }
  return res.json();
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`/api/backend${path}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `DELETE ${path} failed: ${res.status}`);
  }
  return res.json();
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/backend${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `PUT ${path} failed: ${res.status}`);
  }
  return res.json();
}

export async function getMyLeagues(): Promise<{ leagues: League[]; activeLeagueId: number | null }> {
  const body = await get<{ leagues: League[]; active_league_id: number | null }>("/leagues/mine");
  return { leagues: body.leagues, activeLeagueId: body.active_league_id };
}

export async function createLeague(name: string): Promise<League> {
  return post<League>("/leagues", { name });
}

export async function joinLeague(inviteCode: string): Promise<League> {
  return post<League>("/leagues/join", { invite_code: inviteCode });
}

export async function createTeam(leagueId: number, teamName: string): Promise<Team> {
  return post<Team>(`/leagues/${leagueId}/teams`, { team_name: teamName });
}

export async function getLeagueTeams(leagueId: number): Promise<Team[]> {
  const { teams } = await get<{ teams: Team[] }>(`/leagues/${leagueId}/teams`);
  return teams;
}

// The only way active_league_id changes (see backend/app/auth/
// league_context.py's module docstring) — verifies real membership
// server-side first, so this can never activate a league the caller
// doesn't actually belong to.
export async function selectLeague(leagueId: number): Promise<{ active_league_id: number }> {
  return post<{ active_league_id: number }>(`/leagues/${leagueId}/select`, {});
}

export async function getUnclaimedOwners(leagueId: number): Promise<UnclaimedOwner[]> {
  const { owners } = await get<{ owners: UnclaimedOwner[] }>(`/leagues/${leagueId}/unclaimed-owners`);
  return owners;
}

// Self-service history claiming — links a real historical owner (their
// past chug debts, keeper picks, seasons, matchups, awards) to the
// caller's account. First-claim-wins; a 409 means someone already
// claimed it.
//
// The backend reissues a session token with the newly-linked owner_id
// baked in (see leagues.py's claim_owner docstring for why: owner_id
// lives in the JWT, set once at login, never re-derived from the DB —
// without this, every owner-scoped page keeps reading the OLD, still-
// unlinked owner_id from the caller's existing cookie and shows "No
// team found for this owner" right after a successful claim). Swaps
// the frontend's own first-party cookie for it the same way the OAuth
// callback flow does (auth/complete/page.tsx), so the caller doesn't
// need to sign out and back in for the claim to actually take effect.
export async function claimOwner(leagueId: number, ownerId: number): Promise<void> {
  const { token } = await post<{ owner_id: number; claimed: boolean; token: string }>(
    `/leagues/${leagueId}/claim-owner`,
    { owner_id: ownerId },
  );
  const res = await fetch("/auth/complete/set-cookie", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    throw new Error("Claimed, but couldn't refresh your session — please sign out and back in.");
  }
}

// Generates a single-use link a friend can redeem to become a
// co-owner of the caller's own team — both people then act as the
// exact same owner_id everywhere (chat, trades, lineup, push). Not
// scoped to a specific league/team: resolve_owner_id on the backend
// is already the caller's real identity, and redeeming grants access
// to every league/team that owner has, not just one.
export async function createCoOwnerInvite(): Promise<string> {
  const { invite_code } = await post<{ invite_code: string }>("/leagues/co-owner-invite", {});
  return invite_code;
}

// Same session-cookie-swap requirement as claimOwner above (owner_id
// lives in the JWT, set once at login, never re-derived from the DB)
// — without it the redeemer's own browser would still show "No team
// found for this owner" until they signed out and back in.
export async function redeemCoOwnerInvite(inviteCode: string): Promise<number> {
  const { owner_id, token } = await post<{ owner_id: number; token: string }>(
    "/leagues/co-owner-invites/redeem",
    { invite_code: inviteCode },
  );
  const res = await fetch("/auth/complete/set-cookie", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    throw new Error("Joined, but couldn't refresh your session — please sign out and back in.");
  }
  return owner_id;
}

export async function getLeagueMembers(leagueId: number): Promise<Member[]> {
  const { members } = await get<{ members: Member[] }>(`/leagues/${leagueId}/members`);
  return members;
}

// Commissioner-only (backend-enforced via require_commissioner_of) — the
// name shown on this league's own ticker/label wherever it's
// distinguished from other leagues (see the homepage's league ticker).
export async function renameLeague(leagueId: number, name: string): Promise<League> {
  return patch<League>(`/leagues/${leagueId}`, { name });
}

// Commissioner-only — the backend enforces this (require_commissioner_of)
// and also rejects targeting your own user_id, so a commissioner can
// never accidentally remove their own access through this call.
export async function setMemberRole(
  leagueId: number,
  userId: number,
  role: "commissioner" | "member"
): Promise<void> {
  await patch(`/leagues/${leagueId}/members/${userId}`, { role });
}

// Commissioner-only — revokes access only (see backend/app/queries/
// leagues.py's remove_member docstring): the member's owners record,
// history, and any current team are untouched. Can't target the
// caller's own user_id (backend-enforced, same self-protection as
// setMemberRole above).
export async function removeMember(leagueId: number, userId: number): Promise<void> {
  await del(`/leagues/${leagueId}/members/${userId}`);
}

// Commissioner-only — hands an existing team's roster/history to a
// different current league member (must already be a member; this
// never invites someone new on its own).
export async function reassignTeam(leagueId: number, teamId: number, userId: number): Promise<Team> {
  return post<Team>(`/leagues/${leagueId}/teams/${teamId}/reassign`, { user_id: userId });
}

// Commissioner-only — creates a brand new team on behalf of an
// existing member who hasn't self-served their own (POST /leagues/
// {leagueId}/teams, which any member can call for themselves). The
// target must already be a member; one team per owner per season still
// applies.
export async function createTeamForMember(leagueId: number, userId: number, teamName: string): Promise<Team> {
  return post<Team>(`/leagues/${leagueId}/teams/for-member`, { user_id: userId, team_name: teamName });
}

export type PlayoffSettings = {
  season: number;
  playoff_team_count: number | null;
  // This league's real ESPN settings (the commissioner's own
  // screenshot): weeks_per_matchup=2. weeks_per_matchup defaults to 1
  // (single-week matchups) until explicitly set; start_week is null
  // until explicitly set, meaning app/domain/playoffs.py infers it
  // from this season's own regular-season matchups at generation time.
  weeks_per_matchup: number;
  start_week: number | null;
};

export async function getPlayoffSettings(): Promise<PlayoffSettings> {
  return get("/league/playoff-settings");
}

// Commissioner-only — an explicit override for how many teams make the
// playoffs THIS season (taking priority over the standings page's own
// fallback of inferring from a prior completed season's real bracket),
// plus the two settings that drive app/domain/playoffs.py's bracket
// generator. A single PUT always writes all three together (see that
// endpoint's own note) — never call this with only some of them once
// the others have real values you want to keep.
export async function updatePlayoffSettings(
  season: number,
  playoffTeamCount: number,
  weeksPerMatchup: number = 1,
  startWeek: number | null = null
): Promise<PlayoffSettings> {
  return put("/league/playoff-settings", {
    season,
    playoff_team_count: playoffTeamCount,
    weeks_per_matchup: weeksPerMatchup,
    start_week: startWeek,
  });
}

export type ScoringRule = { stat_category: string; points_per_unit: number };

// Omit `season` for the active season (the Commissioner editor's own
// use) — pass it to resolve a *past* season's real rates instead (a
// score breakdown on an old matchup needs that season's own rules,
// which can differ after a mid-season change).
export async function getScoringRules(season?: number): Promise<{ season: number; rules: ScoringRule[] }> {
  const query = season != null ? `?season=${season}` : "";
  return get<{ season: number; rules: ScoringRule[] }>(`/league/scoring-rules${query}`);
}

// Commissioner-only — every stat_category already exists per season/
// league from league creation, so this only ever updates existing
// rows (see backend/app/queries/leagues.py's upsert_scoring_rules).
export async function updateScoringRules(
  season: number,
  rules: Record<string, number>
): Promise<{ season: number; rules: ScoringRule[] }> {
  return put<{ season: number; rules: ScoringRule[] }>("/league/scoring-rules", { season, rules });
}
