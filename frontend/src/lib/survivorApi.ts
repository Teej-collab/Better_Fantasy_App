// NFL survivor pools (2026-11-07): the shapes app/routers/survivor.py
// returns (the same as the app's mobile/src/lib/survivorTypes.ts) and the
// client calls, through the /api/backend proxy so the browser's own session
// cookie rides along.

export type SurvivorPickView =
  | { week: number; slot: number; hidden: true }
  | {
      week: number;
      slot: number;
      hidden?: undefined;
      team: string | null;
      auto: boolean;
      result: "win" | "loss" | "tie" | "missed" | null;
      locked: boolean;
      kickoff: string | null;
      opponent: string | null;
      home: boolean | null;
    };

export type SurvivorMyEntry = {
  entry_id: number;
  entry_no: number;
  alive: boolean;
  lives_left: number;
  lives_total: number;
  eliminated_week: number | null;
  picks: SurvivorPickView[];
  needs_pick: boolean;
};

export type SurvivorPoolSummary = {
  id: number;
  name: string;
  season: number;
  league_id: number | null;
  league_name: string | null;
  join_code: string;
  start_week: number;
  lives: number;
  tie_counts_as: "win" | "loss";
  buyback_until_week: number | null;
  double_from_week: number | null;
  missed_pick: "auto" | "loss";
  max_entries: number;
  prize_note: string | null;
  created_by: number;
  week: number;
  entries: number;
  alive: number;
  mine: SurvivorMyEntry[];
  winners: string[];
  can_add_entry: boolean;
};

export type SurvivorHub = {
  season: number;
  week: number;
  pools: SurvivorPoolSummary[];
  league: { id: number; name: string; is_commissioner: boolean } | null;
  next_lock: string | null;
};

export type SurvivorFieldRow = {
  entry_id: number;
  name: string;
  mine: boolean;
  lives_left: number;
  eliminated_week: number | null;
  bought_back: boolean;
  picks: SurvivorPickView[];
  picked_this_week: boolean;
};

export type SurvivorField = {
  week: number;
  rows: SurvivorFieldRow[];
  alive: number;
  picked: number;
  popularity: { week: number; teams: { team: string; count: number; result: string | null }[] }[];
  winners: string[];
};

export type SurvivorPoolDetail = SurvivorPoolSummary & { field: SurvivorField; is_commissioner: boolean };

export type SurvivorBoardTeam = {
  team: string;
  opponent: string;
  home: boolean;
  win_pct: number | null;
  used_week: number | null;
  locked: boolean;
};

export type SurvivorBoard = {
  week: number;
  slots: number;
  lives_left: number;
  lives_total: number;
  eliminated_week: number | null;
  games: { id: string; kickoff: string | null; locked: boolean; teams: SurvivorBoardTeam[] }[];
  byes: string[];
  picks: SurvivorPickView[];
  used: { team: string; week: number }[];
  can_buy_back: boolean;
  deadline: string | null;
  pool: { id: number; name: string };
  entry_no: number;
  can_pick: boolean;
};

export type SurvivorPlanner = {
  weeks: number[];
  double_weeks: number[];
  rows: { team: string; weeks: ({ opponent: string; home: boolean; win_pct: number | null } | null)[] }[];
};

export type SurvivorPoolInput = {
  name: string;
  for_league: boolean;
  start_week?: number;
  lives: number;
  tie_counts_as: "win" | "loss";
  buyback_until_week: number | null;
  double_from_week: number | null;
  missed_pick: "auto" | "loss";
  max_entries: number;
  prize_note: string | null;
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/backend/survivor${path}`, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      // Not JSON; keep the status message.
    }
    throw new Error(detail);
  }
  return res.json();
}

export const survivorApi = {
  pools: () => call<SurvivorHub>("/pools"),
  pool: (id: number) => call<SurvivorPoolDetail>(`/pools/${id}`),
  create: (body: SurvivorPoolInput) => call<{ id: number; join_code: string }>("/pools", { method: "POST", body: JSON.stringify(body) }),
  join: (body: { code?: string; pool_id?: number }) => call<{ pool_id: number; entry_id: number }>("/join", { method: "POST", body: JSON.stringify(body) }),
  board: (entryId: number) => call<SurvivorBoard>(`/entries/${entryId}/board`),
  setPicks: (entryId: number, teams: string[]) => call<SurvivorBoard>(`/entries/${entryId}/picks`, { method: "PUT", body: JSON.stringify({ teams }) }),
  planner: (entryId: number) => call<SurvivorPlanner>(`/entries/${entryId}/planner`),
  buyBack: (entryId: number) => call<{ ok: boolean }>(`/entries/${entryId}/buyback`, { method: "POST" }),
};
