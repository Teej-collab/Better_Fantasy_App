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
