// Player card — backend/app/routers/players.py. Signed-in only, so
// this goes through the same-origin /api/backend proxy (see
// draftApi.ts's own docstring for why: Safari ITP blocks the
// cross-site session cookie on a direct cross-origin fetch).

import { API_BASE_URL } from "@/lib/api";

export type PlayerCardProjection = {
  espn_player_id: number;
  season_projected_points: number;
  season_avg_projected_points: number;
  percent_owned: number;
  percent_started: number;
  bye_week: number | null;
  next_opponent: string | null;
  current_week: number;
};

// This app's own real computed score (app/domain/weekly_stats.py) for
// the most recent week the scoring engine has actually run — null
// until Phase D/F's weekly compute has run for a real week (nothing to
// show pre-season).
export type PlayerCardLatestWeek = {
  week: number;
  fantasy_points: number;
};

export type PlayerCardNewsItem = {
  headline: string | null;
  description: string | null;
  published: string | null;
  link: string | null;
};

export type PlayerCardNote = {
  headline: string | null;
  story: string | null;
  published: string | null;
};

// ESPN's public athlete-overview data (backend/app/providers/espn/
// player_overview.py) — real recent news, a RotoWire beat-writer note,
// real draft/position rank (the ADP-equivalent number), and a prose
// season outlook.
export type PlayerCardOverview = {
  news: PlayerCardNewsItem[];
  latest_note: PlayerCardNote | null;
  draft_rank: number | null;
  position_rank: number | null;
  season_outlook: string | null;
};

export type PlayerCard = {
  sleeper_player_id: string;
  espn_player_id: number | null;
  full_name: string;
  position: string;
  pro_team: string | null;
  status: string | null;
  injury_status: string | null;
  age: number | null;
  height: string | null;
  weight: string | null;
  jersey_number: string | null;
  years_exp: number | null;
  headshot_url: string | null;
  projection: PlayerCardProjection | null;
  overview: PlayerCardOverview | null;
  latest_week: PlayerCardLatestWeek | null;
  // 2026-09-18 addition: who currently rosters this player this
  // season, if anyone — real ESPN reference puts Drop/Trade Offers
  // right on the player card (tap a name, act on it from there), and
  // both only make sense with this context. Null/false for a free
  // agent (every existing caller — draft pool, free agents, player
  // research — that has no real season/league context yet).
  rostered_team_id: number | null;
  rostered_team_name: string | null;
  is_on_my_team: boolean;
};

export async function getPlayerCard(sleeperPlayerId: string): Promise<PlayerCard> {
  const res = await fetch(`/api/backend/players/${encodeURIComponent(sleeperPlayerId)}/card`, { cache: "no-store" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `GET player card failed: ${res.status}`);
  }
  return res.json();
}

// One row of GET /players (list) — deliberately thin (search_rank
// doubles as the relevance sort, not exposed as its own column) since
// this feeds a browsable list, not the full per-player detail
// PlayerCard above already covers once you click through.
export type PlayerListEntry = {
  sleeper_player_id: string;
  full_name: string;
  position: string;
  pro_team: string | null;
  injury_status: string | null;
  is_rostered: boolean;
};

// Every real, draftable NFL player — rostered or not — sorted by real
// fantasy relevance (search_rank). Added 2026-09-01 alongside
// app/(app)/player-research/page.tsx: PlayerCard/PlayerCardModal above
// already had rich per-player data, just no page to browse, search, or
// sort across the whole pool (a gap against ESPN/Yahoo/Sleeper's own
// player-research pages, 2026-08-31 audit).
//
// Two call shapes, same split as lib/api.ts's getMyFreeAgents: pass
// sessionCookie for a server-rendered fetch straight at the backend
// (page.tsx's initial render — no browser involved, so Safari ITP
// never applies); omit it for a client-side call, which goes through
// the same-origin /api/backend proxy this file's other functions
// already use, for the exact same ITP reason.
export async function listPlayers(
  opts: { position?: string; search?: string; sessionCookie?: string } = {}
): Promise<PlayerListEntry[]> {
  const params = new URLSearchParams();
  if (opts.position) params.set("position", opts.position);
  if (opts.search) params.set("search", opts.search);
  const qs = params.toString() ? `?${params.toString()}` : "";

  const url = opts.sessionCookie ? `${API_BASE_URL}/players${qs}` : `/api/backend/players${qs}`;
  const res = await fetch(url, {
    headers: opts.sessionCookie ? { cookie: `session=${opts.sessionCookie}` } : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `GET /players failed: ${res.status}`);
  }
  const { players } = await res.json();
  return players;
}
