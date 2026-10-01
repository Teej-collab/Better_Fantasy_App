// Friendly names for analytics event names, for the admin dashboard.
// Copied from the web's frontend/src/lib/analyticsEvents.ts, which
// mirrors backend/app/analytics/taxonomy.py.
const EVENT_LABELS: Record<string, string> = {
  nav_home: 'Home',
  nav_seasons: 'Awards / Season',
  nav_standings: 'Standings',
  nav_matchups: 'Matchups',
  nav_gamecast: 'Gamecast',
  nav_history: 'History',
  nav_rivalries: 'Rivalries',
  nav_rules: 'Rules',
  nav_power_rankings: 'Power Rankings',
  nav_draft: 'Draft',
  nav_keepers: 'Keepers',
  nav_free_agents: 'Free Agents',
  nav_trades: 'Trades',
  nav_teams: 'Team (other)',
  nav_team: 'My Team',
  nav_players: 'Player Cards',
  nav_leagues: 'Leagues',
  nav_league: 'League',
  nav_chat: 'Chat',
  nav_chug: 'Chug',
  nav_owners: 'Owner Profile',
  nav_settings: 'Settings',
  nav_commissioner: 'Commissioner Tools',
  nav_admin: 'Admin',
  nav_weekend: 'The Weekend',
  nav_login: 'Login',
  nav_other: 'Other',
  league_switched: 'League Switched',
  gamecast_game_selected: 'Gamecast Game Selected',
  app_crash: 'App Crash',
  recap_opened: 'Recap Opened',
};

export function eventLabel(eventName: string): string {
  return EVENT_LABELS[eventName] ?? eventName;
}
