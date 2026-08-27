// Player card — backend/app/routers/players.py. Signed-in only, so
// this goes through the same-origin /api/backend proxy (see
// draftApi.ts's own docstring for why: Safari ITP blocks the
// cross-site session cookie on a direct cross-origin fetch).

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
};

export async function getPlayerCard(sleeperPlayerId: string): Promise<PlayerCard> {
  const res = await fetch(`/api/backend/players/${encodeURIComponent(sleeperPlayerId)}/card`, { cache: "no-store" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `GET player card failed: ${res.status}`);
  }
  return res.json();
}
