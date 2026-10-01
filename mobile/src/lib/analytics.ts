import { usePathname } from 'expo-router';
import { useEffect } from 'react';
import { AppState, Dimensions, PixelRatio, Platform } from 'react-native';

import { hasSessionToken, sendQuietly } from '@/lib/api';

// The app's half of the analytics the web already sends (frontend/src/
// lib/analyticsEvents.ts → POST /admin/track), so the admin dashboard
// counts iPhone use alongside the web's. Each screen is logged under
// the web route it matches, so a page reads the same in Admin >
// Navigation however it was opened, and `platform` tells them apart.
// Event names must stay inside backend/app/analytics/taxonomy.py; it
// rejects anything else.

// Same prefixes and order as the web's classifyRoute and the backend's
// _ROUTE_PREFIXES.
const ROUTE_PREFIXES: [string, string][] = [
  ['/seasons', 'nav_seasons'],
  ['/standings', 'nav_standings'],
  ['/matchups', 'nav_matchups'],
  ['/gamecast', 'nav_gamecast'],
  ['/history', 'nav_history'],
  ['/rivalries', 'nav_rivalries'],
  ['/rules', 'nav_rules'],
  ['/power-rankings', 'nav_power_rankings'],
  ['/draft', 'nav_draft'],
  ['/keepers', 'nav_keepers'],
  ['/free-agents', 'nav_free_agents'],
  ['/trades', 'nav_trades'],
  ['/teams', 'nav_teams'],
  ['/team', 'nav_team'],
  ['/players', 'nav_players'],
  ['/leagues', 'nav_leagues'],
  ['/league', 'nav_league'],
  ['/chat', 'nav_chat'],
  ['/chug', 'nav_chug'],
  ['/owners', 'nav_owners'],
  ['/settings', 'nav_settings'],
  ['/commissioner', 'nav_commissioner'],
  ['/admin', 'nav_admin'],
  ['/weekend', 'nav_weekend'],
  ['/login', 'nav_login'],
];

export function classifyRoute(path: string): string {
  if (path === '/' || path === '') return 'nav_home';
  for (const [prefix, name] of ROUTE_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return name;
  }
  return 'nav_other';
}

// League tab sections → the web pages they're ports of.
export const LEAGUE_SECTION_ROUTES: Record<string, string> = {
  league: '/league',
  standings: '/standings',
  powerRankings: '/power-rankings',
  rivalries: '/rivalries',
  rules: '/rules',
  history: '/history',
  activity: '/activity',
};

// A native screen's path → the web route it matches. Paths the web
// shares as-is (/team, /chat, /draft, /gamecast/…, /settings,
// /commissioner/…, /admin/…, /keepers, /trades, /chug, /lounge) pass through.
export function webRouteFor(pathname: string): string {
  const swaps: [RegExp, string][] = [
    [/^\/players$/, '/free-agents'], // the Players tab is the web's Free Agents
    [/^\/waivers$/, '/free-agents'],
    [/^\/player\/(.+)$/, '/players/$1'],
    [/^\/cards$/, '/players'], // Player Cards
    [/^\/matchup\/(.+)$/, '/matchups/$1'],
    [/^\/owner\/(.+)$/, '/owners/$1'],
    [/^\/team\/(.+)$/, '/teams/$1'],
    [/^\/awards\/(.+)$/, '/seasons/$1/awards'],
    [/^\/draft-grades\/(.+)$/, '/seasons/$1/draft'],
    [/^\/watch-party(\/.*)?$/, '/chat'], // watch parties live inside Chat on the web
    [/^\/sign-in$/, '/login'],
  ];
  for (const [re, to] of swaps) if (re.test(pathname)) return pathname.replace(re, to);
  return pathname;
}

// ---- Session (one "visit") ----------------------------------------------

// A new visit after this long in the background, like a new tab on the web.
const SESSION_IDLE_MS = 30 * 60 * 1000;

function newSessionId(): string {
  // Not security-sensitive — just groups one visit's events together.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

let sessionId = newSessionId();
let backgroundedAt: number | null = null;
let lastRoute: string | null = null;

const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';
const deviceType = Platform.OS === 'ios' && Platform.isPad ? 'tablet' : 'mobile';

export function trackPageView(route: string): void {
  // Signed-out screens aren't counted (the backend drops them anyway).
  if (route === lastRoute || !hasSessionToken()) return;
  lastRoute = route;
  send(route);
}

function send(route: string) {
  sendQuietly('/admin/track', {
    session_id: sessionId,
    event_name: classifyRoute(route),
    event_type: 'page_view',
    route,
    device_type: deviceType,
    platform,
  });
}

// The curated feature events (taxonomy.py's FEATURE_EVENTS).
export function trackGamecastGameSelected(gameId: string): void {
  if (!hasSessionToken()) return;
  sendQuietly('/admin/track', {
    session_id: sessionId,
    event_name: 'gamecast_game_selected',
    event_type: 'feature',
    metadata: { game_id: gameId },
    device_type: deviceType,
    platform,
  });
}

// Logs every screen change, under its web route. The League tab logs
// its own sections (they aren't separate screens), so it's skipped here.
// `signedIn` re-runs it once a saved session finishes loading at launch.
export function useScreenTracking(signedIn: boolean): void {
  const pathname = usePathname();
  useEffect(() => {
    if (!signedIn) {
      lastRoute = null; // so the same screen logs again after signing back in
      return;
    }
    if (pathname === '/league') return;
    trackPageView(webRouteFor(pathname));
  }, [pathname, signedIn]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        backgroundedAt = Date.now();
      } else if (state === 'active' && backgroundedAt !== null) {
        const idle = Date.now() - backgroundedAt;
        backgroundedAt = null;
        if (idle > SESSION_IDLE_MS) {
          // A fresh visit starts on whatever screen is open.
          sessionId = newSessionId();
          if (lastRoute && hasSessionToken()) send(lastRoute);
        }
      }
    });
    return () => sub.remove();
  }, []);
}

// ---- Errors -------------------------------------------------------------

// Same filtering as the web's errorReporter: one report per message per
// launch, at most MAX_PER_LAUNCH, and network drops aren't bugs.
const MAX_PER_LAUNCH = 10;
const IGNORED = [/Network request failed/i, /Failed to fetch/i, /The network connection was lost/i, /AbortError/i, /Aborted/i, /timed out/i];
const reported = new Set<string>();

function osVersion(): string {
  return Platform.OS === 'ios' ? `iOS ${Platform.Version}` : Platform.OS === 'android' ? `Android ${Platform.Version}` : 'other';
}

function screenSize(): string {
  const { width, height } = Dimensions.get('screen');
  return `${Math.round(width)}x${Math.round(height)}@${PixelRatio.get()}`;
}

// Sends a JavaScript error to Admin > Errors (POST /admin/client-error).
export function reportClientError(error: unknown, fallbackMessage = 'Unknown error'): void {
  try {
    const err = error instanceof Error ? error : null;
    const message = (err ? `${err.name}: ${err.message}` : typeof error === 'string' ? error : fallbackMessage).slice(0, 2000);
    if (IGNORED.some((re) => re.test(message))) return;
    if (reported.has(message) || reported.size >= MAX_PER_LAUNCH) return;
    reported.add(message);
    sendQuietly('/admin/client-error', {
      message,
      stack: err?.stack?.slice(0, 20000) ?? null,
      route: lastRoute?.slice(0, 500) ?? null,
      platform,
      os: osVersion(),
      screen: screenSize(),
    });
  } catch {
    // Reporting must never throw into the app.
  }
}

type ErrorHandler = (error: unknown, isFatal?: boolean) => void;
type ErrorUtilsShape = { getGlobalHandler: () => ErrorHandler; setGlobalHandler: (h: ErrorHandler) => void };

// Catches uncaught JavaScript errors app-wide, then hands them on to
// React Native's own handler (the red screen in development).
let errorReporterStarted = false;
export function startErrorReporter(): void {
  if (errorReporterStarted) return;
  errorReporterStarted = true;
  const utils = (globalThis as { ErrorUtils?: ErrorUtilsShape }).ErrorUtils;
  if (!utils) return;
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, isFatal) => {
    reportClientError(error, isFatal ? 'Fatal error' : 'Uncaught error');
    previous(error, isFatal);
  });
}
