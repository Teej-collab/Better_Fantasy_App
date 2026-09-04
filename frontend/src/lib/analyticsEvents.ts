import { trackAnalyticsEvent } from "@/lib/api";

// The frontend half of the app's one analytics taxonomy — mirrors
// backend/app/analytics/taxonomy.py exactly (that copy is
// authoritative for validation; this one is what decides which
// event_name a trackEvent() call actually sends). See
// ANALYTICS_EVENTS.md at the repo root for the human-readable
// version of this same taxonomy.
//
// Two event types for Phase 1: "page_view" (one per real route,
// classified automatically from the URL below — kept in lockstep with
// lib/navDestinations.ts's own DESTINATIONS/DESTINATION_HREF map) and
// "feature" (a small, deliberately curated set of real product
// interactions, NOT a raw click logger — see FEATURE_EVENTS below).

export type EventType = "page_view" | "feature";

// Order matters — longer/more specific prefixes first, since several
// destinations are dynamic routes ("/matchups/123") that only a
// startsWith check can classify. Mirrors backend/app/analytics/
// taxonomy.py's _ROUTE_PREFIXES exactly.
const ROUTE_PREFIXES: [string, string][] = [
  ["/seasons", "nav_seasons"],
  ["/standings", "nav_standings"],
  ["/matchups", "nav_matchups"],
  ["/gamecast", "nav_gamecast"],
  ["/history", "nav_history"],
  ["/rivalries", "nav_rivalries"],
  ["/rules", "nav_rules"],
  ["/power-rankings", "nav_power_rankings"],
  ["/draft", "nav_draft"],
  ["/keepers", "nav_keepers"],
  ["/free-agents", "nav_free_agents"],
  ["/trades", "nav_trades"],
  ["/teams", "nav_teams"],
  ["/team", "nav_team"],
  ["/players", "nav_players"],
  ["/leagues", "nav_leagues"],
  ["/league", "nav_league"],
  ["/chat", "nav_chat"],
  ["/chug", "nav_chug"],
  ["/owners", "nav_owners"],
  ["/settings", "nav_settings"],
  ["/commissioner", "nav_commissioner"],
  ["/admin", "nav_admin"],
  ["/weekend", "nav_weekend"],
  ["/login", "nav_login"],
];

const FALLBACK_EVENT_NAME = "nav_other";

export function classifyRoute(path: string): string {
  if (path === "/" || path === "") return "nav_home";
  for (const [prefix, name] of ROUTE_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return name;
  }
  return FALLBACK_EVENT_NAME;
}

// Coarse, cheap classification — not full device/UA parsing, just
// enough to answer "mobile vs. desktop" and "is this the installed
// PWA" in the admin dashboard, matching backend/app/analytics/
// taxonomy.py's ALLOWED_DEVICE_TYPES/ALLOWED_PLATFORMS enums exactly
// (the backend rejects anything else).
export function detectDeviceType(): "mobile" | "tablet" | "desktop" {
  if (typeof window === "undefined") return "desktop";
  const w = window.innerWidth;
  if (w < 640) return "mobile";
  if (w < 1024) return "tablet";
  return "desktop";
}

export function detectPlatform(): "ios" | "android" | "web" {
  if (typeof navigator === "undefined") return "web";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "web";
}

// One id per browser tab's lifetime — regenerated on a full reload,
// not persisted across tabs/devices (sessionStorage, not localStorage:
// a new tab is a new session, matching how "session" reads intuitively
// for a visit). crypto.randomUUID() is supported in every browser this
// PWA already requires for push notifications (VAPID), so no fallback
// needed.
let cachedSessionId: string | null = null;

export function getSessionId(): string {
  if (cachedSessionId) return cachedSessionId;
  if (typeof window === "undefined") return "server";
  try {
    const existing = window.sessionStorage.getItem("wl_session_id");
    if (existing) {
      cachedSessionId = existing;
      return existing;
    }
    const fresh = crypto.randomUUID();
    window.sessionStorage.setItem("wl_session_id", fresh);
    cachedSessionId = fresh;
    return fresh;
  } catch {
    // Private browsing / storage blocked — a fresh id per call still
    // lets the event through, just without cross-call session
    // grouping for this one visitor.
    return crypto.randomUUID();
  }
}

// The public entry points every call site actually uses —
// PageViewTracker.tsx calls trackPageView once per route change; the
// two real feature-event call sites (league switch, Gamecast game
// selection) call the two functions below. All three route through
// trackAnalyticsEvent (lib/api.ts), which never throws. A small,
// deliberately curated set — grow it only when a real product
// question needs another one, and add the matching entry to
// backend/app/analytics/taxonomy.py's FEATURE_EVENTS at the same time
// (the backend independently rejects anything not listed there).
export function trackPageView(pathname: string): void {
  void trackAnalyticsEvent({
    session_id: getSessionId(),
    event_name: classifyRoute(pathname),
    event_type: "page_view",
    route: pathname,
    device_type: detectDeviceType(),
    platform: detectPlatform(),
  });
}

function trackFeature(eventName: string, metadata: Record<string, unknown>): void {
  void trackAnalyticsEvent({
    session_id: getSessionId(),
    event_name: eventName,
    event_type: "feature",
    metadata,
    device_type: detectDeviceType(),
    platform: detectPlatform(),
  });
}

export function trackLeagueSwitched(toLeagueId: number): void {
  trackFeature("league_switched", { to_league_id: toLeagueId });
}

export function trackGamecastGameSelected(gameId: string): void {
  trackFeature("gamecast_game_selected", { game_id: gameId });
}

// Human-readable labels for the admin dashboard — every event_name
// this taxonomy can produce (NAV_EVENT_NAMES + FEATURE_EVENTS' keys)
// gets a real label here, not a raw "nav_power_rankings" string on
// screen. Kept as one lookup rather than string-manipulating the
// event_name (title-casing "nav_other" reads worse than "Other"), and
// deliberately exhaustive-in-spirit: a name missing from this map
// falls back to the raw event_name itself rather than crashing.
const EVENT_LABELS: Record<string, string> = {
  nav_home: "Home",
  nav_seasons: "Awards / Season",
  nav_standings: "Standings",
  nav_matchups: "Matchups",
  nav_gamecast: "Gamecast",
  nav_history: "History",
  nav_rivalries: "Rivalries",
  nav_rules: "Rules",
  nav_power_rankings: "Power Rankings",
  nav_draft: "Draft",
  nav_keepers: "Keepers",
  nav_free_agents: "Free Agents",
  nav_trades: "Trades",
  nav_teams: "Team (other)",
  nav_team: "My Team",
  nav_players: "Player Cards",
  nav_leagues: "Leagues",
  nav_league: "League",
  nav_chat: "Chat",
  nav_chug: "Chug",
  nav_owners: "Owner Profile",
  nav_settings: "Settings",
  nav_commissioner: "Commissioner Tools",
  nav_admin: "Admin",
  nav_weekend: "The Weekend",
  nav_login: "Login",
  nav_other: "Other",
  league_switched: "League Switched",
  gamecast_game_selected: "Gamecast Game Selected",
};

export function eventLabel(eventName: string): string {
  return EVENT_LABELS[eventName] ?? eventName;
}
