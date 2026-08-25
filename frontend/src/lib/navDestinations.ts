// The single source of truth for "what color means what section,"
// replacing four independently-hand-rolled copies that used to
// disagree with each other (SECTION_COLORS, PrimaryNav/BottomNav's own
// TAB_COLOR, LeagueSubNav's own TAB_COLOR, and a hardcoded copy in
// rules/page.tsx + the homepage) — the same destination used to render
// in a different color depending on which nav element you looked at
// (e.g. "League" was indigo in one place, blue in another, green in a
// third). Every nav surface (PrimaryNav, BottomNav, LeagueSubNav,
// ChatNavLink, the homepage) now imports its colors from here instead
// of maintaining its own map.
//
// 11 real destinations, only 7 hues in the Accent Color picker's neon
// palette (lib/neonPalette.ts) — that palette is a different concern
// (the owner's personal --user-accent choice) and isn't mechanically
// reused here, since forcing 11 destinations through 7 swatches would
// mean perceptually-adjacent duplicates. A few of these hues are new
// (Free Agents' teal, Rules' lime) specifically to resolve collisions
// between destinations that render on screen at the same time — see
// each entry's comment for why.
export type DestinationKey =
  | "team"
  | "league"
  | "home"
  | "standings"
  | "matchups"
  | "playerCards"
  | "freeAgents"
  | "chat"
  | "awards"
  | "rivalries"
  | "rules"
  | "chug";

export type Destination = {
  key: DestinationKey;
  label: string;
  color: string;
};

export const DESTINATIONS: Record<DestinationKey, Destination> = {
  team: { key: "team", label: "My Team", color: "#a855f7" },
  // Home isn't "owned" by any one topic the way every other destination
  // here is — a clean neutral white/silver glow instead of stealing a
  // hue from something it isn't, matching the existing "White/Neutral"
  // chat-color preset (ProfileSection.tsx) as this app's one other
  // established "no particular section" identity.
  home: { key: "home", label: "Home", color: "#f5f4ec" },
  // Was rendered as blue in PrimaryNav/BottomNav, green in LeagueSubNav's
  // "Overview" tab, and indigo in SECTION_COLORS/the League page's own
  // panel glow — indigo wins since it never collided with anything else.
  league: { key: "league", label: "League", color: "#6366f1" },
  standings: { key: "standings", label: "Standings", color: "#0ea5e9" },
  matchups: { key: "matchups", label: "Matchups", color: "#ec4899" },
  playerCards: { key: "playerCards", label: "Player Cards", color: "#22d3ee" },
  // The primary nav's "Players" tab (-> /free-agents) and LeagueSubNav's
  // "Player Cards" tab (-> /players) are different destinations that
  // render on screen at the same time on any League-family page, but
  // used to share the same cyan by accident. New teal + a clearer label
  // ("Free Agents" instead of "Players") resolves both the color and
  // the naming collision at once.
  freeAgents: { key: "freeAgents", label: "Free Agents", color: "#14b8a6" },
  // Was #39ff14 in nav chrome but #84cc16 in SECTION_COLORS (chat
  // bubbles, PlayByPlay panels) — the nav chrome's green wins.
  chat: { key: "chat", label: "Chat", color: "#39ff14" },
  // Was #fbbf24 in SECTION_COLORS/the homepage but #facc15 in
  // LeagueSubNav — LeagueSubNav's yellow wins.
  awards: { key: "awards", label: "Awards", color: "#facc15" },
  rivalries: { key: "rivalries", label: "Rivalries", color: "#f97316" },
  // Was purple in LeagueSubNav, SECTION_COLORS, and rules/page.tsx's own
  // hardcoded copy — colliding with My Team, which also renders at the
  // same time in the header. Lime frees purple back to being
  // exclusively My Team's.
  rules: { key: "rules", label: "Rules", color: "#84cc16" },
  // Was pink in LeagueSubNav specifically — colliding with Matchups,
  // which renders in the primary nav at the same time. Unifies onto
  // SECTION_COLORS' existing amber instead.
  chug: { key: "chug", label: "Chug", color: "#d97706" },
};

export const PRIMARY_NAV_ORDER: DestinationKey[] = ["team", "league", "home", "matchups", "chat", "freeAgents"];

// The mobile bottom bar's 5 fixed slots (BottomNav.tsx) — this is the
// DEFAULT order only; an owner can reorder these 5 (never add/remove
// one) via Settings > Navigation, persisted as owner_preferences'
// bottom_nav_order. Free Agents is deliberately not a candidate here
// (see LEAGUE_SUBNAV_ORDER below) — the mobile "More" sheet that used
// to hold it is gone entirely, not replaced by a slot choice.
export const MOBILE_NAV_ORDER: DestinationKey[] = ["team", "league", "home", "matchups", "chat"];

// Free Agents moved in here (was mobile's "More" sheet's only entry
// with no other mobile path once that sheet was removed) — every
// other former More-sheet destination (Standings, Awards, Rivalries,
// Rules, Chug) was already reachable through this same sub-nav once on
// any League-family page.
export const LEAGUE_SUBNAV_ORDER: DestinationKey[] = [
  "league",
  "standings",
  "playerCards",
  "freeAgents",
  "awards",
  "rivalries",
  "rules",
  "chug",
];

// /gamecast/[gameId] is deliberately absent from this config — it's
// reachable only via the live ticker's dynamic linking (see
// lib/gamecastApi.ts's withGamecastLinks), never a static nav entry.
// A game_id has no stable identity between weeks (it's whatever the
// live provider issues that week), so a fixed nav link would 404
// outside a live window rather than genuinely browse to something.
