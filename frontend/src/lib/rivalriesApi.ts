// Suggested rivalries (2026-10-27) — see backend/app/routers/rivalry_suggestions.py.
// Commissioner-only (backend-enforced).

export type RivalrySuggestion = {
  id: number;
  owner_a_id: number;
  owner_b_id: number;
  owner_a_name: string;
  owner_b_name: string;
  score: number;
  tier: string;
  reasons: string[];
  suggested_name: string | null;
  suggested_tagline: string | null;
};

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/backend${path}`, {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `${method} ${path} failed: ${res.status}`);
  }
  return res.json();
}

export async function listRivalrySuggestions(leagueId: number): Promise<RivalrySuggestion[]> {
  return (await request<{ suggestions: RivalrySuggestion[] }>("GET", `/leagues/${leagueId}/rivalry-suggestions`))
    .suggestions;
}

export async function approveRivalry(leagueId: number, id: number, name: string, tagline: string): Promise<void> {
  await request("POST", `/leagues/${leagueId}/rivalry-suggestions/${id}/approve`, { name, tagline: tagline || null });
}

export async function dismissRivalry(leagueId: number, id: number): Promise<void> {
  await request("POST", `/leagues/${leagueId}/rivalry-suggestions/${id}/dismiss`);
}
