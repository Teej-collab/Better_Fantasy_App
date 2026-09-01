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
export async function claimOwner(leagueId: number, ownerId: number): Promise<void> {
  await post(`/leagues/${leagueId}/claim-owner`, { owner_id: ownerId });
}
