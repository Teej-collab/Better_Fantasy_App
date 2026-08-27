// ESPN's own abbreviation for each real NFL team (matches espn_api's
// PRO_TEAM_MAP, which is what backend/app/providers/espn/adapter.py
// stores verbatim as `pro_team`) mapped to a display name and ESPN's
// public CDN image paths. Both CDN patterns are undocumented but
// stable and already used by ESPN's own fantasy site — verified live
// against real player/team IDs before wiring this up. No API key,
// no extra backend round trip: the image URL is derived entirely from
// data the app already has.
export const NFL_TEAM_NAMES: Record<string, string> = {
  ARI: "Arizona Cardinals",
  ATL: "Atlanta Falcons",
  BAL: "Baltimore Ravens",
  BUF: "Buffalo Bills",
  CAR: "Carolina Panthers",
  CHI: "Chicago Bears",
  CIN: "Cincinnati Bengals",
  CLE: "Cleveland Browns",
  DAL: "Dallas Cowboys",
  DEN: "Denver Broncos",
  DET: "Detroit Lions",
  GB: "Green Bay Packers",
  HOU: "Houston Texans",
  IND: "Indianapolis Colts",
  JAX: "Jacksonville Jaguars",
  KC: "Kansas City Chiefs",
  LAC: "Los Angeles Chargers",
  LAR: "Los Angeles Rams",
  LV: "Las Vegas Raiders",
  MIA: "Miami Dolphins",
  MIN: "Minnesota Vikings",
  NE: "New England Patriots",
  NO: "New Orleans Saints",
  NYG: "New York Giants",
  NYJ: "New York Jets",
  PHI: "Philadelphia Eagles",
  PIT: "Pittsburgh Steelers",
  SEA: "Seattle Seahawks",
  SF: "San Francisco 49ers",
  TB: "Tampa Bay Buccaneers",
  TEN: "Tennessee Titans",
  WSH: "Washington Commanders",
};

export function nflTeamName(proTeam: string | null | undefined): string | null {
  if (!proTeam) return null;
  return NFL_TEAM_NAMES[proTeam] ?? proTeam;
}

// Each team's real primary brand color — used to color team names in
// the NFL scores ticker (LiveTicker.tsx). A handful of teams (BAL, CHI,
// CLE, DAL, HOU, LV, NE, PIT, TEN) have their primary listed here as
// their bright secondary instead: their true primary is black or a
// near-black navy/brown, which would be functionally invisible against
// the ticker's own black background — the secondary is still a real,
// recognizable part of that team's identity (Steelers gold, Raiders
// silver, etc.), just legible where the true primary wouldn't be.
export const NFL_TEAM_COLORS: Record<string, string> = {
  ARI: "#97233F",
  ATL: "#A71930",
  BAL: "#9E7C0C",
  BUF: "#00338D",
  CAR: "#0085CA",
  CHI: "#C83803",
  CIN: "#FB4F14",
  CLE: "#FF3C00",
  DAL: "#869397",
  DEN: "#FA4616",
  DET: "#0076B6",
  GB: "#203731",
  HOU: "#A71930",
  IND: "#002C5F",
  JAX: "#006778",
  KC: "#E31837",
  LAC: "#0080C6",
  LAR: "#003594",
  LV: "#A5ACAF",
  MIA: "#008E97",
  MIN: "#4F2683",
  NE: "#C60C30",
  NO: "#D3BC8D",
  NYG: "#0B2265",
  NYJ: "#125740",
  PHI: "#004C54",
  PIT: "#FFB612",
  SEA: "#69BE28",
  SF: "#AA0000",
  TB: "#D50A0A",
  TEN: "#4B92DB",
  WSH: "#5A1414",
};

export function nflTeamColor(proTeam: string | null | undefined): string | null {
  if (!proTeam) return null;
  return NFL_TEAM_COLORS[proTeam] ?? null;
}

export function playerHeadshotUrl(playerId: number | null | undefined): string | null {
  if (!playerId) return null;
  return `https://a.espncdn.com/i/headshots/nfl/players/full/${playerId}.png`;
}

// Sleeper's own free, keyless headshot CDN — same URL pattern the
// backend's player-card feature already builds
// (backend/app/domain/player_card.py's SLEEPER_HEADSHOT_URL), keyed by
// sleeper_player_id rather than ESPN's numeric id. For contexts (Free
// Agents, current_rosters-backed pages) that only ever have a Sleeper
// id, never an ESPN one. DEF entries have no real photo on Sleeper's
// CDN — left to PlayerHeadshot's existing onError fallback to catch,
// same as any other broken headshot URL, rather than special-cased
// here.
export function sleeperHeadshotUrl(sleeperPlayerId: string | null | undefined): string | null {
  if (!sleeperPlayerId) return null;
  return `https://sleepercdn.com/content/nfl/players/${sleeperPlayerId}.jpg`;
}

export function teamLogoUrl(proTeam: string | null | undefined): string | null {
  if (!proTeam || !(proTeam in NFL_TEAM_NAMES)) return null;
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${proTeam.toLowerCase()}.png`;
}
