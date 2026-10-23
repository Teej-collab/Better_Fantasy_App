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

export type TradeStatus =
  | "pending"
  | "awaiting_review"
  | "in_review"
  | "accepted"
  | "rejected"
  | "cancelled"
  | "vetoed"
  | "expired"
  | "failed";

// How an accepted trade is reviewed (Commissioner Tools > Trades):
// none — goes through on accept; commissioner — a review period the
// commissioner can veto during; league_vote — the same, and the other
// teams can vote to veto; approval — waits for the commissioner.
export type TradeReviewMode = "none" | "commissioner" | "league_vote" | "approval";

export type Trade = {
  id: number;
  league_id: number;
  season: number;
  proposing_team_id: number;
  receiving_team_id: number;
  status: TradeStatus;
  proposed_at: string;
  resolved_at: string | null;
  accepted_at?: string | null;
  // in_review only: when it processes if nobody vetoes it.
  review_ends_at?: string | null;
  // pending only: when the offer lapses.
  expires_at?: string | null;
  note?: string | null;
  proposing_team_name?: string | null;
  receiving_team_name?: string | null;
  veto_votes?: number;
  // /trades/league only: whether the viewer has voted to veto it.
  my_veto_vote?: boolean;
  assets: TradeAsset[];
  // Who each side cuts to make room when it goes through (2026-10-23).
  drops?: { team_id: number; sleeper_player_id: string; player_name: string; position: string | null }[];
  // Points a week gained by the viewer's side, or for a trade between
  // two other teams, which side it leans to (backend trade_values.py).
  value?: TradeValueSummary | null;
};

export type TradeValueSummary = { value_change: number; verdict: "you" | "them" | "even" | "leans"; leans_team_id: number | null };

// Trades overhaul (2026-10-23): the builder's and an offer's live read.
export type TradeValuePlayer = { id: string; name: string; position: string | null; per_week: number };
export type TradeEvaluation = {
  week: number;
  give: TradeValuePlayer[];
  receive: TradeValuePlayer[];
  value_change: number;
  verdict: "you" | "them" | "even";
  my_lineup: {
    before: number;
    after: number;
    change: number;
    slots: { slot: string; before: string | null; after: string | null; delta: number }[];
  };
  their_lineup_change: number;
  my_drops_needed: number;
  their_drops_needed: number;
  suggestion: { side: "give" | "receive"; player: TradeValuePlayer } | null;
  drop_candidates: TradeValuePlayer[];
};

export type TradeBlockPlayer = {
  team_id: number;
  team_name: string;
  sleeper_player_id: string;
  player_name: string;
  position: string;
  pro_team: string | null;
  per_week: number;
  created_at: string;
};

export type TradeTeam = { team_id: number; team_name: string; owner_id: number; owner_name: string };

export type TradeRosterPlayer = {
  sleeper_player_id: string;
  player_name: string;
  position: string;
  per_week?: number;
  pro_team?: string | null;
  injury_status?: string | null;
  on_block?: boolean;
};

export type TradeSettings = {
  season: number;
  trade_deadline: string | null;
  review_required: boolean;
  review_mode: TradeReviewMode;
  review_hours: number;
  // null = the default, a third of the league rounded up (effective_…).
  veto_votes_needed: number | null;
  effective_veto_votes_needed: number;
};

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

export async function getLeagueTrades(): Promise<{ trades: Trade[]; settings: TradeSettings }> {
  return get<{ trades: Trade[]; settings: TradeSettings }>("/trades/league");
}

export async function proposeTrade(
  receivingTeamId: number,
  give: string[],
  receive: string[],
  note?: string,
  extra?: { drops?: string[]; counterOf?: number | null }
): Promise<Trade> {
  return post<Trade>("/trades", {
    receiving_team_id: receivingTeamId,
    give,
    receive,
    note: note || null,
    drops: extra?.drops ?? [],
    counter_of: extra?.counterOf ?? null,
  });
}

export async function evaluateTrade(partnerTeamId: number, give: string[], receive: string[], drops: string[]): Promise<TradeEvaluation> {
  return post<TradeEvaluation>("/trades/evaluate", { partner_team_id: partnerTeamId, give, receive, drops });
}

export async function getTradeEvaluation(tradeId: number): Promise<TradeEvaluation> {
  return get<TradeEvaluation>(`/trades/${tradeId}/evaluation`);
}

export async function getTradeBlock(): Promise<TradeBlockPlayer[]> {
  const { players } = await get<{ players: TradeBlockPlayer[] }>("/trades/block");
  return players;
}

export async function addToTradeBlock(sleeperPlayerId: string): Promise<void> {
  await post("/trades/block", { sleeper_player_id: sleeperPlayerId });
}

export async function removeFromTradeBlock(sleeperPlayerId: string): Promise<void> {
  const res = await fetch(`/api/backend/trades/block/${encodeURIComponent(sleeperPlayerId)}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Couldn't take that player off the block.");
}

export async function voteToVeto(tradeId: number, voting: boolean): Promise<Trade> {
  if (voting) return post<Trade>(`/trades/${tradeId}/veto-vote`, {});
  const res = await fetch(`/api/backend/trades/${tradeId}/veto-vote`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `Couldn't remove your vote: ${res.status}`);
  }
  return res.json();
}

export async function acceptTrade(tradeId: number, drops: string[] = []): Promise<Trade> {
  return post<Trade>(`/trades/${tradeId}/accept`, { drops });
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
  review: { mode: TradeReviewMode; hours: number; vetoVotesNeeded: number | null }
): Promise<TradeSettings> {
  return put<TradeSettings>("/trades/settings", {
    season,
    trade_deadline: tradeDeadline,
    review_required: review.mode === "approval",
    review_mode: review.mode,
    review_hours: review.hours,
    veto_votes_needed: review.vetoVotesNeeded,
  });
}
