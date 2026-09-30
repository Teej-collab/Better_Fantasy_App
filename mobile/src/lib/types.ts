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
  opponent_power_rank: number | null;
  opponent_owner_name: string | null;
  opponent_logo_url: string | null;
  opponent_record: string | null;
  opponent_result_streak: string | null;
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

export type InGameInjury = {
  state: 'left' | 'returned' | 'questionable_return' | 'doubtful_return' | 'ruled_out';
  detail: string | null;
} | null;

// Defense vs. position: rank 1 = fewest points allowed to this position.
export type PositionRank = { rank: number; average_allowed: number } | null;

export type RosterPlayer = {
  player_name: string;
  position: string | null;
  lineup_slot: string | null;
  points_scored: number | null;
  points_projected: number | null;
  // Moves during the game; points_projected is the fixed pregame number.
  live_projected: number | null;
  in_game_injury?: InGameInjury;
  // A Sleeper id (string) for real players.
  player_id: number | string | null;
  pro_team: string | null;
  injury_status: string | null;
  next_opponent: string | null;
  game_time: string | null;
  opponent_position_rank: PositionRank;
  is_boom: boolean;
  is_bust: boolean;
  raw_stats: Record<string, number> | null;
  on_offense: boolean;
  is_redzone: boolean;
  game_status: 'scheduled' | 'in_progress' | 'final' | null;
};

export type MatchupContextSide = {
  team_id: number;
  team_name: string;
  owner_id: number;
  owner_name: string;
  power_rank: number | null;
  logo_url: string | null;
  score: number | null;
  // Season-to-date total (standings' points_for).
  season_points: number | null;
  record: string | null;
  result_streak: string | null;
  // Live team projection; pregame_projected_total is fixed.
  projected_total: number | null;
  pregame_projected_total: number | null;
  roster: RosterPlayer[];
  touchdowns: { player_name: string; position: string | null; touchdowns: number }[];
  bench_crime: { bench_player: string; started_player: string; position: string; points_diff: number; severity: string } | null;
  clutch_choke: { label: 'clutch' | 'choke'; reason: string } | null;
  // Only once the matchup has real scores (0–100).
  win_probability: number | null;
};

export type RecentMeeting = {
  season: number;
  week: number;
  home_won: boolean;
  tie: boolean;
  home_score: number;
  away_score: number;
};

export type WeekMatchupContextItem = {
  matchup_id: number;
  season: number;
  week: number;
  is_playoff: boolean;
  is_game_of_the_week: boolean;
  is_rivalry: boolean;
  rivalry: {
    name: string;
    emoji: string | null;
    tier: string | null;
    all_time_wins_home: number;
    all_time_wins_away: number;
  } | null;
  head_to_head: {
    wins_home: number;
    wins_away: number;
    ties: number;
    last_season: number | null;
    last_week: number | null;
    // Oldest first, at most 5.
    recent_meetings: RecentMeeting[];
  };
  narrative: string | null;
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

// Draft (backend/app/routers/draft.py; web types in frontend/src/lib/draftApi.ts).
export type DraftStatus = 'not_started' | 'in_progress' | 'paused' | 'complete';

export type DraftConfig = {
  season: number;
  pick_time_limit_seconds: number;
  draft_order: number[];
  roster_slots: Record<string, number>;
  status: DraftStatus;
  current_pick_number: number;
  current_pick_deadline: string | null;
  paused_remaining_seconds: number | null;
  scheduled_start: string | null;
};

// Every slot in the draft exists up front; sleeper_player_id fills in
// when the pick is made.
export type DraftPick = {
  pick_number: number;
  round: number;
  round_pick: number;
  owner_id: number;
  owner_name: string;
  sleeper_player_id: string | null;
  player_name: string | null;
  player_position: string | null;
  is_autopick: boolean;
  is_keeper: boolean;
  made_at: string | null;
};

export type DraftChatMessage = { id: number; owner_id: number; owner_name: string; text: string; created_at: string };

export type DraftState = {
  config: DraftConfig;
  picks: DraftPick[];
  connected_owner_ids: number[];
  chat_messages: DraftChatMessage[];
};

export type DraftPoolPlayer = {
  sleeper_player_id: string;
  full_name: string;
  position: string;
  pro_team: string | null;
  search_rank: number | null;
  injury_status: string | null;
  projected_points: number | null;
  bye_week: number | null;
  drafted: boolean;
};

// Gamecast (backend/app/gamecast/models.py; web types in frontend/src/lib/gamecastApi.ts).
export type GamecastStatus = 'scheduled' | 'in_progress' | 'halftime' | 'final' | 'postponed' | 'canceled';
export type GamecastTeam = { abbr: string; name: string; score: number };

export type GamecastPlay = {
  play_id: string;
  period: number;
  clock: string;
  team_abbr: string | null;
  down: number | null;
  distance: number | null;
  description: string;
  play_type: string;
  yards_gained: number | null;
  is_scoring_play: boolean;
  is_turnover: boolean;
};

export type GamecastDrive = {
  drive_id: string;
  team_abbr: string;
  play_count: number;
  yards: number;
  duration: string;
  result: string | null;
};

export type GamecastScoringPlay = {
  play_id: string;
  period: number;
  clock: string;
  team_abbr: string;
  score_type: string;
  description: string;
  home_score_after: number;
  away_score_after: number;
};

export type LiveGame = {
  game_id: string;
  status: GamecastStatus;
  week: number;
  scheduled_start: string;
  home_team: GamecastTeam;
  away_team: GamecastTeam;
  period_label: string | null;
  clock: string | null;
  possession_team_abbr: string | null;
  down: number | null;
  distance: number | null;
  // 0–100: yards the offense still needs to score.
  yards_to_goal: number | null;
  field_position_label: string | null;
  is_redzone: boolean;
  current_drive: GamecastDrive | null;
  // Most recent first.
  plays: GamecastPlay[];
  scoring_plays: GamecastScoringPlay[];
};

export type GamecastGameSummary = {
  game_id: string;
  status: GamecastStatus;
  home_team: GamecastTeam;
  away_team: GamecastTeam;
};

export type ImpactPlayer = { player_id?: string; player_name: string; position: string; pro_team?: string; points_scored: number };

export type FantasyImpact = {
  your_team: { team_id: number; team_name: string } | null;
  your_players: ImpactPlayer[];
  opponent_team: { team_id: number; team_name: string } | null;
  opponent_players: ImpactPlayer[];
  game_leaders: {
    home: { abbr: string; name: string; leaders: ImpactPlayer[] };
    away: { abbr: string; name: string; leaders: ImpactPlayer[] };
  };
};

// Everyone in your league who was on a play, and what it earned them.
export type PlayFantasyPlayer = {
  player_id: string;
  player_name: string;
  position: string;
  team_name: string;
  owner_name: string;
  is_mine: boolean;
  is_opponent: boolean;
  points: number;
};

// ---- Home (frontend/src/app/(home)/page.tsx's data; types from
// frontend/src/lib/api.ts) ----

export type WeeklyAwards = {
  overachiever: { team_id: number; team_name: string; diff: number } | null;
  meltdown: { team_id: number; team_name: string; diff: number } | null;
  biggest_bench_crime: {
    bench_player: string;
    started_player: string;
    position: string;
    points_diff: number;
    severity: string;
    team_name: string;
  } | null;
  clutch: { team_name: string; margin: number; reason: string } | null;
  choke: { team_name: string; margin: number; reason: string } | null;
  boom_leaders: { player_name: string; points_scored: number; team_name: string }[];
  bust_leaders: { player_name: string; points_scored: number; team_name: string }[];
  game_of_the_week: { winner: string; score: string; tie?: boolean } | null;
};

export type Rivalry = {
  id: number;
  name: string | null;
  emoji: string | null;
  tagline: string | null;
  tier: string | null;
  all_time_wins_a: number;
  all_time_wins_b: number;
  owner_a_id: number;
  owner_a_name: string;
  owner_b_id: number;
  owner_b_name: string;
};

export type LeagueTickerItem = {
  matchup_id: number;
  home_team_name: string;
  home_score: number | null;
  home_top_scorer: { player_name: string; points_scored: number } | null;
  away_team_name: string;
  away_score: number | null;
  away_top_scorer: { player_name: string; points_scored: number } | null;
};

export type WeekPowerRanking = {
  team_id: number;
  team_name: string;
  owner_id: number;
  owner_name: string;
  power_rank: number;
  luck_score: number | null;
  sos: number | null;
  movement: number | null;
};

// deadline is null until week 1 finishes and there's a chug owed.
export type ChugDeadline = { deadline: string | null; is_past: boolean };

export type WeeklyNarrative = { text: string; kind: 'preview' | 'recap' };

export type ChugFeedEntry = {
  id: number;
  owner_id: number;
  owner_name: string;
  week: number | null;
  final_score: number;
  created_at: string;
  has_video: boolean;
  roast: string | null;
};

export type LeagueActivityItem =
  | {
      kind: 'roster';
      timestamp: string;
      team_name: string;
      owner_id: number;
      owner_name: string;
      source: 'free_agent' | 'waiver' | 'commissioner';
      added_player_name: string | null;
      dropped_player_name: string | null;
    }
  | {
      kind: 'trade';
      timestamp: string;
      proposing_owner_id: number;
      proposing_owner_name: string;
      receiving_owner_id: number;
      receiving_owner_name: string;
      assets: { player_name: string; position: string; to_team_id: number }[];
    };

// The parts of GET /settings/preferences the app reads: the owner's
// appearance (Settings > Appearance on the web) and Home card order.
export type OwnerPreferences = {
  accent_color: string | null;
  your_week_color: string | null;
  border_glow_color: string | null;
  honeycomb_color: string | null;
  theme: 'calm' | 'cosmic';
  reduced_motion: boolean;
  home_card_order: string | null;
};

// Chug (backend/app/routers/chug.py; web types in frontend/src/lib/api.ts).
export type ChugLeaderboardRow = {
  owner_id: number;
  owner_name: string;
  owed: number;
  completed: number;
  avg_grade: number | null;
  lifetime_completed: number;
  outstanding_owed: number;
  fined_owed: number;
  fine_amount: number;
  doubled_weeks: { week: number; owed_before: number; owed_after: number }[];
};

export type ChugUploadResult =
  | { can_to_mouth: false; message: string }
  | {
      can_to_mouth: true;
      id: number;
      duration_seconds: number;
      time_score: number;
      smoothness_score: number;
      hype_score: number;
      final_score: number;
      chugs_owed_before: number;
      chugs_owed_after: number;
      roast: string | null;
    };
