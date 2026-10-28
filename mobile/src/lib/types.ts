import type { LeagueFormat } from '@/lib/leagueFormat';

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
  // How many leagues this account is in (optional for an older backend).
  league_count?: number;
  // The active league's format (2026-10); null with no active league.
  league_format?: LeagueFormat | null;
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
  // Guillotine leagues: the week this team was cut, null while alive.
  eliminated_week?: number | null;
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
  // Its NFL team is off this week.
  on_bye?: boolean;
  // A Sleeper id (string) for real players.
  player_id: number | string | null;
  // Headshot (a team logo for a D/ST); on GET /teams/{id}/roster only.
  headshot_url?: string | null;
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
  // 3-game hot/cold form flag.
  streak: 'hot' | 'cold' | 'neutral';
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
  // A marquee game on a schedule the app built ("Season Opener",
  // "Rivalry Week", "Championship Rematch"); null otherwise.
  headline?: string | null;
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
  // The pre-game write-up, kept after kickoff (null until written).
  preview?: string | null;
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
  // Its NFL team is off this week.
  on_bye?: boolean;
  // Headshot (a team logo for a D/ST); absent from an older backend.
  headshot_url?: string | null;
  player_id: string;
  player_name: string;
  lineup_slot: string;
  // Taxi squad eligibility (dynasty): first- or second-year players.
  years_exp?: number | null;
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
  // This week's practice report: "Full" / "Limited" / "DNP".
  practice_participation?: string | null;
};

export type MyTeam = {
  team_name: string;
  // The team owner, for the header avatar (absent from an older backend).
  owner_name?: string | null;
  logo_url?: string | null;
  season: number;
  week: number | null;
  current_week: number | null;
  // False when viewing any week but the live one.
  is_editable: boolean;
  // Best ball: the lineup is set automatically (optional for an older backend).
  lineup_auto?: boolean;
  roster: RosterEntry[];
  // Per-slot capacity, e.g. { RB: 2, WR: 2 }. Null pre-draft.
  roster_slots: Record<string, number> | null;
  // At the roster limit: a waiver claim must name a drop (optional for an older backend).
  roster_full?: boolean;
};

// Chat (backend/app/routers/chat.py; web types in frontend/src/lib/api.ts).
// GET /chat/messages/{id}/receipts — a Commish Corner post's reach.
export type ReceiptPerson = { owner_id: number; name: string; opened_at: string | null };
export type AnnouncementReceipts = {
  total: number;
  seen: ReceiptPerson[];
  not_seen: ReceiptPerson[];
  receipts_off: number;
  opened: ReceiptPerson[];
  has_link: boolean;
};
export type ChatReaction = { emoji: string; count: number; reacted_by_me: boolean; reactor_names: string[] };

export type ChatVideo = {
  // "processing" while the backend converts it (the poster shows, it
  // can't play yet); a message_updated event brings "ready" or "failed".
  status?: 'processing' | 'ready' | 'failed';
  url: string | null;
  poster_url: string;
  width: number | null;
  height: number | null;
  duration: number | null;
};

export type ChatMessage = {
  id: number;
  conversation_id: number;
  owner_id: number;
  owner_name: string;
  owner_chat_color: string | null;
  owner_logo_url: string | null;
  body: string;
  image_url: string | null;
  // A posted video (backend app/domain/chat_video.py): signed links to
  // an H.264 MP4 and its poster frame, with its upright size and length.
  video?: ChatVideo | null;
  // Commish Corner announcements only.
  title: string | null;
  // A bet shared from the bet tracker — rendered as a live bet card.
  bet_id?: number | null;
  deleted: boolean;
  created_at: string;
  reply_to: { id: number; owner_name: string; body: string } | null;
  mentions: number[];
  reactions: ChatReaction[];
};

export type ChatConversation = {
  id: number;
  type: 'league' | 'direct' | 'commish_corner' | 'group';
  // A group chat's name, if someone gave it one, and everyone in it but you.
  name?: string | null;
  member_names?: string[] | null;
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
  headshot_url?: string | null;
  full_name: string;
  position: string;
  pro_team: string | null;
  injury_status: string | null;
  // This week's projection when harvested, else the season per-game average.
  projected_points: number | null;
  // Its NFL team is off this week.
  on_bye?: boolean;
  score: number | null;
  last_week_score: number | null;
  next_opponent: string | null;
  game_time: string | null;
  // Set while the player is on waivers: add returns on_waivers, so claim instead.
  waiver_clears_at: string | null;
  // Their game started; adding them puts them on waivers.
  game_locked: boolean;
  // A search also finds rostered players (2026-10): whose team they're on.
  rostered_team_id?: number | null;
  rostered_team_name?: string | null;
  rostered_owner_name?: string | null;
  is_mine?: boolean;
};

export type AddFreeAgentResult =
  | { status: 'ok'; roster: RosterEntry[]; dropped_player: RosterEntry | null }
  | { status: 'roster_full'; detail: string }
  | { status: 'on_waivers'; detail: string; clears_at: string | null };

export type WaiverClaim = {
  id: number;
  add_sleeper_player_id: string;
  add_player_name: string;
  add_player_position: string | null;
  add_player_pro_team: string | null;
  drop_sleeper_player_id: string | null;
  drop_player_name: string | null;
  status: 'pending' | 'successful' | 'failed' | 'cancelled';
  failure_reason: string | null;
  created_at: string;
  processed_at: string | null;
  // The team's own rank for a pending claim (1 = first); pending claims
  // come back first, in this order.
  claim_order: number;
  // When a pending claim's player clears waivers.
  clears_at: string | null;
};

// GET /me/team/waivers: your claims plus where you sit in this week's
// waiver order ("Priority #4 of 12").
export type WaiverClaimsResponse = {
  claims: WaiverClaim[];
  priority: { rank: number; of: number } | null;
};

// GET /players/{sleeper_player_id}/card (frontend/src/lib/playerCardApi.ts).
export type PlayerGameLog = {
  categories: { key: string; title: string; labels: string[] }[];
  games: { week: number; opponent: string | null; result: string | null; fantasy_points: number | null; stats: Record<string, string[]> }[];
};

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
  // ESPN-style game log (2026-10): each game's line by category, with our points.
  game_log?: PlayerGameLog | null;
  rostered_team_id: number | null;
  rostered_team_name: string | null;
  is_on_my_team: boolean;
  // Listed by their owner on the Trades page's trade block (2026-10-23).
  on_trade_block?: boolean;
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
  // ESPN's forecast for a game not yet played, and whether it's a dome
  // (optional for an older backend).
  weather?: { condition: string | null; temperature: number | null } | null;
  indoor?: boolean;
};

// Draft (backend/app/routers/draft.py; web types in frontend/src/lib/draftApi.ts).
export type DraftStatus = 'not_started' | 'in_progress' | 'paused' | 'complete';

export type DraftConfig = {
  season: number;
  // 'snake' | 'linear' (dynasty rookie draft) | 'auction' — optional for an older backend.
  draft_type?: string;
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
  // Auction drafts: what he went for.
  price?: number | null;
  // Market ADP the draft is pinned to, and the board's tag when the
  // pick landed a full round or more off it (backend app/queries/draft.py).
  adp?: number | null;
  adp_verdict?: 'steal' | 'reach' | null;
};

// The live auction (auction drafts, 2026-10 — backend app/domain/
// auction_engine.py). The clock is config.current_pick_deadline.
export type AuctionTeam = { owner_id: number; spent: number; remaining: number; players: number; open_spots: number; max_bid: number };
export type AuctionState = {
  budget: number;
  nominator_owner_id: number | null;
  nominee: { sleeper_player_id: string; full_name?: string; position?: string; pro_team?: string | null } | null;
  high_bid: number | null;
  high_bidder_owner_id: number | null;
  deadline: string | null;
  teams: AuctionTeam[];
};

export type DraftChatMessage = { id: number; owner_id: number; owner_name: string; text: string; created_at: string };

export type DraftState = {
  config: DraftConfig;
  picks: DraftPick[];
  connected_owner_ids: number[];
  chat_messages: DraftChatMessage[];
  // Auction drafts only.
  auction?: AuctionState | null;
};

export type DraftPoolPlayer = {
  sleeper_player_id: string;
  full_name: string;
  position: string;
  pro_team: string | null;
  // Market ADP (Fantasy Football Calculator), null until the draft
  // starts or for a player the feed doesn't cover.
  adp: number | null;
  search_rank: number | null;
  injury_status: string | null;
  projected_points: number | null;
  bye_week: number | null;
  drafted: boolean;
};

// Gamecast (backend/app/gamecast/models.py; web types in frontend/src/lib/gamecastApi.ts).
export type GamecastStatus = 'scheduled' | 'in_progress' | 'halftime' | 'final' | 'postponed' | 'canceled';
export type GamecastTeam = { abbr: string; name: string; score: number };

export type GamecastPlayerRef = { name: string; team_abbr: string; role: string; provider_player_id?: string | null };

export type GamecastPlay = {
  play_id: string;
  drive_id: string | null;
  period: number;
  clock: string;
  team_abbr: string | null;
  down: number | null;
  distance: number | null;
  description: string;
  play_type: string;
  yards_gained: number | null;
  // Yards to the end zone before the snap (0–100); 0 on bookkeeping
  // entries like "END GAME".
  yard_line: number | null;
  // Who had the ball at the snap and at the whistle, and the end spot as
  // yards to THAT team's goal (lib/fieldGeometry.ts draws kicks and
  // turnovers with them). Only the ESPN provider fills these in.
  start_team_abbr?: string | null;
  end_team_abbr?: string | null;
  end_yard_line?: number | null;
  is_scoring_play: boolean;
  is_turnover: boolean;
  is_first_down: boolean;
  // ESPN's event: TOUCHDOWN, FIELD_GOAL, FIRST_DOWN, PUNT, PLAY_COMPLETED…
  event_type: string | null;
  players_involved: GamecastPlayerRef[];
};

export type GamecastDrive = {
  drive_id: string;
  team_abbr: string;
  play_count: number;
  yards: number;
  duration: string;
  // Not measured the same way for both teams — use the drive's first
  // snap's yard_line for where it started (lib/gamecast.ts).
  start_yard_line: number;
  result: string | null;
  // Oldest first.
  plays: GamecastPlay[];
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
  // 1–4, 5+ for overtime; null before kickoff.
  period: number | null;
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
  // Oldest first.
  drives: GamecastDrive[];
  // Most recent first.
  plays: GamecastPlay[];
  scoring_plays: GamecastScoringPlay[];
  last_updated: string;
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

// Gamecast's ESPN-style box score (backend app/gamecast/boxscore.py).
export type BoxScoreAthlete = {
  espn_id: number | null;
  player_id: string | null;
  name: string | null;
  short_name: string | null;
  position: string | null;
  stats: string[];
};
export type BoxScoreCategory = { key: string; title: string; labels: string[]; athletes: BoxScoreAthlete[]; totals: string[] };
export type BoxScoreTeam = { abbr: string; name: string; logo: string | null; home_away: 'home' | 'away' | null; categories: BoxScoreCategory[] };
export type GamecastBoxScore = { final: boolean; teams: BoxScoreTeam[] };

// Everyone in your league who was on a play, and what it earned them.
export type PlayFantasyPlayer = {
  player_id: string;
  player_name: string;
  position: string;
  lineup_slot: string | null;
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
  description: string | null;
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
  // What's behind the rank (2026-10 overhaul) — see the web's
  // WeekPowerRanking (frontend/src/lib/api.ts).
  record?: string;
  points_per_game?: number;
  luck_wins?: number;
  sos_rank?: number | null;
  sos_remaining_rank?: number | null;
  note?: string | null;
};

// deadline is null until week 1 finishes and there's a chug owed.
export type ChugDeadline = {
  deadline: string | null;
  is_past: boolean;
  // The signed-in owner's own balance, for the card's "You owe" line.
  mine?: { outstanding_owed: number; fined_owed: number; fine_amount: number; consecutive_missed_weeks: number } | null;
};

// GET /chug/ledger (backend app/domain/chug_ledger.py) — the history
// behind each owner's balance, oldest first.
export type ChugLedgerEvent =
  | { kind: 'earned'; week: number; chugs: number; change: number; balance: number; reasons: { player_name: string; position: string | null; points: number }[] }
  | { kind: 'doubled' | 'fined' | 'waived'; week: number; owed_before: number; owed_after: number; change: number; balance: number; fine_amount?: number }
  | { kind: 'chug'; at: string; score: number | null; change: number; balance: number }
  // A chug a commissioner marked paid ($10 each, or done in person), or a
  // fine they cleared. `at` is null for one from before payments were logged.
  | { kind: 'paid' | 'fine_paid'; at: string | null; amount: number; dollars: number; change: number; balance: number }
  // A commissioner/admin fix to the balance (+ added, − removed), with its note.
  | { kind: 'correction'; at: string; amount: number; note: string | null; change: number; balance: number }
  | { kind: 'adjustment'; change: number; balance: number };

// `released` (recaps only): false until the Tuesday flip — only a
// commissioner gets an unreleased recap at all (backend/app/domain/recap_release.py).
export type WeeklyNarrative = { text: string; kind: 'preview' | 'recap'; released?: boolean };

// The content-based hype grade's breakdown (backend app/domain/
// chug_hype.py); null on older chugs and any that couldn't be graded.
export type ChugHypeDetail = {
  self_roast: number;
  comedy: number;
  commitment: number;
  verdict: string | null;
  quote: string | null;
};

export type ChugFeedEntry = {
  id: number;
  owner_id: number;
  owner_name: string;
  week: number | null;
  final_score: number;
  created_at: string;
  has_video: boolean;
  roast: string | null;
  hype_detail?: ChugHypeDetail | null;
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
export type SundayMode = 'full_send' | 'game_day' | 'leave_me_alone';

// GET /settings/preferences (frontend/src/lib/api.ts OwnerPreferences).
export type OwnerPreferences = {
  notify_direct_messages: boolean;
  notify_league_chat: boolean;
  notify_mentions: boolean;
  notify_replies: boolean;
  sunday_mode: SundayMode | null;
  quiet_hours_enabled: boolean;
  // "22:00:00"
  quiet_hours_start: string;
  quiet_hours_end: string;
  timezone: string | null;
  read_receipts_enabled: boolean;
  typing_indicators_enabled: boolean;
  message_previews_enabled: boolean;
  mention_highlighting_enabled: boolean;
  neon_intensity: 'subtle' | 'standard' | 'high';
  reduced_motion: boolean;
  accent_color: string | null;
  your_week_color: string | null;
  border_glow_color: string | null;
  // A hex, "off", or null for the default crimson.
  honeycomb_color: string | null;
  theme: 'calm' | 'cosmic' | 'midnight' | 'graphite' | 'ember' | 'gridiron';
  beta_layout: boolean;
  design_direction: 'default' | 'broadcast' | 'stadium';
  home_card_order: string | null;
  push_enabled: boolean;
  // Settings > Bets — off hides My Bets and the Gamecast's Your Bets card.
  bet_tracking_enabled: boolean;
  notify_my_players: boolean;
  notify_red_zone: boolean;
  notify_injuries: boolean;
  notify_player_news: boolean;
  notify_fantasy_team: boolean;
  notify_league: boolean;
  notify_watch_parties: boolean;
  ai_training_opt_out: boolean;
  // False until the one-time "AI learning from chat" notice is answered
  // (shown before your first chat send, same as the web's).
  ai_training_notice_seen?: boolean;
};

// GET /settings/me (frontend/src/lib/api.ts MySettings).
export type MySettings = {
  display_name: string;
  display_name_is_custom: boolean;
  chat_color: string | null;
  logo_url: string | null;
  discord_username: string | null;
  email: string | null;
  has_discord: boolean;
  has_google: boolean;
  has_password: boolean;
  team_name: string | null;
  team_name_is_custom: boolean | null;
};

export type FeedbackItem = {
  id: number;
  submitted_by: string;
  message: string;
  page_url: string | null;
  image_url: string | null;
  created_at: string;
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
      hype_detail?: ChugHypeDetail | null;
    };

// ---- League section (frontend/src/lib/api.ts, pollsApi.ts) ----

export type Team = { team_id: number; team_name: string; owner_id: number; owner_name: string };

// Suggested rivalries (backend app/routers/rivalry_suggestions.py), commissioner only.
export type RivalrySuggestion = {
  id: number;
  owner_a_id: number;
  owner_b_id: number;
  owner_a_name: string;
  owner_b_name: string;
  score: number;
  tier: string;
  reasons: string[];
  suggested_name: string | null;
  suggested_tagline: string | null;
};

export type Poll = {
  id: number;
  question: string;
  options: string[];
  status: 'open' | 'closed';
  results: number[];
  // Option index, null until you vote.
  my_vote: number | null;
};

export type PlayoffBracketNode = {
  id: number;
  round: number;
  slot: number;
  team_a_id: number | null;
  team_a_name: string | null;
  team_a_seed: number | null;
  team_b_id: number | null;
  team_b_name: string | null;
  team_b_seed: number | null;
  winner_team_id: number | null;
  team_a_score: string | null;
  team_b_score: string | null;
};

export type ProjectedPlayoffMatchup = {
  slot: number;
  team_a_name: string;
  team_a_seed: number;
  team_b_name: string;
  team_b_seed: number;
};

export type PowerRankTrendTeam = {
  team_id: number;
  team_name: string;
  owner_id: number;
  owner_name: string;
  weeks: { week: number; power_rank: number }[];
};

export type AllTimePowerCategory = {
  key: string;
  label: string;
  emoji: string;
  unit: string;
  entries: { owner_id: number; owner_name: string; value: number }[];
};

export type RecordCategory = {
  key: string;
  label: string;
  emoji: string;
  unit: string;
  entries: {
    owner_id: number;
    owner_name: string;
    team_name: string;
    season: number;
    week: number | null;
    value: number;
    opponent_team_name: string | null;
    opponent_score: number | null;
    own_score?: number;
  }[];
};

export type AwardLeaderboardCategory = {
  key: string;
  label: string;
  emoji: string;
  winners: { owner_id: number; owner_name: string; wins: number }[];
};

export type SeasonAwards = {
  champion: { team_name: string; owner_id: number; owner_name: string } | null;
  awards: { award_type: string; detail: string | null; owner_id: number; owner_name: string }[];
};

// The Punishment Wheel (backend/app/routers/punishment_wheel.py).
export type PunishmentWheel = {
  season: number;
  items: { id: number; text: string; can_remove: boolean }[];
  result: { text: string; landed_index: number; items: string[]; spun_at: string; spun_by: string | null } | null;
  can_edit: boolean;
  can_spin: boolean;
  is_commissioner: boolean;
};

export type Owner = {
  owner_id: number;
  display_name: string;
  logo_url?: string | null;
  // Player-card photo (2026-10): a short-lived signed link to the private
  // bucket, only for members of this league; photo_version changes when
  // the photo does, so the image cache survives new links.
  photo_url?: string | null;
  photo_version?: number | null;
  latest_team_name: string;
  seasons: number[];
};

export type PeriodSummary = { record: string; pf: number; pa: number; pfpg: number; papg: number; game_count: number };

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

export type OwnerBadges = { championship_years: number[]; award_summary: Record<string, number[]> };

export type SeasonProfile = {
  team_name: string;
  regular: PeriodSummary | null;
  playoff: PeriodSummary | null;
  best_week: { week: number; score: number } | null;
  worst_week: { week: number; score: number } | null;
  avg_luck: number | null;
  current_power_rank: number | null;
  season_awards: { award_type: string; detail: string | null }[];
};

export type DraftGrade = {
  owner_id: number;
  owner_name: string;
  total_projected_points: number;
  // Null on grades computed before 2026-10-27 (migration c2e4a6b8d0f3).
  starter_projected_points: number | null;
  percentile: number;
  letter_grade: string;
};

export type TeamDetail = {
  team_id: number;
  season: number;
  team_name: string;
  owner_id: number;
  owner_name: string;
  logo_url?: string | null;
  // This season's record and standings rank (optional for an older backend).
  wins?: number;
  losses?: number;
  ties?: number;
  rank?: number;
  team_count?: number;
};

// Trades (backend/app/routers/trades.py; web types in frontend/src/lib/tradesApi.ts).
export type TradeStatus =
  | 'pending'
  | 'awaiting_review'
  | 'in_review'
  | 'accepted'
  | 'rejected'
  | 'cancelled'
  | 'vetoed'
  | 'expired'
  | 'failed';

export type TradeReviewMode = 'none' | 'commissioner' | 'league_vote' | 'approval';

export type Trade = {
  id: number;
  proposing_team_id: number;
  receiving_team_id: number;
  status: TradeStatus;
  proposed_at: string;
  resolved_at: string | null;
  review_ends_at?: string | null;
  expires_at?: string | null;
  note?: string | null;
  proposing_team_name?: string | null;
  receiving_team_name?: string | null;
  veto_votes?: number;
  my_veto_vote?: boolean;
  assets: { sleeper_player_id: string; player_name: string; position: string; from_team_id: number; to_team_id: number }[];
  // Future draft picks in the deal (keeper and dynasty leagues, 2026-10-28).
  picks?: TradePickAsset[];
  // A franchise-tagged player going back to a manager who kept him.
  tag_flags?: string[];
  // Who each side cuts to make room when it goes through (2026-10-23).
  drops?: { team_id: number; sleeper_player_id: string; player_name: string; position: string | null }[];
  // Points a week gained by the viewer's side, or for a trade between
  // two other teams, which side it leans to (backend trade_values.py).
  value?: TradeValueSummary | null;
};

export type TradePickAsset = { future_pick_id: number; from_team_id: number; to_team_id: number; season: number; round: number; label: string };

// A future pick you or a trade partner hold (GET /trades/picks).
export type TradePick = { id: number; season: number; round: number; label: string };

export type TradeValueSummary = { value_change: number; verdict: 'you' | 'them' | 'even' | 'leans'; leans_team_id: number | null };

export type TradeRosterPlayer = {
  sleeper_player_id: string;
  player_name: string;
  position: string;
  per_week?: number;
  pro_team?: string | null;
  injury_status?: string | null;
  on_block?: boolean;
};

// Trades overhaul (2026-10-23): the builder's and an offer's live read.
export type TradeValuePlayer = { id: string; name: string; position: string | null; per_week: number };
export type TradeEvaluation = {
  week: number;
  give: TradeValuePlayer[];
  receive: TradeValuePlayer[];
  value_change: number;
  verdict: 'you' | 'them' | 'even';
  my_lineup: {
    before: number;
    after: number;
    change: number;
    slots: { slot: string; before: string | null; after: string | null; delta: number }[];
  };
  their_lineup_change: number;
  my_drops_needed: number;
  their_drops_needed: number;
  suggestion: { side: 'give' | 'receive'; player: TradeValuePlayer } | null;
  drop_candidates: (TradeValuePlayer & { pro_team?: string | null })[];
};

// The builder's team list (GET /trades/partners): best fits first.
export type TradePartner = {
  team_id: number;
  team_name: string;
  owner_name: string | null;
  logo_url: string | null;
  wins: number;
  losses: number;
  ties: number;
  rank: number | null;
  needs: string[];
  deep_at: string[];
  fit: number;
  fit_reason: string | null;
};

export type TradeBlockPlayer = {
  team_id: number;
  team_name: string;
  sleeper_player_id: string;
  player_name: string;
  position: string;
  pro_team: string | null;
  per_week: number;
  created_at: string;
};

// Keepers (backend/app/routers/keepers.py; web types in frontend/src/lib/api.ts).
export type KeeperRules = {
  season: number;
  max_keepers: number;
  max_consecutive_years: number | null;
  keeper_deadline: string | null;
  locked_at: string | null;
  is_open: boolean;
  // What a keeper costs (backend app/domain/keeper_costs.py, 2026-10-28).
  cost_mode?: KeeperCostMode;
  cost_step?: number;
  // Franchise tag fee by year kept, dollars ([0, 10, 25]); null: none.
  tag_fees?: number[] | null;
  draft_scheduled_start: string | null;
};

// The league kitty (GET /league/kitty, 2026-10-28).
export type KittyEntry = {
  id: number;
  season: number;
  owner_id: number | null;
  owner_name: string | null;
  amount: number;
  reason: string;
  // A franchise tag fee billed when keepers locked.
  automatic: boolean;
  created_at: string;
  paid_at: string | null;
};
export type Kitty = { entries: KittyEntry[]; collected: number; outstanding: number };

// GET /league/offseason: no pickups between the season and the draft.
export type OffseasonState = { lock: boolean; cleared: boolean; blocked_now: boolean };

export type KeeperCostMode = 'last_round' | 'round_drafted' | 'escalating';

export type MyKeepers = {
  rules: KeeperRules;
  // Last season's roster to pick from.
  roster_pool: {
    espn_player_id: number;
    player_name: string;
    position: string | null;
    pro_team: string | null;
    eligible: boolean;
    consecutive_years_if_kept: number;
    // 2026-10-28: market ADP, "RB3 last year · 312 pts", and a
    // keep-or-let-go read (app/domain/war_room.py's keeper_outlook).
    adp?: number | null;
    verdict?: string | null;
    verdict_tone?: 'keep' | 'let_go' | 'toss_up' | null;
    last_season?: string | null;
    // The draft round he'd cost, and the franchise tag fee for keeping him.
    cost_round?: number | null;
    tag_fee?: number;
  }[];
  selections: { espn_player_id: number; player_name: string; consecutive_years_kept: number }[];
};

// GET /chat/conversations/{id}/members.
export type ChatConversationMember = { owner_id: number; display_name: string; chat_color: string | null; logo_url: string | null };

// Chat's DM-eligible league members (GET /chat/members).
export type ChatMember = { owner_id: number; display_name: string; team_name: string; online: boolean };

// Watch Party (backend/app/routers/watch_party.py).
export type WatchPartyRoom = {
  id: number;
  name: string;
  // 'party': an open watch party anyone in the league can join (2026-10).
  kind: 'open' | 'private' | 'party';
  host_name?: string | null;
  created_by_owner_id: number;
  member_count: number;
  conversation_id: number;
  // Someone's in the room right now.
  is_live: boolean;
  // The game on the room's TV (ESPN event id) and how far behind the
  // live data it runs — the room holds that game back this long so
  // nothing spoils the stream. Optional for an older backend.
  tv_game_id?: string | null;
  tv_delay_seconds?: number;
  // Who has the room open right now.
  watchers?: { owner_id: number; display_name: string }[];
};

export type WatchPartyRoomsResponse = { open_room: WatchPartyRoom; party_rooms?: WatchPartyRoom[]; private_rooms: WatchPartyRoom[] };

export type WatchPartyRoomMember = { owner_id: number; display_name: string };

// Pushed over the watch-party socket (app/domain/watch_party.py).
export type FantasyDigest = {
  type: 'fantasy_digest';
  season: number;
  week: number;
  matchups: {
    matchup_id: number;
    home: { team_name: string; owner_name: string; score: number | null };
    away: { team_name: string; owner_name: string; score: number | null };
    sweat: { score: number; label: string | null };
  }[];
};

// Lounge (backend/app/routers/lounge.py).
export type LoungeRoom = {
  id: number;
  slug: string;
  name: string;
  closed: boolean;
  created_at: string;
  invited?: { user_id: number; name: string }[];
};
export type LoungeInvite = { id: number; slug: string; name: string; host_name: string; invited_at: string };

// Friends (backend/app/routers/friends.py).
export type FriendRelationship = 'friends' | 'outgoing' | 'incoming' | 'none';
export type FriendPerson = {
  user_id: number;
  name: string;
  username: string | null;
  photo_url: string | null;
  shared_leagues?: string[];
  relationship?: FriendRelationship;
};
export type FriendsList = { friends: FriendPerson[]; incoming: FriendPerson[]; outgoing: FriendPerson[] };

// Commissioner tools (frontend/src/lib/leaguesApi.ts, tradesApi.ts).
export type LeagueInfo = {
  id: number;
  name: string;
  invite_code: string;
  created_at: string;
  role: 'commissioner' | 'member';
  // How many teams it's meant to have; null for leagues made before that was asked.
  team_count?: number | null;
  // The chug rule is a house rule a commissioner turns on and names (2026-10).
  chug_enabled?: boolean;
  chug_rule_name?: string | null;
  // GET /leagues/mine only: the league picker's card line.
  summary?: LeagueSummary | null;
} & Partial<LeagueFormat>;

export type LeagueSummary = {
  team_name: string | null;
  record: string | null;
  week: number | null;
  teams: number;
  team_count: number | null;
  draft_status: 'not_started' | 'in_progress' | 'paused' | 'complete' | null;
  draft_at: string | null;
};

export type ScoringPreset = 'ppr' | 'half' | 'standard';

// GET /leagues/preview — the league behind an invite code, before joining.
export type LeaguePreview = {
  id: number;
  name: string;
  invite_code: string;
  season: number;
  team_count: number | null;
  teams: number;
  history_seasons: number;
  scoring: 'PPR' | 'Half PPR' | 'Standard' | 'Custom';
  commissioner: string | null;
  already_member: boolean;
};

export type LeagueMember = { user_id: number; role: 'commissioner' | 'member'; joined_at: string; display_name: string };

export type LeagueTeam = { team_id: number; team_name: string; owner_id: number; owner_name: string };

export type PlayoffSettings = {
  season: number;
  playoff_team_count: number | null;
  weeks_per_matchup: number;
  // null: inferred from the season's regular-season schedule.
  start_week: number | null;
};

export type ScoringRule = { stat_category: string; points_per_unit: number };

// Mirror mode and the switch to The Weekend (GET /league/switch, 2026-10-24).
export type LeagueSwitchStatus = {
  mirrored: boolean;
  platform: 'espn' | 'sleeper' | null;
  platform_name: string | null;
  teams: number;
  claimed: number;
  unclaimed: string[];
  notes: string[];
  pending: { effective_week: number } | null;
  switched_from: string | null;
};

export type ImportPreview = {
  platform: 'espn' | 'sleeper';
  external_id: string;
  name: string;
  season: number;
  current_week: number;
  team_count: number;
  teams: { team_name: string; owner_name: string | null }[];
};

export type SleeperConnectionStatus =
  | { connected: false }
  | { connected: true; sleeper_league_id: string; league_name: string | null; last_synced_at: string | null; last_sync_error: string | null };

export type EspnConnectionStatus =
  | { connected: false }
  | { connected: true; espn_league_id: number; public?: boolean; last_synced_at: string | null; last_sync_error: string | null };

export type TradeSettings = {
  season: number;
  trade_deadline: string | null;
  review_required: boolean;
  review_mode: TradeReviewMode;
  review_hours: number;
  veto_votes_needed: number | null;
  effective_veto_votes_needed: number;
};

export type CommissionerAddResult =
  | { status: 'ok'; roster: RosterEntry[] }
  | { status: 'roster_full' }
  | { status: 'on_waivers'; detail: string; clears_at: string | null };

// The Views menu on Players and the roster (backend app/domain/player_views.py).
// "matchup" is each list's own layout and is never fetched.
export type PlayerViewKey =
  | 'matchup'
  | 'proj_2026'
  | 'stats_2026'
  | 'stats_2025'
  | 'scoring'
  | 'research'
  | 'schedule'
  | 'rankings'
  | 'ppr_rankings';

export type PlayerViewColumn = {
  key: string;
  label: string;
  format: 'int' | 'number1' | 'number2' | 'ordinal' | 'ordinal_matchup' | 'signed_int' | 'text';
  group?: string;
};

export type PlayerViewData = {
  view: PlayerViewKey;
  week: number;
  columns: PlayerViewColumn[];
  rows: Record<string, Record<string, string | number | null>>;
  note?: string;
};

// GET /chat/gifs (backend app/providers/giphy.py, proxied so the GIPHY
// key never reaches the app). `url` is what gets sent; `preview_url` is a
// smaller rendition for the picker grid.
export type ChatGif = {
  id: string;
  description: string;
  url: string;
  preview_url: string;
  width: number | null;
  height: number | null;
};

// ---- Bet tracking (backend app/routers/bets.py) — tracking only ----

export type BetLegStatus = 'open' | 'won' | 'lost' | 'push' | 'void';
export type BetStatus = BetLegStatus | 'cashed_out';
export type BetMarket = 'player_prop' | 'moneyline' | 'spread' | 'total' | 'other';
export type BetDirection = 'over' | 'under' | 'yes' | 'no';

export type BetLeg = {
  id: number;
  description: string;
  market: BetMarket;
  player_name: string | null;
  sleeper_player_id: string | null;
  team_abbr: string | null;
  stat_key: string | null;
  stat_label: string | null;
  line: number | null;
  direction: BetDirection | null;
  odds_american: number | null;
  espn_event_id: string | null;
  game: {
    state: 'pre' | 'in' | 'post' | null;
    home_team: string | null;
    away_team: string | null;
    home_score: number | null;
    away_score: number | null;
  } | null;
  status: BetLegStatus;
  current: number | null;
  target: number | null;
  // False for legs the app can't grade (market "other", or no game found).
  tracked: boolean;
};

export type Bet = {
  id: number;
  owner_name: string;
  sportsbook: string | null;
  // Only on your own bets — a shared bet never shows its money.
  stake?: number | null;
  payout?: number | null;
  note?: string | null;
  status_set_manually?: boolean;
  odds_american: number | null;
  status: BetStatus;
  shared: boolean;
  created_at: string;
  legs: BetLeg[];
};

// League Bets (backend app/routers/league_bets.py): the league's shared
// bets and who placed them. Never any wager or payout; units count
// every bet as one unit at its odds.
export type BetMember = {
  user_id: number;
  name: string;
  team_name: string | null;
  logo_url: string | null;
  color: string | null;
};

export type BetReaction = 'fade' | 'sweat' | 'rip';
export type ReactionCounts = Record<BetReaction, { count: number; mine: boolean }>;

export type LeagueBet = Bet & {
  member: BetMember;
  mine: boolean;
  this_week: boolean;
  member_record: string;
  units: number | null;
  one_leg_away: { leg_id: number; needs_more: number | null } | null;
  bad_beat: { leg_id: number; missed_by: number | null } | null;
  tails: { count: number; names: string[]; mine: boolean };
  reactions: ReactionCounts;
};

export type LeaguePick = {
  player_name: string | null;
  market: BetMarket;
  stat_key: string | null;
  stat_label: string | null;
  line: number | null;
  direction: BetDirection | null;
  team_abbr: string | null;
  description: string;
};

export type LeagueFeed =
  | { enabled: false }
  | {
      enabled: true;
      week_start: string;
      sweat: {
        alive: number;
        one_leg_away: number;
        riding_units: number;
        closest: {
          bet_id: number;
          member: BetMember;
          odds_american: number | null;
          legs: number;
          leg: LeaguePick & { current: number | null; target: number | null; game: BetLeg['game'] };
          needs_more: number | null;
        } | null;
      };
      consensus: {
        player_name: string;
        count: number;
        of: number;
        members: BetMember[];
        top_picks: { direction: BetDirection | null; line: number | null; stat_label: string | null; count: number }[];
      } | null;
      bets: LeagueBet[];
    };

export type BetRecord = {
  wins: number;
  losses: number;
  pushes: number;
  hit_rate: number | null;
  units: number;
  streak: string | null;
  open: number;
};

export type LeagueBoard = {
  range: 'season' | 'week';
  season: number;
  rows: (BetMember & BetRecord & { me: boolean; bets: number; bad_beats: number; rank: number })[];
  trophies: {
    longest_shot: { member: BetMember; odds_american: number; legs: number; bet_id: number } | null;
    bad_beat_king: { member: BetMember; count: number } | null;
    most_tailed: { member: BetMember; count: number } | null;
    best_fade: { member: BetMember; wins: number; losses: number } | null;
  };
  tendencies: {
    overs_share: number | null;
    overs: { wins: number; losses: number };
    unders: { wins: number; losses: number };
    parlay_hit_rate: number | null;
  };
};

export type LeagueGameSummary = {
  event_id: string;
  game: BetLeg['game'];
  legs: number;
  alive: number;
  members: BetMember[];
  member_count: number;
};

export type LeagueGameEntry = {
  member: BetMember;
  bet_id: number;
  line: number | null;
  direction: BetDirection | null;
  status: BetLegStatus;
  parlay_legs: number;
};

export type LeagueGame = {
  event_id: string;
  game: BetLeg['game'];
  legs: number;
  member_count: number;
  props: {
    player_name: string;
    sleeper_player_id: string | null;
    team_abbr: string | null;
    stat_key: string | null;
    stat_label: string | null;
    current: number | null;
    entries: LeagueGameEntry[];
  }[];
  lines: (LeaguePick & { status: BetLegStatus; entries: LeagueGameEntry[] })[];
  rooting: { team: string; share: number }[];
};

export type LeagueMemberCard = {
  member: BetMember;
  me: boolean;
  rank: number | null;
  of: number;
  record: BetRecord;
  form: ('won' | 'lost' | 'push' | 'open')[];
  style: {
    favorite_player: { player_name: string; legs: number; wins: number; losses: number } | null;
    go_to_stat: { label: string; share: number } | null;
    parlay_rate: number | null;
    avg_parlay_legs: number | null;
    overs_share: number | null;
  };
  biggest_hit: { bet_id: number; odds_american: number; legs: LeaguePick[]; tails: number; created_at: string } | null;
  vs: { you: BetRecord; them: BetRecord; shared_players: string[] } | null;
  following: boolean;
  bets: LeagueBet[];
};

export type DraftLeg = {
  description: string;
  market: BetMarket;
  player_name: string | null;
  team_abbr: string | null;
  stat_key: string | null;
  line: number | null;
  direction: BetDirection | null;
  odds_american: number | null;
  matched?: boolean;
  // Read off a slip, but missing something or not a real player/game this week.
  needs_check?: boolean;
};

export type DraftBet = {
  sportsbook: string | null;
  stake: number | null;
  odds_american: number | null;
  payout: number | null;
  legs: DraftLeg[];
  // From a slip: read cleanly enough for a one-tap "looks right".
  ready?: boolean;
};

// POST /bets/parse-slip: every bet on the screenshot (the first one's
// fields are repeated at the top level for older app versions).
export type ParsedSlip = DraftBet & { bets?: DraftBet[] };

// GET /watch-party/lobby (backend/app/routers/watch_party.py): this
// week's games, ranked by what's riding on them for you.
export type LoungeLobbyGame = {
  game_id: string;
  home_team: string;
  away_team: string;
  home_score: string | null;
  away_score: string | null;
  state: 'pre' | 'in' | 'post' | null;
  status_detail: string | null;
  date: string | null;
  is_redzone: boolean;
  possession_team_abbr: string | null;
  my_players: string[];
  opponent_players: string[];
  opponent_team_name: string | null;
  open_bet_legs: number;
  stakes: number;
};

export type LoungeLobby = { week: number | null; games: LoungeLobbyGame[] };

// Playoff chances from simulating the rest of the season and the
// playoffs (backend/app/domain/playoff_odds.py) — see the web's
// PlayoffOdds (frontend/src/lib/api.ts).
export type PlayoffOddsTeam = {
  team_id: number;
  playoff_pct: number;
  title_pct: number;
  first_seed_pct: number;
  toilet_bowl_pct: number;
  last_place_pct: number;
  avg_seed: number;
  projected_wins: number;
  expected_score: number;
  ppg: number | null;
};
export type PlayoffOddsFocus = {
  team_id: number;
  games_left: number;
  win_out_pct: number | null;
  by_wins: { wins: number; games_left: number; pct: number; share: number }[];
  next_game: { matchup_id: number; week: number; opponent_team_id: number; if_win_pct: number | null; if_loss_pct: number | null } | null;
  root_for: { matchup_id: number; week: number; root_for_team_id: number; against_team_id: number; pct_if_root: number; pct_if_other: number; swing: number }[];
  // Every other game in the team's next week, biggest swing first.
  root_this_week?: PlayoffOddsFocus['root_for'];
  tiebreak: { tied_at_cut_pct: number; won_on_points_pct: number | null };
  // The realistic way in (backend playoff_odds._best_path).
  best_path: {
    target_wins: number;
    games_left: number;
    win_games: { matchup_id: number; week: number; opponent_team_id: number; win_pct: number }[];
    root_for: PlayoffOddsFocus['root_for'];
    path_pct: number;
  } | null;
};
export type PlayoffOdds = { sims: number; status: 'projected' | 'live'; teams: PlayoffOddsTeam[]; focus: PlayoffOddsFocus | null };


// GET /seasons/{season}/matchups/{id}/win-prob-history: how a matchup's
// win % moved (home side's view) and its turning points.
export type WinProbHistory = {
  points: { at: string; home_win_pct: number; home_score: number; away_score: number }[];
  turning_points: {
    at: string;
    home_win_pct_change: number;
    side: 'home' | 'away';
    player_name: string | null;
    points: number;
  }[];
};

// ---- Commissioner Tools overhaul (2026-10-23, backend app/routers/commish.py) ----

export type CommishNeed = {
  kind: 'trades' | 'lineups' | 'members' | 'inactive' | 'deadline';
  tone: 'orange' | 'red' | 'purple' | 'blue';
  title: string;
  sub: string;
  action: string;
  href: string;
  at?: string;
};

export type CommishSummary = {
  league: { id: number; name: string; invite_code: string; league_type: string; matchup_type: string; commish_log_public: boolean };
  needs_you: CommishNeed[];
  glance: {
    teams: number;
    matchups: string;
    scoring: string;
    week: number | null;
    last_regular_week: number | null;
    playoff_teams: number;
    playoff_start_week: number;
  };
  tools: Record<
    'league' | 'scoring' | 'roster' | 'waivers' | 'members' | 'calendar' | 'trades' | 'lineup' | 'draft' | 'polls' | 'rivalries' | 'chat_filter' | 'wheel' | 'espn' | 'corner',
    string
  >;
};

export type CommishMember = {
  user_id: number;
  display_name: string;
  photo_url?: string | null;
  role: 'commissioner' | 'member';
  joined_at: string | null;
  last_active_at: string | null;
  team: { team_id: number; team_name: string; wins: number; losses: number; ties: number } | null;
};

export type WaiverType = 'reverse' | 'rolling' | 'faab';

export type WaiverRules = {
  waiver_type: WaiverType;
  faab_budget: number;
  min_bid: number;
  clear_weekday: number;
  clear_hour: number;
  drop_days: number;
  hold_played: boolean;
  post_results: boolean;
  custom?: boolean;
};

export type CommishWaivers = { settings: WaiverRules; pending_claims: number; players_on_waivers: number; next_run_at: string | null };

export type CalendarItem = {
  key: 'keeper_deadline' | 'draft' | 'waivers' | 'trade_deadline' | 'regular_season_end' | 'playoffs_start' | 'championship' | 'next_keeper_deadline';
  title: string;
  at: string | null;
  week?: number | null;
  detail?: string;
  repeats?: string;
  editable: boolean;
  past: boolean;
  done?: boolean;
};

export type CommishCalendar = {
  season: number;
  items: CalendarItem[];
  week_kickoffs: Record<string, string>;
  waivers: WaiverRules;
  playoffs: { playoff_team_count: number; weeks_per_matchup: number; start_week: number | null; effective_start_week: number };
};

export type ReviewTradeSide = {
  team_id: number;
  team_name: string | null;
  ros_points: number;
  gets: { sleeper_player_id: string; name: string; position: string; pro_team: string | null; injury_status: string | null; ros_points: number }[];
};

export type ReviewTrade = {
  id: number;
  status: 'awaiting_review' | 'in_review';
  accepted_at: string | null;
  review_ends_at: string | null;
  note: string | null;
  veto_votes: number;
  sides: ReviewTradeSide[];
};

export type CommishTradeReview = { trades: ReviewTrade[]; settings: TradeSettings; from_week: number };

export type CommishChange = { id: number; area: string; summary: string; created_at: string; actor_user_id: number | null; actor_name: string };

export type ScheduledPost = { id: number; title: string; body: string; notify: boolean; send_at: string; created_at: string };

export type CommishAnnouncements = {
  scheduled: ScheduledPost[];
  recent: { id: number; title: string; body: string; created_at: string }[];
  conversation_id: number | null;
};

// The War Room (2026-10-27) — backend/app/routers/war_room.py; same
// shapes as the web's lib/warRoomApi.ts.
export type WarRoomPhase = 'keepers' | 'draft' | 'report_card' | 'dynasty';

export type WarRoomKeepers = {
  max_keepers: number;
  max_consecutive_years: number | null;
  deadline: string | null;
  locked: boolean;
  is_open: boolean;
  waiting_on: number;
  // players is null for someone else's keepers until they lock.
  managers: { owner_id: number; is_me: boolean; name: string; count: number; done: boolean; players: string[] | null }[];
};

export type WarRoomPlayer = { sleeper_player_id: string; name: string; position: string | null; team?: string | null };

export type WarRoomDraft = {
  status: 'not_set' | 'not_started' | 'in_progress' | 'paused' | 'complete';
  draft_type: string | null;
  scheduled_start: string | null;
  pick_seconds: number | null;
  team_count: number;
  rounds: number | null;
  my_slot: number | null;
  order: { owner_id: number; name: string }[];
  my_picks: {
    pick_number: number;
    round: number;
    round_pick: number;
    is_keeper: boolean;
    player_name: string | null;
    position: string | null;
  }[];
  next_pick: number | null;
  // "2.07", and how many picks are still to be made before it.
  next_pick_label?: string | null;
  picks_until?: number | null;
  likely_available: (WarRoomPlayer & { adp: number; chance: number })[];
  queue: (WarRoomPlayer & { adp: number | null })[];
  // Every queued player, drafted ones included (2026-10-28).
  queue_full?: WarRoomQueueItem[];
  // Starting spots still open, by position.
  needs?: { position: string; count: number }[];
  keepers_off_board: { owner_id: number; name: string; players: string[] }[];
};

// GET /war-room/mock: the board for a practice mock draft (2026-10-28).
export type MockPlayer = { id: string; name: string; position: string; team: string | null; adp: number };
export type MockBoard = {
  teams: number;
  rounds: number;
  my_slot: number | null;
  roster_slots: Record<string, number>;
  // False: no ADP yet, ranked by the season's player rank instead.
  uses_adp: boolean;
  queue: string[];
  players: MockPlayer[];
};

export type WarRoomQueueItem = WarRoomPlayer & {
  bye_week: number | null;
  adp: number | null;
  // Chance he lasts to your next pick; null once he's gone or without ADP.
  chance: number | null;
  taken_by: { name: string; pick: string } | null;
};

export type WarRoomDynasty = {
  avg_starter_age: number | null;
  starters_29_plus: number;
  ages: { position: string; young: number; prime: number; old: number }[];
  rookie_draft: { season: number; rounds: number; picks: string[]; projected: boolean; traded_away?: string[] };
  taxi: {
    size: number;
    players: { sleeper_player_id: string; name: string; position: string | null; team: string | null; age: number | null; years_exp: number | null }[];
  };
};

export type WarRoomHeadline = {
  owner_name: string;
  owner_id: number;
  round: number;
  player_name: string;
  position: string | null;
  position_rank: number | null;
  points: number;
};

export type WarRoomReportCard = {
  through_week: number | null;
  team_count: number;
  draft_day: { letter: string | null; rank: number | null };
  hindsight: { letter: string; rank: number } | null;
  narrative: string | null;
  picks: {
    pick_number: number;
    round: number;
    round_pick: number;
    is_keeper: boolean;
    sleeper_player_id: string;
    player_name: string;
    position: string | null;
    points: number;
    status: 'starter' | 'bench' | 'ir' | 'gone';
    tag: 'steal' | 'bust' | null;
  }[];
  best_pick: WarRoomHeadline | null;
  biggest_miss: WarRoomHeadline | null;
  keeper_watch: {
    slots: number;
    players: (WarRoomPlayer & { points: number; next_year: number; eligible: boolean; max_years: number | null })[];
  } | null;
};

export type WarRoom = {
  season: number;
  phase: WarRoomPhase;
  keepers: WarRoomKeepers | null;
  draft: WarRoomDraft;
  report_card: WarRoomReportCard | null;
  // Dynasty leagues only.
  dynasty?: WarRoomDynasty | null;
};
