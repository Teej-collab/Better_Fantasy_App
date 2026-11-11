import { API_BASE_URL } from "@/lib/api";

// Public share links (2026-11-10, the share overhaul): what
// GET /share/{token} returns (backend app/domain/share_cards.py) and
// the client call that makes one.

export type ShareKind = "matchup" | "recap" | "standings" | "power" | "awards";
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

export type ShareData =
  | { kind: "matchup"; league_name: string; card: MatchupCard }
  | { kind: "recap"; league_name: string; card: RecapCard }
  | { kind: "standings"; league_name: string; card: StandingsCard }
  | { kind: "power"; league_name: string; card: PowerCard }
  | { kind: "awards"; league_name: string; card: AwardsCard };

/** Server-side: the card behind a share link, or null. Public, no session. */
export async function getShareCard(token: string): Promise<ShareData | null> {
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(token)) return null;
  const res = await fetch(`${API_BASE_URL}/share/${token}`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

export type ShareRef = { kind: ShareKind; matchup_id?: number; season?: number; week?: number };

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
  }
}
