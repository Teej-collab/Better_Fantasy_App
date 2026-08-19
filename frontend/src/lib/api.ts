export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status}`);
  }
  return res.json();
}

// For endpoints where "no data" (404) is a normal, expected outcome —
// e.g. an owner with no team in a given season — not an error to throw on.
async function getOrNull<T>(path: string): Promise<T | null> {
  const res = await fetch(`${API_BASE_URL}${path}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status}`);
  }
  return res.json();
}

export type Season = number;

export type Team = {
  team_id: number;
  espn_team_id: number;
  team_name: string;
  owner_id: number;
  owner_name: string;
};

export type StandingsRow = {
  team_id: number;
  team_name: string;
  owner_name: string;
  wins: number;
  losses: number;
  ties: number;
  points_for: string;
  points_against: string;
  // ESPN's own final-season rank (accounts for the full playoff bracket).
  // Null means the season isn't finished yet — rows are then ordered by
  // regular-season record instead. A row with final_rank === 1 is the
  // champion.
  final_rank: number | null;
};

export type WeekMatchup = {
  matchup_id: number;
  is_playoff: boolean;
  home_team_id: number;
  home_team_name: string;
  home_score: string | null;
  away_team_id: number;
  away_team_name: string;
  away_score: string | null;
};

export type RosterPlayer = {
  player_name: string;
  position: string | null;
  lineup_slot: string | null;
  points_scored: string | null;
  points_projected: string | null;
};

export type MatchupDetail = WeekMatchup & {
  season: number;
  week: number;
  home_roster: RosterPlayer[];
  away_roster: RosterPlayer[];
};

export type TeamDetail = {
  team_id: number;
  season: number;
  espn_team_id: number;
  team_name: string;
  owner_id: number;
  owner_name: string;
};

export type TeamRoster = {
  team: TeamDetail;
  week: number;
  roster: RosterPlayer[];
};

export function listSeasons() {
  return get<{ seasons: Season[] }>("/seasons");
}

export function listTeams(season: number) {
  return get<{ teams: Team[] }>(`/seasons/${season}/teams`);
}

export function getStandings(season: number) {
  return get<{ standings: StandingsRow[] }>(`/seasons/${season}/standings`);
}

export function listWeekMatchups(season: number, week: number) {
  return get<{ matchups: WeekMatchup[] }>(`/seasons/${season}/weeks/${week}/matchups`);
}

export function getMatchup(matchupId: number) {
  return get<MatchupDetail>(`/matchups/${matchupId}`);
}

export function getTeamRoster(teamId: number, week: number) {
  return get<TeamRoster>(`/teams/${teamId}/roster?week=${week}`);
}

export type PeriodSummary = {
  record: string;
  pf: number;
  pa: number;
  pfpg: number;
  papg: number;
  game_count: number;
};

export type SeasonProfile = {
  team_name: string;
  regular: PeriodSummary | null;
  playoff: PeriodSummary | null;
  best_week: { week: number; score: number } | null;
  worst_week: { week: number; score: number } | null;
  avg_luck: number | null;
  avg_chaos: number | null;
  current_power_rank: number | null;
  season_awards: { award_type: string; detail: string | null }[];
};

export type Owner = {
  owner_id: number;
  display_name: string;
  latest_team_name: string;
  seasons: number[];
};

export type CareerProfile = {
  team_name: string;
  seasons: number[];
  regular: PeriodSummary | null;
  playoff: PeriodSummary | null;
  best_week: { season: number; week: number; score: number } | null;
  worst_week: { season: number; week: number; score: number } | null;
  best_season: { season: number; record: string; pf: number } | null;
  worst_season: { season: number; record: string; pf: number } | null;
};

export type OwnerBadges = {
  championship_years: number[];
  award_summary: Record<string, number[]>;
};

export type SeasonAward = {
  award_type: string;
  detail: string | null;
  owner_id: number;
  owner_name: string;
};

export type SeasonAwardsResponse = {
  champion: { team_name: string; owner_id: number; owner_name: string } | null;
  awards: SeasonAward[];
};

export type WeeklyAwards = {
  overachiever: { team_id: number; team_name: string; diff: number } | null;
  meltdown: { team_id: number; team_name: string; diff: number } | null;
  biggest_bench_crime:
    | {
        bench_player: string;
        started_player: string;
        position: string;
        points_diff: string;
        severity: string;
        team_name: string;
      }
    | null;
  clutch: { team_name: string; margin: number; reason: string } | null;
  choke: { team_name: string; margin: number; reason: string } | null;
  boom_leaders: { player_name: string; points_scored: string; team_name: string }[];
  bust_leaders: { player_name: string; points_scored: string; team_name: string }[];
  game_of_the_week: { winner: string; score: string } | null;
};

export type Rivalry = {
  id: number;
  name: string | null;
  emoji: string | null;
  tagline: string | null;
  description: string | null;
  tier: string | null;
  all_time_wins_a: number;
  all_time_wins_b: number;
  owner_a_id: number;
  owner_a_name: string;
  owner_b_id: number;
  owner_b_name: string;
};

export function listOwners() {
  return get<{ owners: Owner[] }>("/owners");
}

export function getSeasonProfile(ownerId: number, season: number) {
  return getOrNull<SeasonProfile>(`/owners/${ownerId}/profile?season=${season}`);
}

export function getCareerProfile(ownerId: number) {
  return getOrNull<CareerProfile>(`/owners/${ownerId}/career`);
}

export function getOwnerBadges(ownerId: number) {
  return get<OwnerBadges>(`/owners/${ownerId}/badges`);
}

export function getSeasonAwards(season: number) {
  return get<SeasonAwardsResponse>(`/seasons/${season}/awards`);
}

export function getWeeklyAwards(season: number, week: number) {
  return get<WeeklyAwards>(`/seasons/${season}/weeks/${week}/awards`);
}

export function listRivalries() {
  return get<{ rivalries: Rivalry[] }>("/rivalries");
}
