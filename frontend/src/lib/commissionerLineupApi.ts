// Commissioner-only force-edit of any member's roster — see
// backend/app/routers/commissioner_lineup.py. Reuses the RosterEntry
// shape api.ts's own /me/team/lineup routes already define, since
// these hit the exact same domain logic (lineup_engine.py), just with
// an explicit team_id instead of one resolved from the caller's own
// session.
import type { RosterEntry } from "@/lib/api";

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

export async function getTeamCurrentRoster(leagueId: number, teamId: number): Promise<RosterEntry[]> {
  const { roster } = await get<{ roster: RosterEntry[] }>(`/leagues/${leagueId}/teams/${teamId}/roster`);
  return roster;
}

export async function commissionerDropPlayer(
  leagueId: number,
  teamId: number,
  sleeperPlayerId: string
): Promise<{ roster: RosterEntry[] }> {
  return post(`/leagues/${leagueId}/teams/${teamId}/roster/drop`, { sleeper_player_id: sleeperPlayerId });
}

export type CommissionerAddResult =
  | { status: "ok"; roster: RosterEntry[]; dropped_player: RosterEntry | null }
  | { status: "roster_full" };

export async function commissionerAddPlayer(
  leagueId: number,
  teamId: number,
  sleeperPlayerId: string,
  dropSleeperPlayerId?: string
): Promise<CommissionerAddResult> {
  const res = await fetch(`/api/backend/leagues/${leagueId}/teams/${teamId}/roster/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sleeper_player_id: sleeperPlayerId, drop_sleeper_player_id: dropSleeperPlayerId }),
  });
  if (res.status === 409) {
    return { status: "roster_full" };
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `Add failed (${res.status})`);
  }
  const data = await res.json();
  return { status: "ok", roster: data.roster, dropped_player: data.dropped_player };
}
