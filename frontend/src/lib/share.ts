import { API_BASE_URL } from "@/lib/api";

// Public share links (2026-11-10, the share overhaul): what
// GET /share/{token} returns (backend app/domain/share_cards.py) and
// the client call that makes one.

export type ShareKind = "matchup" | "recap" | "standings" | "power" | "awards" | "champion" | "season_awards" | "chug" | "bet" | "trade" | "wheel" | "invite" | "player";
export type ShareFormat = "post" | "story" | "wide";

export const FORMAT_SIZE: Record<ShareFormat, { width: number; height: number }> = {
  post: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
  wide: { width: 1200, height: 630 },
};

type Side = {
  name: string;
  team_name: string;
  record: string | null;
  score: number;
  projected: number | null;
  win_probability: number | null;
  left_to_play: number;
};

export type MatchupCard = {
  season: number;
  week: number;
  status: "final" | "live" | "upcoming";
  is_playoff: boolean;
  rivalry: string | null;
  home: Side;
  away: Side;
  leader: "home" | "away";
  margin: number;
  stars: { name: string; position: string; pro_team: string | null; points: number; line: string | null; headshot: string | null }[];
  bench_crime: { name: string; bench_player: string; started_player: string; points: number } | null;
};

export type RecapCard = {
  season: number;
  week: number;
  headline: string;
  teaser: string;
  top_score: { name: string; points: number } | null;
  meltdown: { name: string; under: number } | null;
  bench_crime: { name: string; points: number } | null;
  chugs_owed: string[];
};

export type StandingsCard = {
  season: number;
  week: number | null;
  playoff_teams: number | null;
  teams: { seed: number; name: string; team_name: string; record: string; points_for: number }[];
};

export type PowerCard = {
  season: number;
  week: number;
  teams: { rank: number; name: string; team_name: string; record: string | null; movement: number | null; why: string | null }[];
};

export type AwardsCard = {
  season: number;
  week: number;
  awards: { tone: "glory" | "shame"; title: string; name: string; value: string; note: string }[];
};

export type ChampionCard = { season: number; name: string; team_name: string; record: string | null; points_for: number | null; titles: number; final: string | null };

export type SeasonAwardsCard = { season: number; awards: { tone: "glory" | "shame"; title: string; name: string; note: string | null }[] };

export type ChugCard = {
  season: number;
  week: number | null;
  name: string;
  score: number;
  seconds: number | null;
  line: string | null;
  quote: string | null;
  bars: { label: string; value: number; max: number }[];
  cheers: number;
  still_owed: number | null;
};

export type BetCard = {
  name: string;
  stake: number | null;
  payout: number | null;
  odds: number | null;
  status: "open" | "won" | "lost" | "push" | "void" | "cashed_out";
  legs: { text: string; status: string | null; headshot: string | null }[];
};

type TradeSide = { name: string; players: { name: string; position: string | null; pro_team: string | null; headshot: string | null }[]; picks: number };
export type TradeCard = { season: number; date: string | null; sides: [TradeSide, TradeSide] };

export type WheelCard = { season: number; text: string; loser: { name: string; record: string } | null; slices: number };

export type InviteCard = {
  invite_code: string;
  commissioner: string;
  members: number;
  team_count: number | null;
  seats_left: number | null;
  chug_rule: boolean;
  league_type: string | null;
};

export type PlayerCard = {
  name: string;
  position: string | null;
  team: string | null;
  points: number | null;
  headshot: string | null;
  game: { away: string | null; home: string | null; away_score: number | null; home_score: number | null; status: string; clock: string | null };
  lines: { title: string; stats: { label: string; value: string }[] }[];
};

export type ShareData =
  | { kind: "matchup"; league_name: string; card: MatchupCard }
  | { kind: "recap"; league_name: string; card: RecapCard }
  | { kind: "standings"; league_name: string; card: StandingsCard }
  | { kind: "power"; league_name: string; card: PowerCard }
  | { kind: "awards"; league_name: string; card: AwardsCard }
  | { kind: "champion"; league_name: string; card: ChampionCard }
  | { kind: "season_awards"; league_name: string; card: SeasonAwardsCard }
  | { kind: "chug"; league_name: string; card: ChugCard }
  | { kind: "bet"; league_name: string; card: BetCard }
  | { kind: "trade"; league_name: string; card: TradeCard }
  | { kind: "wheel"; league_name: string; card: WheelCard }
  | { kind: "invite"; league_name: string; card: InviteCard }
  | { kind: "player"; league_name: string; card: PlayerCard };

/** Server-side: the card behind a share link, or null. Public, no session. */
export async function getShareCard(token: string): Promise<ShareData | null> {
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(token)) return null;
  const res = await fetch(`${API_BASE_URL}/share/${token}`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

export type ShareRef = { kind: ShareKind; matchup_id?: number; season?: number; week?: number; chug_id?: number; bet_id?: number; trade_id?: number; game_id?: string; player_id?: string };

/** Client-side: make (or reuse) the link for something in your league. */
export async function createShareLink(ref: ShareRef): Promise<string> {
  const res = await fetch("/api/backend/share", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ref),
  });
  if (!res.ok) {
    const detail = await res.json().then((b) => b?.detail, () => null);
    throw new Error(typeof detail === "string" ? detail : "Couldn't make a share link.");
  }
  return (await res.json()).token;
}

/** One-line description of a shared card, for link previews and the share text. */
export function shareTitle(data: ShareData): string {
  switch (data.kind) {
    case "matchup": {
      const { home, away, week, status } = data.card;
      const tag = status === "final" ? "Final" : status === "live" ? "Live" : `Week ${week}`;
      return `${home.team_name} ${home.score.toFixed(1)} – ${away.score.toFixed(1)} ${away.team_name} · ${tag}`;
    }
    case "recap":
      return `Week ${data.card.week} Recap · ${data.league_name}`;
    case "standings":
      return `${data.league_name} standings`;
    case "power":
      return `${data.league_name} power rankings · Week ${data.card.week}`;
    case "awards":
      return `${data.league_name} · Week ${data.card.week} awards`;
    case "champion":
      return `${data.card.name} wins ${data.league_name} · ${data.card.season} champion`;
    case "season_awards":
      return `${data.league_name} · ${data.card.season} season awards`;
    case "chug":
      return `${data.card.name}'s chug · ${data.card.score.toFixed(1)}/10`;
    case "bet": {
      const n = data.card.legs.length;
      return `${data.card.name}'s ${n > 1 ? `${n}-leg parlay` : "bet"}`;
    }
    case "trade":
      return `Trade: ${data.card.sides[0].name} and ${data.card.sides[1].name} · ${data.league_name}`;
    case "wheel":
      return `The ${data.card.season} punishment wheel has spoken · ${data.league_name}`;
    case "invite":
      return `You're invited to ${data.league_name}`;
    case "player":
      return `${data.card.name}${data.card.points !== null ? ` · ${data.card.points.toFixed(1)} pts` : ""}`;
  }
}
