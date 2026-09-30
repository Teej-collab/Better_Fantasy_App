// NFL team colors, copied from frontend/src/lib/nfl-teams.ts — the ticker
// colors each team abbreviation with these.
export const NFL_TEAM_COLORS: Record<string, string> = {
  ARI: '#97233F',
  ATL: '#A71930',
  BAL: '#9E7C0C',
  BUF: '#00338D',
  CAR: '#0085CA',
  CHI: '#C83803',
  CIN: '#FB4F14',
  CLE: '#FF3C00',
  DAL: '#869397',
  DEN: '#FA4616',
  DET: '#0076B6',
  GB: '#203731',
  HOU: '#A71930',
  IND: '#002C5F',
  JAX: '#006778',
  KC: '#E31837',
  LAC: '#0080C6',
  LAR: '#003594',
  LV: '#A5ACAF',
  MIA: '#008E97',
  MIN: '#4F2683',
  NE: '#C60C30',
  NO: '#D3BC8D',
  NYG: '#0B2265',
  NYJ: '#125740',
  PHI: '#004C54',
  PIT: '#FFB612',
  SEA: '#69BE28',
  SF: '#AA0000',
  TB: '#D50A0A',
  TEN: '#4B92DB',
  WSH: '#5A1414',
};

export function nflTeamColor(abbr: string | null | undefined): string | null {
  return abbr ? (NFL_TEAM_COLORS[abbr] ?? null) : null;
}

export const NFL_TEAM_NAMES: Record<string, string> = {
  ARI: 'Arizona Cardinals',
  ATL: 'Atlanta Falcons',
  BAL: 'Baltimore Ravens',
  BUF: 'Buffalo Bills',
  CAR: 'Carolina Panthers',
  CHI: 'Chicago Bears',
  CIN: 'Cincinnati Bengals',
  CLE: 'Cleveland Browns',
  DAL: 'Dallas Cowboys',
  DEN: 'Denver Broncos',
  DET: 'Detroit Lions',
  GB: 'Green Bay Packers',
  HOU: 'Houston Texans',
  IND: 'Indianapolis Colts',
  JAX: 'Jacksonville Jaguars',
  KC: 'Kansas City Chiefs',
  LAC: 'Los Angeles Chargers',
  LAR: 'Los Angeles Rams',
  LV: 'Las Vegas Raiders',
  MIA: 'Miami Dolphins',
  MIN: 'Minnesota Vikings',
  NE: 'New England Patriots',
  NO: 'New Orleans Saints',
  NYG: 'New York Giants',
  NYJ: 'New York Jets',
  PHI: 'Philadelphia Eagles',
  PIT: 'Pittsburgh Steelers',
  SEA: 'Seattle Seahawks',
  SF: 'San Francisco 49ers',
  TB: 'Tampa Bay Buccaneers',
  TEN: 'Tennessee Titans',
  WSH: 'Washington Commanders',
};

export function nflTeamName(abbr: string | null | undefined): string | null {
  return abbr ? (NFL_TEAM_NAMES[abbr] ?? abbr) : null;
}

// Same CDNs as the web (frontend/src/lib/nfl-teams.ts).
export function teamLogoUrl(abbr: string | null | undefined): string | null {
  if (!abbr || !(abbr in NFL_TEAM_NAMES)) return null;
  return `https://a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/500/${abbr.toLowerCase()}.png&w=160&h=160`;
}

export function sleeperHeadshotUrl(sleeperPlayerId: string | null | undefined): string | null {
  return sleeperPlayerId ? `https://sleepercdn.com/content/nfl/players/${sleeperPlayerId}.jpg` : null;
}
