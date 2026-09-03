// Propose/accept/reject/cancel a trade, plus the commissioner review
// and trade-settings endpoints — see backend/app/routers/trades.py.
// Same same-origin /api/backend proxy + typed-wrapper shape as
// leaguesApi.ts (get/post/put helpers throwing on non-OK).

export type TradeAsset = {
  sleeper_player_id: string;
  player_name: string;
  position: string;
  from_team_id: number;
  to_team_id: number;
};

export type TradeStatus = "pending" | "awaiting_review" | "accepted" | "rejected" | "cancelled" | "vetoed";

export type Trade = {
  id: number;
  league_id: number;
  season: number;
  proposing_team_id: number;
  receiving_team_id: number;
  status: TradeStatus;
  proposed_at: string;
  resolved_at: string | null;
  assets: TradeAsset[];
};

export type TradeTeam = { team_id: number; team_name: string; owner_id: number; owner_name: string };

export type TradeRosterPlayer = { sleeper_player_id: string; player_name: string; position: string };

export type TradeSettings = { season: number; trade_deadline: string | null; review_required: boolean };

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

export async function getLeagueTeamsForTrades(): Promise<TradeTeam[]> {
  const { teams } = await get<{ teams: TradeTeam[] }>("/trades/teams");
  return teams;
}

export async function getTeamRosterForTrade(teamId: number): Promise<TradeRosterPlayer[]> {
  const { roster } = await get<{ roster: TradeRosterPlayer[] }>(`/trades/teams/${teamId}/roster`);
  return roster;
}

export async function getMyTrades(): Promise<Trade[]> {
  const { trades } = await get<{ trades: Trade[] }>("/trades/mine");
  return trades;
}

export async function getPendingTradesForReview(): Promise<Trade[]> {
  const { trades } = await get<{ trades: Trade[] }>("/trades/pending");
  return trades;
}

export async function proposeTrade(receivingTeamId: number, give: string[], receive: string[]): Promise<Trade> {
  return post<Trade>("/trades", { receiving_team_id: receivingTeamId, give, receive });
}

export async function acceptTrade(tradeId: number): Promise<Trade> {
  return post<Trade>(`/trades/${tradeId}/accept`, {});
}

export async function rejectTrade(tradeId: number): Promise<Trade> {
  return post<Trade>(`/trades/${tradeId}/reject`, {});
}

export async function cancelTrade(tradeId: number): Promise<Trade> {
  return post<Trade>(`/trades/${tradeId}/cancel`, {});
}

export async function reviewTrade(tradeId: number, approve: boolean): Promise<Trade> {
  return post<Trade>(`/trades/${tradeId}/review`, { approve });
}

export async function getTradeSettings(): Promise<TradeSettings> {
  return get<TradeSettings>("/trades/settings");
}

export async function updateTradeSettings(
  season: number,
  tradeDeadline: string | null,
  reviewRequired: boolean
): Promise<TradeSettings> {
  return put<TradeSettings>("/trades/settings", {
    season,
    trade_deadline: tradeDeadline,
    review_required: reviewRequired,
  });
}
