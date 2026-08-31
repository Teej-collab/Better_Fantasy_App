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

export async function getMyLeagues(): Promise<League[]> {
  const { leagues } = await get<{ leagues: League[] }>("/leagues/mine");
  return leagues;
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
