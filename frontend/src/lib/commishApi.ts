// Commissioner Tools overhaul (2026-10-23, backend app/routers/commish.py):
// the hub, members, calendar, waivers, trade review, lineup notes,
// Commish Corner posts and the change log. Client-side, through the
// /api/backend proxy. Same shapes as the app's mobile/src/lib/types.ts.

export type CommishNeed = {
  kind: "trades" | "lineups" | "members" | "inactive" | "deadline";
  tone: "orange" | "red" | "purple" | "blue";
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
  tools: Record<string, string>;
};

export type CommishMember = {
  user_id: number;
  display_name: string;
  role: "commissioner" | "member";
  joined_at: string | null;
  last_active_at: string | null;
  team: { team_id: number; team_name: string; wins: number; losses: number; ties: number } | null;
};

export type WaiverType = "reverse" | "rolling" | "faab";

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
  key: "keeper_deadline" | "draft" | "waivers" | "trade_deadline" | "regular_season_end" | "playoffs_start" | "championship" | "next_keeper_deadline";
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
};

export type ReviewTrade = {
  id: number;
  status: "awaiting_review" | "in_review";
  accepted_at: string | null;
  review_ends_at: string | null;
  note: string | null;
  veto_votes: number;
  sides: {
    team_id: number;
    team_name: string | null;
    ros_points: number;
    gets: { sleeper_player_id: string; name: string; position: string; pro_team: string | null; injury_status: string | null; ros_points: number }[];
  }[];
};

export type CommishTradeReview = {
  trades: ReviewTrade[];
  settings: { review_mode: string; effective_veto_votes_needed: number; trade_deadline: string | null };
};

export type CommishChange = { id: number; area: string; summary: string; created_at: string; actor_user_id: number | null; actor_name: string };

export type CommishAnnouncements = {
  scheduled: { id: number; title: string; body: string; notify: boolean; send_at: string }[];
  recent: { id: number; title: string; body: string; created_at: string }[];
  conversation_id: number | null;
};

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/backend${path}`, {
    method,
    cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.detail ?? `${method} ${path} failed: ${res.status}`);
  }
  return res.json();
}

export const commishApi = {
  summary: () => call<CommishSummary>("GET", "/league/commish/summary"),
  members: () => call<{ league_id: number; invite_code: string; me: number; members: CommishMember[] }>("GET", "/league/commish/members"),
  calendar: () => call<CommishCalendar>("GET", "/league/commish/calendar"),
  trades: () => call<CommishTradeReview>("GET", "/league/commish/trades"),
  reviewTrade: (tradeId: number, approve: boolean, reason?: string) =>
    call<unknown>("POST", `/trades/${tradeId}/review`, { approve, reason: reason || null }),
  waivers: () => call<CommishWaivers>("GET", "/league/commish/waivers"),
  saveWaivers: (rules: WaiverRules) => call<{ settings: WaiverRules }>("PUT", "/league/commish/waivers", rules),
  runWaivers: () => call<{ players: number; claims_won: number }>("POST", "/league/commish/waivers/run", {}),
  lineupNote: (teamId: number, note: string) => call<{ sent: boolean }>("POST", "/league/commish/lineup-note", { team_id: teamId, note }),
  announcements: () => call<CommishAnnouncements>("GET", "/league/commish/announcements"),
  post: (title: string, body: string, notify: boolean, sendAt: string | null) =>
    call<{ scheduled_id: number | null; message_id: number | null }>("POST", "/league/commish/announcements", { title, body, notify, send_at: sendAt }),
  cancelPost: (id: number) => call<unknown>("DELETE", `/league/commish/announcements/${id}`),
  log: () => call<{ public: boolean; changes: CommishChange[] }>("GET", "/league/commish/log"),
  setLogPublic: (isPublic: boolean) => call<{ public: boolean }>("PUT", "/league/commish/log/visibility", { public: isPublic }),
  leagueChanges: () => call<{ public: boolean; changes: CommishChange[] }>("GET", "/league/changes"),
  tradeSettings: () =>
    call<{ season: number; trade_deadline: string | null; review_required: boolean; review_mode: string | null; review_hours: number; veto_votes_needed: number | null }>(
      "GET",
      "/trades/settings",
    ),
  saveTradeDeadline: (
    s: { season: number; review_required: boolean; review_mode: string | null; review_hours: number; veto_votes_needed: number | null },
    deadline: string | null,
  ) =>
    call<unknown>("PUT", "/trades/settings", {
      season: s.season,
      trade_deadline: deadline,
      review_required: s.review_required,
      review_mode: s.review_mode,
      review_hours: s.review_hours,
      veto_votes_needed: s.veto_votes_needed,
    }),
};

export const TONES = { orange: "#f97316", red: "#f87171", purple: "#a78bfa", blue: "#38bdf8", yellow: "#facc15", green: "#4ade80" } as const;

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "Not set";
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function relative(iso: string | null | undefined): string {
  if (!iso) return "";
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days > 13) return `In ${Math.round(days / 7)} weeks`;
  if (days > 0) return `In ${days} days`;
  if (days < -13) return `${Math.round(-days / 7)} weeks ago`;
  return `${-days} days ago`;
}
