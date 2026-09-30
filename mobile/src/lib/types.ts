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

// GET /me/team's roster rows (frontend/src/lib/api.ts's RosterEntry).
// player_id is the Sleeper player id the lineup endpoints take.
export type RosterEntry = {
  player_id: string;
  player_name: string;
  lineup_slot: string;
  position: string;
  pro_team: string | null;
  injury_status: string | null;
  points: number | null;
  points_projected: number | null;
  live_projected?: number | null;
  next_opponent: string | null;
  game_time: string | null;
  bye_week: number | null;
  // Their NFL game has started, so the backend rejects moving them.
  is_locked: boolean;
};

export type MyTeam = {
  team_name: string;
  season: number;
  week: number | null;
  current_week: number | null;
  // False when viewing any week but the live one.
  is_editable: boolean;
  roster: RosterEntry[];
  // Per-slot capacity, e.g. { RB: 2, WR: 2 }. Null pre-draft.
  roster_slots: Record<string, number> | null;
};

// Chat (backend/app/routers/chat.py; web types in frontend/src/lib/api.ts).
export type ChatReaction = { emoji: string; count: number; reacted_by_me: boolean; reactor_names: string[] };

export type ChatMessage = {
  id: number;
  conversation_id: number;
  owner_id: number;
  owner_name: string;
  owner_chat_color: string | null;
  owner_logo_url: string | null;
  body: string;
  image_url: string | null;
  // Commish Corner announcements only.
  title: string | null;
  deleted: boolean;
  created_at: string;
  reply_to: { id: number; owner_name: string; body: string } | null;
  mentions: number[];
  reactions: ChatReaction[];
};

export type ChatConversation = {
  id: number;
  type: 'league' | 'direct' | 'commish_corner';
  member_count: number;
  other_owner_id: number | null;
  other_owner_name: string | null;
  other_owner_logo_url: string | null;
  unread_count: number;
  last_message: { id: number; owner_name: string; body: string; created_at: string } | null;
  // False for everyone but the commissioner in Commish Corner.
  can_post: boolean;
};

// GET /me/team/free-agents (frontend/src/lib/api.ts's MyFreeAgent).
export type FreeAgent = {
  sleeper_player_id: string;
  full_name: string;
  position: string;
  pro_team: string | null;
  injury_status: string | null;
  // This week's projection when harvested, else the season per-game average.
  projected_points: number | null;
  score: number | null;
  last_week_score: number | null;
  next_opponent: string | null;
  game_time: string | null;
  // Set while the player is on waivers: add returns on_waivers, so claim instead.
  waiver_clears_at: string | null;
  // Their game started; adding them puts them on waivers.
  game_locked: boolean;
};

export type AddFreeAgentResult =
  | { status: 'ok'; roster: RosterEntry[]; dropped_player: RosterEntry | null }
  | { status: 'roster_full'; detail: string }
  | { status: 'on_waivers'; detail: string; clears_at: string | null };

export type WaiverClaim = {
  id: number;
  add_sleeper_player_id: string;
  add_player_name: string;
  drop_sleeper_player_id: string | null;
  drop_player_name: string | null;
  status: 'pending' | 'successful' | 'failed' | 'cancelled';
  failure_reason: string | null;
  created_at: string;
  processed_at: string | null;
};

// GET /players/{sleeper_player_id}/card (frontend/src/lib/playerCardApi.ts).
export type PlayerCard = {
  sleeper_player_id: string;
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
  projection: {
    season_projected_points: number;
    season_avg_projected_points: number;
    percent_owned: number;
    percent_started: number;
    bye_week: number | null;
    next_opponent: string | null;
    current_week: number;
  } | null;
  overview: {
    news: { headline: string | null; description: string | null; published: string | null; link: string | null }[];
    latest_note: { headline: string | null; story: string | null; published: string | null } | null;
    draft_rank: number | null;
    position_rank: number | null;
    season_outlook: string | null;
  } | null;
  latest_week: { week: number; fantasy_points: number } | null;
  weekly_scores: { week: number; fantasy_points: number; opponent: string | null }[];
  rostered_team_id: number | null;
  rostered_team_name: string | null;
  is_on_my_team: boolean;
};

// GET /nfl/scoreboard — ESPN's public scoreboard, this week's real NFL games.
export type NflGame = {
  id: string;
  name: string;
  home_team: string | null;
  home_score: string | null;
  away_team: string | null;
  away_score: string | null;
  state: 'pre' | 'in' | 'post' | null;
  // "Q3 5:12", "Halftime", "Final", "Sun 1:00 PM EDT".
  status_detail: string | null;
  completed: boolean;
  date: string | null;
  broadcast: string | null;
  week: number | null;
};
