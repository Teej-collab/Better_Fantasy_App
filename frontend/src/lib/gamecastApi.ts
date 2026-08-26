// Live NFL Gamecast — types + fetchers for the normalized game-state
// contract the backend (app/gamecast/*) serves. Mirrors this file's
// sibling api.ts conventions exactly: plain get<T>() against
// API_BASE_URL for public reads, a same-origin ticket mint (via the
// existing generic /auth/ticket route — see getChatWsTicket in api.ts,
// same pattern, different purpose string) for the WebSocket handshake,
// since that's a cross-site protocol upgrade that can't go through the
// /api/backend proxy any more than chat's can.
import { API_BASE_URL } from "@/lib/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status}`);
  }
  return res.json();
}

export type GamecastStatus = "scheduled" | "in_progress" | "halftime" | "final" | "postponed" | "canceled";

export type GamecastTeamScore = { abbr: string; name: string; score: number };

export type GamecastPlayerRef = {
  name: string;
  team_abbr: string;
  role: string;
  provider_player_id?: string | null;
};

export type GamecastPlay = {
  play_id: string;
  drive_id: string | null;
  period: number;
  clock: string;
  down: number | null;
  distance: number | null;
  description: string;
  play_type: string;
  yards_gained: number | null;
  is_scoring_play: boolean;
  is_turnover: boolean;
  is_first_down: boolean;
  event_type: string | null;
  players_involved: GamecastPlayerRef[];
  timestamp: string;
};

export type GamecastDrive = {
  drive_id: string;
  team_abbr: string;
  play_count: number;
  yards: number;
  duration: string;
  start_yard_line: number;
  result: string | null;
  plays: GamecastPlay[];
};

export type GamecastScoringPlay = {
  play_id: string;
  period: number;
  clock: string;
  team_abbr: string;
  score_type: string;
  description: string;
  home_score_after: number;
  away_score_after: number;
};

export type LiveGame = {
  game_id: string;
  provider: string;
  status: GamecastStatus;
  season: number;
  week: number;
  scheduled_start: string;
  home_team: GamecastTeamScore;
  away_team: GamecastTeamScore;
  period: number | null;
  period_label: string | null;
  clock: string | null;
  possession_team_abbr: string | null;
  down: number | null;
  distance: number | null;
  // 0-100: how far the possessing team must travel to score. Deliberately
  // one normalized number instead of the two-sided "TEAM XX" broadcast
  // convention — trivial to position the field visualization from
  // directly. field_position_label carries the human-readable form.
  yards_to_goal: number | null;
  field_position_label: string | null;
  is_redzone: boolean;
  current_drive: GamecastDrive | null;
  drives: GamecastDrive[];
  plays: GamecastPlay[];
  scoring_plays: GamecastScoringPlay[];
  last_updated: string;
};

export type GamecastLiveGameSummary = {
  game_id: string;
  status: GamecastStatus;
  home_team: GamecastTeamScore;
  away_team: GamecastTeamScore;
  period: number | null;
  period_label: string | null;
  clock: string | null;
};

// Never lets a Gamecast-discovery failure break the page it's called
// from (the ticker, most importantly) — an empty list just means no
// Gamecast links show up, not a crash.
export async function getLiveGames(): Promise<GamecastLiveGameSummary[]> {
  try {
    const { games } = await get<{ games: GamecastLiveGameSummary[] }>("/nfl/live-games");
    return games;
  } catch {
    return [];
  }
}

export async function getGameState(gameId: string): Promise<LiveGame | null> {
  try {
    return await get<LiveGame>(`/nfl/games/${encodeURIComponent(gameId)}`);
  } catch {
    return null;
  }
}

// Same same-origin ticket-mint pattern as getChatWsTicket (lib/api.ts)
// — /auth/ticket/route.ts already forwards an arbitrary `purpose` to
// the backend, so no new Next.js route was needed for this. Purpose
// must be exactly "ws" — the backend's TICKET_PURPOSES only allows
// "ws"/"chug_upload" and every WS route (chat/gamecast/draft) decodes
// expecting the literal purpose "ws", not a per-feature string. This
// was "gamecast_ws" before, which the backend always rejected with a
// 400 — silently breaking Gamecast's WS ticket mint for everyone and
// forcing the REST-polling fallback below on every real page load.
export async function getGamecastWsTicket(): Promise<string | null> {
  const res = await fetch("/auth/ticket?purpose=ws", { method: "POST" });
  if (!res.ok) return null;
  const { ticket } = await res.json();
  return ticket ?? null;
}

export function getGamecastWebSocketUrl(ticket: string, gameId: string): string {
  return `${API_BASE_URL.replace(/^http/, "ws")}/nfl/gamecast/ws?ticket=${encodeURIComponent(ticket)}&game_id=${encodeURIComponent(gameId)}`;
}

// The NFL scoreboard ticker (buildNflTickerItems, lib/api.ts) and
// Gamecast's own live-games list come from two different providers
// with two different id spaces (ESPN's public scoreboard vs. whatever
// Gamecast's provider issues), so there's no shared game_id to join
// on — team-abbreviation pairs are the only thing both sides agree on,
// and two simultaneous real NFL games never share the same pairing.
export function findGamecastId(
  homeAbbr: string | null | undefined,
  awayAbbr: string | null | undefined,
  liveGames: GamecastLiveGameSummary[]
): string | null {
  if (!homeAbbr || !awayAbbr) return null;
  const match = liveGames.find((g) => g.home_team.abbr === homeAbbr && g.away_team.abbr === awayAbbr);
  return match?.game_id ?? null;
}

// Links an NFL scoreboard ticker item to its Gamecast, when one exists
// for that game — matched by team-abbreviation pair (findGamecastId,
// above). Shared by AppTickerBar.tsx (the persistent site-wide ticker)
// and (home)/page.tsx's own richer ticker, so a game is clickable into
// Gamecast the same way no matter which of the two tickers you're
// looking at. Additive only: an item with no Gamecast match (or a
// non-NFL item, like a rivalry/awards blurb — those never have a `key`
// matching any nflGames[].id) is returned completely unchanged, so a
// Gamecast outage or empty live-games list never breaks either ticker.
export function withGamecastLinks<T extends { key: string; href?: string }>(
  items: T[],
  nflGames: { id: string; home_team: string | null; away_team: string | null }[],
  liveGames: GamecastLiveGameSummary[]
): T[] {
  const byId = new Map(nflGames.map((g) => [g.id, g]));
  return items.map((item) => {
    const nflGame = byId.get(item.key);
    const gamecastId = nflGame ? findGamecastId(nflGame.home_team, nflGame.away_team, liveGames) : null;
    return gamecastId ? { ...item, href: `/gamecast/${gamecastId}` } : item;
  });
}
