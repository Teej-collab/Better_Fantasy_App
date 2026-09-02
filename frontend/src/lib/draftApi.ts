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
  // When the real draft is planned for — separate from started_at
  // (only set once it actually begins). Null until the commissioner
  // sets it via setDraftSchedule below.
  scheduled_start: string | null;
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
  // Sleeper's own overall-rank proxy — this app's real ADP-equivalent
  // (see backend/app/domain/draft_autopick.py's own docstring); shown
  // in the pool as "ADP" since that's the closest real signal there is.
  search_rank: number | null;
  injury_status: string | null;
  // Both null until the bulk ESPN sync (player_projections.py) resolves
  // this player's espn_player_id crosswalk — a real gap for some
  // players, shown as "—" rather than blocking the row.
  projected_points: number | null;
  // From team_bye_weeks, not ESPN — see get_draft_pool's own comment.
  bye_week: number | null;
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

// Server-side counterparts to getDraftState/getDraftPool — draft/page.tsx
// server-fetches the initial draft state and pool (parallel via
// Promise.all with the team list) and passes them as DraftRoom's initial
// props, so the room renders real content on first paint instead of
// waiting on the client-only fetch's extra post-hydration round trip.
// Same explicit session-cookie pattern as api.ts's getMe/getMyFreeAgents —
// a server component has no ambient browser cookie jar for the same-origin
// /api/backend proxy to ride along on. Return null/[] on no session or any
// fetch failure (including a genuine "no draft set up yet" 404) — DraftRoom
// falls back to its own client-side fetch in that case, same as before.
export async function getDraftStateServer(sessionCookie: string | undefined): Promise<DraftState | null> {
  if (!sessionCookie) return null;
  const res = await fetch(`${API_BASE_URL}/draft/state`, {
    cache: "no-store",
    headers: { Cookie: `session=${sessionCookie}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export async function getDraftPoolServer(
  sessionCookie: string | undefined,
  position?: string,
  search?: string
): Promise<DraftPoolPlayer[]> {
  if (!sessionCookie) return [];
  const params = new URLSearchParams();
  if (position) params.set("position", position);
  if (search) params.set("search", search);
  const qs = params.toString();
  const res = await fetch(`${API_BASE_URL}/draft/pool${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
    headers: { Cookie: `session=${sessionCookie}` },
  });
  if (!res.ok) return [];
  const { players } = (await res.json()) as { players: DraftPoolPlayer[] };
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

// localDateTime: a raw <input type="datetime-local"> value ("2026-09-
// 05T15:00"), naive and implicitly in the commissioner's own browser
// timezone. new Date(...) parses that using the browser's own local
// timezone (the same one the input itself used), and toISOString()
// converts it to a real, unambiguous UTC instant — the backend needs
// a real offset, not a naive string (see app/routers/draft.py's
// ScheduleRequest docstring for why a naive value would be genuinely
// ambiguous server-side).
export async function setDraftSchedule(localDateTime: string): Promise<DraftState | null> {
  return put<DraftState | null>("/draft/schedule", { scheduled_start: new Date(localDateTime).toISOString() });
}

// The real draft time even before a real draft exists to hold it —
// lets DraftSetupPanel.tsx pre-fill a previously-set date (PUT
// /draft/schedule can be called before /draft/setup at all; see
// backend/app/routers/draft.py's own GET /draft/schedule docstring for
// where that value lives until then).
export async function getDraftSchedule(): Promise<{ scheduled_start: string | null }> {
  return get<{ scheduled_start: string | null }>("/draft/schedule");
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

export type SeededKeeper = { owner_id: number; player_name: string; sleeper_player_id: string; round: number };
export type UnresolvedKeeper = { owner_id: number; player_name: string; espn_player_id: number };

// Thrown by seedKeepersIntoDraft when POST /draft/seed-keepers 400s with
// a structured unresolved list (see app/routers/draft.py) — a plain
// Error would lose that list, and the commissioner needs to see exactly
// which owner/player couldn't be matched, not just "seeding failed".
export class SeedKeepersError extends Error {
  unresolved: UnresolvedKeeper[];
  constructor(message: string, unresolved: UnresolvedKeeper[]) {
    super(message);
    this.unresolved = unresolved;
  }
}

// Batch-resolves every LOCKED keeper selection into a real draft pick
// (the last round) — see app/domain/draft_engine.py's
// seed_keepers_from_locked_selections for the full ordering/atomicity
// rules. Call after /draft/setup, before /draft/start.
export async function seedKeepersIntoDraft(): Promise<SeededKeeper[]> {
  const res = await fetch("/api/backend/draft/seed-keepers", { method: "POST" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    if (data?.detail && typeof data.detail === "object" && Array.isArray(data.detail.unresolved)) {
      throw new SeedKeepersError(data.detail.message ?? "Some keepers couldn't be matched", data.detail.unresolved);
    }
    throw new Error(typeof data?.detail === "string" ? data.detail : `Seeding keepers failed (${res.status})`);
  }
  const { seeded } = await res.json();
  return seeded;
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
