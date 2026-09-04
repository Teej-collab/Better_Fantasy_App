// League Manager Polls (2026-09-03) — see backend/app/routers/polls.py.
// Create/close are commissioner-only (backend-enforced); list/vote are
// open to any real member of the league.

export type Poll = {
  id: number;
  question: string;
  options: string[];
  status: "open" | "closed";
  created_at: string;
  closed_at: string | null;
  results: number[];
  my_vote: number | null;
};

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api/backend${path}`, { cache: "no-store" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `GET ${path} failed: ${res.status}`);
  }
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/backend${path}`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `POST ${path} failed: ${res.status}`);
  }
  return res.json();
}

async function patch<T>(path: string): Promise<T> {
  const res = await fetch(`/api/backend${path}`, { method: "PATCH" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `PATCH ${path} failed: ${res.status}`);
  }
  return res.json();
}

export async function listPolls(leagueId: number): Promise<Poll[]> {
  const { polls } = await get<{ polls: Poll[] }>(`/leagues/${leagueId}/polls`);
  return polls;
}

export async function createPoll(leagueId: number, question: string, options: string[]): Promise<Poll> {
  return post(`/leagues/${leagueId}/polls`, { question, options });
}

export async function voteOnPoll(leagueId: number, pollId: number, optionIndex: number): Promise<Poll> {
  return post(`/leagues/${leagueId}/polls/${pollId}/vote`, { option_index: optionIndex });
}

export async function closePoll(leagueId: number, pollId: number): Promise<Poll> {
  return patch(`/leagues/${leagueId}/polls/${pollId}`);
}
