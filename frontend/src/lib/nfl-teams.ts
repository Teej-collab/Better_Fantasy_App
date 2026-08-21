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

export function playerHeadshotUrl(playerId: number | null | undefined): string | null {
  if (!playerId) return null;
  return `https://a.espncdn.com/i/headshots/nfl/players/full/${playerId}.png`;
}

export function teamLogoUrl(proTeam: string | null | undefined): string | null {
  if (!proTeam || !(proTeam in NFL_TEAM_NAMES)) return null;
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${proTeam.toLowerCase()}.png`;
}
