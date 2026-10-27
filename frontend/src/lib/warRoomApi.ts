// The War Room (2026-10-27) — see backend/app/routers/war_room.py.

export type WarRoomPhase = "keepers" | "draft" | "report_card";

export type WarRoomKeepers = {
  max_keepers: number;
  max_consecutive_years: number | null;
  deadline: string | null;
  locked: boolean;
  is_open: boolean;
  waiting_on: number;
  // players is null for someone else's keepers until they lock.
  managers: { owner_id: number; is_me: boolean; name: string; count: number; done: boolean; players: string[] | null }[];
};

export type WarRoomPlayer = { sleeper_player_id: string; name: string; position: string | null; team?: string | null };

export type WarRoomDraft = {
  status: "not_set" | "not_started" | "in_progress" | "paused" | "complete";
  draft_type: string | null;
  scheduled_start: string | null;
  pick_seconds: number | null;
  team_count: number;
  rounds: number | null;
  my_slot: number | null;
  order: { owner_id: number; name: string }[];
  my_picks: {
    pick_number: number;
    round: number;
    round_pick: number;
    is_keeper: boolean;
    player_name: string | null;
    position: string | null;
  }[];
  next_pick: number | null;
  likely_available: (WarRoomPlayer & { adp: number; chance: number })[];
  queue: (WarRoomPlayer & { adp: number | null })[];
  keepers_off_board: { owner_id: number; name: string; players: string[] }[];
};

export type WarRoomHeadline = {
  owner_name: string;
  owner_id: number;
  round: number;
  player_name: string;
  position: string | null;
  position_rank: number | null;
  points: number;
};

export type WarRoomReportCard = {
  through_week: number | null;
  team_count: number;
  draft_day: { letter: string | null; rank: number | null };
  hindsight: { letter: string; rank: number } | null;
  narrative: string | null;
  picks: {
    pick_number: number;
    round: number;
    round_pick: number;
    is_keeper: boolean;
    sleeper_player_id: string;
    player_name: string;
    position: string | null;
    points: number;
    status: "starter" | "bench" | "ir" | "gone";
    tag: "steal" | "bust" | null;
  }[];
  best_pick: WarRoomHeadline | null;
  biggest_miss: WarRoomHeadline | null;
  keeper_watch: {
    slots: number;
    players: (WarRoomPlayer & { points: number; next_year: number; eligible: boolean; max_years: number | null })[];
  } | null;
};

export type WarRoom = {
  season: number;
  phase: WarRoomPhase;
  keepers: WarRoomKeepers | null;
  draft: WarRoomDraft;
  report_card: WarRoomReportCard | null;
};

async function request<T>(method: "GET" | "POST", path: string): Promise<T> {
  const res = await fetch(`/api/backend${path}`, { method, cache: "no-store" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `${method} ${path} failed: ${res.status}`);
  }
  return res.json();
}

export function getWarRoom(): Promise<WarRoom> {
  return request("GET", "/war-room");
}

export function nudgeKeepers(): Promise<{ nudged: number }> {
  return request("POST", "/war-room/keeper-nudge");
}
