// The in-app real-time draft — types + fetchers for backend/app/routers/draft.py.
// Unlike gamecastApi.ts's public/no-auth reads (a direct cross-origin
// fetch against API_BASE_URL is fine for those), every /draft/* REST
// endpoint requires a signed-in session — so reads AND writes both go
// through the same /api/backend same-origin proxy the rest of the app
// uses (see api.ts), not a direct fetch, to avoid Safari ITP blocking
// the cross-site session cookie (see that proxy route's own docstring).
// Only the WebSocket handshake uses the ticket-mint pattern, since an
// HTTP proxy can't forward a protocol upgrade.
import { API_BASE_URL } from "@/lib/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api/backend${path}`, { cache: "no-store" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `GET ${path} failed: ${res.status}`);
  }
  return res.json();
}

export type DraftStatus = "not_started" | "in_progress" | "paused" | "complete";

export type DraftConfig = {
  season: number;
  draft_type: string;
  pick_time_limit_seconds: number;
  draft_order: number[];
  roster_slots: Record<string, number>;
  status: DraftStatus;
  current_pick_number: number;
  current_pick_deadline: string | null;
  paused_remaining_seconds: number | null;
  started_at: string | null;
  completed_at: string | null;
};

export type DraftPick = {
  pick_number: number;
  round: number;
  round_pick: number;
  owner_id: number;
  owner_name: string;
  sleeper_player_id: string | null;
  player_name: string | null;
  player_position: string | null;
  is_autopick: boolean;
  is_keeper: boolean;
  made_at: string | null;
};

export type DraftState = { config: DraftConfig; picks: DraftPick[] };

export type DraftPoolPlayer = {
  sleeper_player_id: string;
  full_name: string;
  position: string;
  pro_team: string | null;
  search_rank: number | null;
  injury_status: string | null;
  drafted: boolean;
};

export async function getDraftState(): Promise<DraftState> {
  return get<DraftState>("/draft/state");
}

export async function getDraftPool(position?: string, search?: string): Promise<DraftPoolPlayer[]> {
  const params = new URLSearchParams();
  if (position) params.set("position", position);
  if (search) params.set("search", search);
  const qs = params.toString();
  const { players } = await get<{ players: DraftPoolPlayer[] }>(`/draft/pool${qs ? `?${qs}` : ""}`);
  return players;
}

export type DraftPickResult = { pick: DraftPick; config: DraftConfig };

export async function submitDraftPick(sleeperPlayerId: string): Promise<DraftPickResult> {
  const res = await fetch(`/api/backend/draft/pick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sleeper_player_id: sleeperPlayerId }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `Pick failed (${res.status})`);
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

// Commissioner-only setup/control — see app/routers/draft.py's
// _require_commissioner-gated endpoints. The frontend doesn't hide
// these from a non-commissioner (the page-level isCommissioner check
// does that); the backend still enforces the gate regardless.
export async function setupDraft(
  draftOrder: number[],
  rosterSlots: Record<string, number>,
  pickTimeLimitSeconds: number
): Promise<DraftState> {
  return post<DraftState>("/draft/setup", {
    draft_order: draftOrder,
    roster_slots: rosterSlots,
    pick_time_limit_seconds: pickTimeLimitSeconds,
  });
}

export async function startDraft(): Promise<{ config: DraftConfig }> {
  return post("/draft/start");
}

export async function pauseDraft(): Promise<{ config: DraftConfig }> {
  return post("/draft/pause");
}

export async function resumeDraft(): Promise<{ config: DraftConfig }> {
  return post("/draft/resume");
}

export async function undoLastPick(): Promise<{ undone_pick: DraftPick; config: DraftConfig }> {
  return post("/draft/undo-last-pick");
}

// Wipes the whole draft (config, every pick, seeded rosters) so the
// commissioner can redo a mock draft or change the order/roster shape
// before the real one — see app/domain/draft_engine.py's reset_draft.
export async function resetDraft(): Promise<{ ok: true }> {
  return post("/draft/reset");
}

// Same same-origin ticket-mint pattern as getGamecastWsTicket
// (gamecastApi.ts) — purpose must be exactly "ws".
export async function getDraftWsTicket(): Promise<string | null> {
  const res = await fetch("/auth/ticket?purpose=ws", { method: "POST" });
  if (!res.ok) return null;
  const { ticket } = await res.json();
  return ticket ?? null;
}

export function getDraftWebSocketUrl(ticket: string, season: number): string {
  return `${API_BASE_URL.replace(/^http/, "ws")}/draft/ws?ticket=${encodeURIComponent(ticket)}&season=${season}`;
}
