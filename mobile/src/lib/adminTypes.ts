// Admin dashboard response shapes (backend/app/routers/admin.py),
// copied from the web's frontend/src/lib/api.ts.

export type AdminBadges = { crashes: number; errors: number; security: number };

export type CrashReport = {
  created_at: string;
  route: string | null;
  platform: string | null;
  display_name: string | null;
  metadata: {
    trail?: string;
    uptime_s?: number;
    silent_s?: number;
    os?: string;
    screen?: string;
    native?: boolean;
  };
};

export type AdminOverview = {
  window_days: number;
  total_users: number;
  new_users: number;
  active_users: number;
  total_leagues: number;
  active_leagues: number;
  total_owners_claimed: number;
  online_now: number;
  tracking_started_at: string | null;
};

export type AdminTimeseriesDay = { day: string; signups: number; events: number; active_owners: number };

export type AdminTimeseries = { window_days: number; days: AdminTimeseriesDay[] };

export type AdminActivityItem = { kind: 'signup' | 'league_created' | 'feedback'; label: string; created_at: string };

export type FeatureUsageRow = { event_name: string; uses: number; unique_owners: number };

export type FeatureUsage = { window_days: number; features: FeatureUsageRow[] };

export type EngagementDay = { day: string; dau: number; wau: number; mau: number };

export type AdminActivity = { activity: AdminActivityItem[] };

export type AdminAlert = { severity: 'info' | 'warning'; message: string };

export type AdminAlerts = { alerts: AdminAlert[] };

export type AdminSystemHealth = {
  db: { reachable: boolean; pool_size: number; pool_idle: number; pool_max: number };
  websocket_connections: { chat: number; draft: number; gamecast: number };
  uptime_seconds: number;
  jobs: Record<string, string>;
};

export type OnlineOwner = { owner_id: number; display_name: string };

export type AdminLive = {
  people: {
    owner_id: number;
    display_name: string;
    route: string | null;
    event_name: string | null;
    platform: string | null;
    device_type: string | null;
    last_seen: string | null;
    connected: boolean;
  }[];
  feed: {
    created_at: string;
    event_name: string;
    event_type: string;
    route: string | null;
    platform: string | null;
    device_type: string | null;
    display_name: string | null;
  }[];
  last_hour: { events: number; owners: number };
};

export type AdminEngagement = {
  window_days: number;
  timezone: string;
  summary: {
    dau: number;
    wau: number;
    mau: number;
    avg_dau: number;
    stickiness: number | null;
    sessions: number;
    avg_pages_per_session: number;
    median_session_seconds: number;
  };
  series: EngagementDay[];
  platforms: { platform: string; device_type: string; owners: number; events: number }[];
  when_active: { dow: number; hour: number; events: number }[];
  retention: { day: number; eligible: number; retained: number; rate: number | null }[];
  cohorts: { week: string; size: number; weeks: (number | null)[] }[];
  funnel: { step: string; label: string; count: number }[];
};

export type NavigationHeatmapRoute = { event_name: string; views: number; sessions: number; unique_owners: number };

export type NavigationHeatmap = { window_days: number; total_views: number; routes: NavigationHeatmapRoute[] };

export type AdminPaths = {
  window_days: number;
  transitions: { from_page: string; to_page: string; moves: number }[];
  entries: { event_name: string; sessions: number }[];
  exits: { event_name: string; sessions: number; bounces: number }[];
};

export type AdminUserStatus = 'all' | 'active' | 'inactive' | 'new' | 'commissioner' | 'multiple_leagues' | 'no_league';

export type AdminUserList = { total: number; users: AdminUserRow[] };

export type AdminUserRow = {
  user_id: number;
  owner_id: number | null;
  display_name: string;
  email: string | null;
  created_at: string;
  is_admin: boolean;
  league_count: number;
  is_commissioner_anywhere: boolean;
  last_active: string | null;
};

export type AdminUserActivityEvent = {
  event_name: string;
  event_type: string;
  route: string | null;
  metadata: Record<string, unknown>;
  device_type: string | null;
  platform: string | null;
  created_at: string;
};

export type AdminUserDetail = AdminUserRow & {
  leagues: { league_id: number; league_name: string; role: string; joined_at: string }[];
  recent_activity: AdminUserActivityEvent[];
  delete_blockers: string[];
};

export type AdminLeagueRow = { id: number; name: string; created_at: string; member_count: number; recent_events: number };

export type AdminLeagueList = { window_days: number; leagues: AdminLeagueRow[] };

export type AdminLeagueMember = {
  user_id: number;
  owner_id: number | null;
  display_name: string;
  role: string;
  joined_at: string;
  team_name: string | null;
  last_active: string | null;
  recent_events: number;
};

export type AdminLeagueDetail = {
  id: number;
  name: string;
  created_at: string;
  invite_code: string;
  members: AdminLeagueMember[];
};

export type CrashReports = {
  window_days: number;
  crashes: number;
  affected_owners: number;
  by_route: { route: string; crashes: number; affected_owners: number }[];
  by_device: { os: string; screen: string; crashes: number; affected_owners: number }[];
  recent: CrashReport[];
};

export type AdminErrorGroup = {
  fingerprint: string;
  source: 'client' | 'server';
  message: string;
  route: string | null;
  occurrences: number;
  affected: number;
  first_seen: string;
  last_seen: string;
  first_ever: string | null;
};

export type AdminErrors = {
  window_days: number;
  occurrences: number;
  server: number;
  client: number;
  kinds: number;
  groups: AdminErrorGroup[];
};

export type AdminErrorDetail = {
  fingerprint: string;
  occurrences: {
    created_at: string;
    source: 'client' | 'server';
    message: string;
    stack: string | null;
    route: string | null;
    method: string | null;
    status_code: number | null;
    platform: string | null;
    os: string | null;
    screen: string | null;
    who: string | null;
  }[];
  daily: { day: string; occurrences: number }[];
};

export type AdminSecurity = {
  window_days: number;
  by_kind: { kind: string; events: number; ips: number }[];
  top_ips: { ip: string; events: number; failed_logins: number; emails_tried: number; last_seen: string }[];
  top_paths: { path: string; kind: string; events: number }[];
  targeted_accounts: { email: string; failed_logins: number; ips: number; last_seen: string; real_account: boolean }[];
  recent: {
    created_at: string;
    kind: string;
    email: string | null;
    ip: string | null;
    method: string | null;
    path: string | null;
    user_agent: string | null;
    who: string | null;
  }[];
};

export type AdminAuditLog = {
  total: number;
  entries: {
    id: number;
    created_at: string;
    action: string;
    method: string;
    path: string;
    target: string | null;
    status_code: number;
    actor: string | null;
    actor_user_id: number | null;
  }[];
};
