// Response shapes from the FastAPI backend, copied from the web app's
// frontend/src/lib/api.ts (the most complete record of them) and
// trimmed to the fields these screens read. When a screen needs more,
// copy the field from there rather than guessing.

export type Me = {
  user_id: number;
  owner_id: number | null;
  display_name: string | null;
  is_commissioner: boolean;
  is_site_owner: boolean;
  active_league_id: number | null;
};

export type YourWeekMatchup = {
  matchup_id: number;
  is_playoff: boolean;
  started: boolean;
  record: string | null;
  my_owner_name: string | null;
  my_logo_url: string | null;
  my_result_streak: string | null;
  my_yet_to_play: number;
  my_in_play: number;
  my_score: number | null;
  my_projected_total: number;
  opponent_team_id: number;
  opponent_team_name: string;
  opponent_owner_name: string | null;
  opponent_logo_url: string | null;
  opponent_record: string | null;
  opponent_yet_to_play: number;
  opponent_in_play: number;
  opponent_score: number | null;
  opponent_projected_total: number;
  // Null until the matchup has real scores to work with.
  win_probability: number | null;
};

export type YourWeek = {
  season: number;
  week: number | null;
  team_id: number;
  team_name: string;
  power_rank: number | null;
  matchup: YourWeekMatchup | null;
  draft: { scheduled_start: string | null; status: 'not_started' | 'in_progress' | 'paused' | 'complete' } | null;
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
  final_rank: number | null;
};

export type RosterPlayer = {
  player_name: string;
  position: string | null;
  lineup_slot: string | null;
  points_scored: number | null;
  points_projected: number | null;
  live_projected: number | null;
  player_id: number | string | null;
  pro_team: string | null;
  injury_status: string | null;
  next_opponent: string | null;
  game_status: 'scheduled' | 'in_progress' | 'final' | null;
};

export type MatchupContextSide = {
  team_id: number;
  team_name: string;
  owner_name: string;
  power_rank: number | null;
  logo_url: string | null;
  score: number | null;
  record: string | null;
  result_streak: string | null;
  projected_total: number | null;
  roster: RosterPlayer[];
  win_probability: number | null;
};

export type WeekMatchupContextItem = {
  matchup_id: number;
  season: number;
  week: number;
  is_playoff: boolean;
  is_game_of_the_week: boolean;
  is_rivalry: boolean;
  rivalry: { name: string; emoji: string | null } | null;
  head_to_head: { wins_home: number; wins_away: number; ties: number };
  home: MatchupContextSide;
  away: MatchupContextSide;
};

export type WeekMatchupContext = {
  season: number;
  week: number;
  game_of_the_week_matchup_id: number | null;
  matchups: WeekMatchupContextItem[];
};
