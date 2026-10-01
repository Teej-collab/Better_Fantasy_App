// Bet tracking (backend app/routers/bets.py) — tracking only, nothing
// here places a bet. Every call goes through the same-origin
// /api/backend proxy, which forwards the session cookie; a user's bets
// are private to them unless they share one to league chat.

export type BetLegStatus = "open" | "won" | "lost" | "push" | "void";
export type BetStatus = BetLegStatus | "cashed_out";
export type BetMarket = "player_prop" | "moneyline" | "spread" | "total" | "other";
export type BetDirection = "over" | "under" | "yes" | "no";

export type BetLeg = {
  id: number;
  description: string;
  market: BetMarket;
  player_name: string | null;
  sleeper_player_id: string | null;
  team_abbr: string | null;
  stat_key: string | null;
  stat_label: string | null;
  line: number | null;
  direction: BetDirection | null;
  odds_american: number | null;
  espn_event_id: string | null;
  game: {
    state: "pre" | "in" | "post" | null;
    home_team: string | null;
    away_team: string | null;
    home_score: number | null;
    away_score: number | null;
  } | null;
  status: BetLegStatus;
  current: number | null;
  target: number | null;
  // False for legs the app can't grade (market "other", or no game found).
  tracked: boolean;
};

export type Bet = {
  id: number;
  owner_name: string;
  sportsbook: string | null;
  // Only on your own bets — a shared bet never shows its money.
  stake?: number | null;
  payout?: number | null;
  note?: string | null;
  status_set_manually?: boolean;
  odds_american: number | null;
  status: BetStatus;
  shared: boolean;
  created_at: string;
  legs: BetLeg[];
};

export type DraftLeg = {
  description: string;
  market: BetMarket;
  player_name: string | null;
  team_abbr: string | null;
  stat_key: string | null;
  line: number | null;
  direction: BetDirection | null;
  odds_american: number | null;
  matched?: boolean;
};

export type DraftBet = {
  sportsbook: string | null;
  stake: number | null;
  odds_american: number | null;
  payout: number | null;
  legs: DraftLeg[];
};

// Same keys as backend app/domain/bets.py's STAT_KEYS.
export const BET_STATS: { key: string; label: string }[] = [
  { key: "pass_yd", label: "Passing yards" },
  { key: "pass_td", label: "Passing TDs" },
  { key: "pass_int", label: "Interceptions thrown" },
  { key: "pass_cmp", label: "Completions" },
  { key: "pass_att", label: "Pass attempts" },
  { key: "rush_yd", label: "Rushing yards" },
  { key: "rush_att", label: "Rush attempts" },
  { key: "rec", label: "Receptions" },
  { key: "rec_yd", label: "Receiving yards" },
  { key: "rush_rec_yd", label: "Rush + rec yards" },
  { key: "pass_rush_yd", label: "Pass + rush yards" },
  { key: "anytime_td", label: "Touchdowns" },
  { key: "long_rush", label: "Longest rush" },
  { key: "long_rec", label: "Longest reception" },
  { key: "sacks", label: "Sacks" },
  { key: "tackles", label: "Tackles" },
  { key: "kick_pts", label: "Kicking points" },
  { key: "fg_made", label: "Field goals made" },
];

export class BetsError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/backend/bets${path}`, {
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new BetsError(res.status, data?.detail ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export const listBets = () => call<{ enabled: boolean; bets: Bet[] }>("");
export const betsInGame = (eventId: string) => call<{ enabled: boolean; bets: Bet[] }>(`/games/${encodeURIComponent(eventId)}`);
export const sharedBet = (betId: number) => call<Bet>(`/shared/${betId}`);
export const parseSlip = (imageBase64: string, mediaType: string) =>
  call<DraftBet>("/parse-slip", { method: "POST", body: JSON.stringify({ image_base64: imageBase64, media_type: mediaType }) });
export const createBet = (bet: DraftBet & { source: "screenshot" | "manual"; note?: string | null }) =>
  call<Bet>("", { method: "POST", body: JSON.stringify(bet) });
export const setBetStatus = (betId: number, status: BetStatus | "auto") =>
  call<Bet>(`/${betId}`, { method: "PATCH", body: JSON.stringify({ status }) });
export const setLegStatus = (betId: number, legId: number, status: BetLegStatus) =>
  call<Bet>(`/${betId}/legs/${legId}`, { method: "PATCH", body: JSON.stringify({ status }) });
export const deleteBet = (betId: number) => call<{ deleted: boolean }>(`/${betId}`, { method: "DELETE" });
export const shareBet = (betId: number) =>
  call<{ shared: boolean; posted: boolean; conversation_id?: number }>(`/${betId}/share`, { method: "POST" });
export const unshareBet = (betId: number) => call<{ shared: boolean }>(`/${betId}/share`, { method: "DELETE" });

export function formatOdds(odds: number | null | undefined): string {
  if (odds === null || odds === undefined) return "";
  return odds > 0 ? `+${odds}` : String(odds);
}

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

// "Over 79.5 Rushing yards", "Anytime TD", "DET -3.5"...
export function legPick(leg: Pick<BetLeg, "market" | "stat_key" | "stat_label" | "line" | "direction" | "team_abbr" | "description">): string {
  if (leg.market === "player_prop") {
    if (leg.stat_key === "anytime_td") {
      const n = leg.line && leg.line >= 2 ? `${leg.line}+ TDs` : "Anytime TD";
      return leg.direction === "no" ? `No ${n}` : n;
    }
    const dir = leg.direction === "under" ? "Under" : "Over";
    return `${dir} ${leg.line ?? "?"} ${leg.stat_label ?? leg.stat_key ?? ""}`.trim();
  }
  if (leg.market === "spread") return `${leg.team_abbr ?? "?"} ${leg.line !== null && leg.line > 0 ? "+" : ""}${leg.line ?? ""}`;
  if (leg.market === "moneyline") return `${leg.team_abbr ?? "?"} to win`;
  if (leg.market === "total") return `${leg.direction === "under" ? "Under" : "Over"} ${leg.line ?? "?"} total points`;
  return leg.description;
}

// Shrinks a screenshot to a JPEG small enough to send (long edge ≤ 1800px)
// and returns its base64 — slips are tall, so keep enough height to read.
export async function imageFileToBase64(file: File): Promise<{ base64: string; mediaType: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { base64: dataUrl.slice(dataUrl.indexOf(",") + 1), mediaType: "image/jpeg" };
}
