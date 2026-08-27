// Player card — backend/app/routers/players.py. Signed-in only, so
// this goes through the same-origin /api/backend proxy (see
// draftApi.ts's own docstring for why: Safari ITP blocks the
// cross-site session cookie on a direct cross-origin fetch).

export type PlayerCardProjection = {
  season_projected_points: number;
  season_avg_projected_points: number;
  percent_owned: number;
  percent_started: number;
  bye_week: number | null;
  next_opponent: string | null;
  current_week: number;
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
};

export async function getPlayerCard(sleeperPlayerId: string): Promise<PlayerCard> {
  const res = await fetch(`/api/backend/players/${encodeURIComponent(sleeperPlayerId)}/card`, { cache: "no-store" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `GET player card failed: ${res.status}`);
  }
  return res.json();
}
