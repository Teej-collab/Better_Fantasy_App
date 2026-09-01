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
  | "chug"
  | "keepers"
  | "powerRankings"
  | "draft"
  | "gamecast"
  | "playerResearch";

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
  // A fresh hue — doesn't render alongside any other destination in a
  // context where a collision would matter (own sub-nav tab only).
  keepers: { key: "keepers", label: "Keepers", color: "#10b981" },
  // Also fresh — sits in the same sub-nav row as Keepers above but a
  // clearly distinct blue, not close to indigo (League)/sky (Standings).
  powerRankings: { key: "powerRankings", label: "Power Rankings", color: "#3b82f6" },
  // Fresh hue — sits in the same My Team sub-nav row as Keepers/Free
  // Agents but distinct from both (emerald/teal), and from Rules'
  // lime.
  draft: { key: "draft", label: "Draft", color: "#eab308" },
  // Distinct red — Gamecast is the one destination that ever carries a
  // genuine "live" state of its own (as opposed to reflecting the
  // signed-in visitor's own matchup, like My Team/Matchups' LiveMark
  // does), so it gets a hue nothing else in this map uses.
  gamecast: { key: "gamecast", label: "Gamecast", color: "#ef4444" },
  // Not to be confused with "playerCards" (this league's own owners'
  // trading cards, at /players) — this is real NFL player research.
  // Violet since cyan (playerCards) and teal (freeAgents) are both
  // already spoken for by adjacent destinations.
  playerResearch: { key: "playerResearch", label: "Player Research", color: "#8b5cf6" },
};

// Static hrefs shared by every nav surface that needs one — the single
// place a route lives so LeagueSubNav, Home's Discover tiles, and
// /weekend's vacancy signs can't drift into three different subsets
// with three different href strings the way they used to (Power
// Rankings shipped in LeagueSubNav and was simply forgotten on the
// other two, since each kept its own hand-copied list). `awards` is
// deliberately absent — its href depends on the latest season
// (awardsHrefFor in lib/api.ts), so every caller that needs it passes
// that in separately rather than this map pretending it's static.
// `matchups`/`home` are also absent for the same reason (`matchups`
// depends on the current season/week; `home` is just "/").
export const DESTINATION_HREF: Partial<Record<DestinationKey, string>> = {
  team: "/team",
  league: "/league",
  standings: "/standings",
  playerCards: "/players",
  freeAgents: "/free-agents",
  chat: "/chat",
  rivalries: "/rivalries",
  rules: "/rules",
  chug: "/chug",
  keepers: "/keepers",
  powerRankings: "/power-rankings",
  draft: "/draft",
  gamecast: "/gamecast",
  playerResearch: "/player-research",
};

// The app's one accent color, everywhere something used to instead pick
// a different hardcoded hex per destination/section. Nav chrome
// (PrimaryNav, BottomNav, LeagueSubNav, MyTeamSubNav, ChatNavLink)
// resolves --nav-color to this — the active/hovered tab reads in the
// owner's own chosen accent (Settings > Appearance > Accent Color),
// with every other tab neutral at rest (see .neon-navlink in
// globals.css) — and lib/sectionColors.ts's SECTION_COLORS resolves
// every section's --panel-glow to this same value, so a page's panels
// and the homepage's section-dot markers agree with the nav bar rather
// than each carrying its own persistent color. Reversal of this file's
// original "every destination always lit in its own color" design, per
// the owner's 2026-08-31 request to calm the app down to one consistent
// accent instead of a rainbow. DESTINATIONS[key].color itself is left
// untouched (still used by components/settings/NavigationSection.tsx's
// bottom-nav reorder list, where telling items apart while dragging is
// genuinely useful) — only the app's live chrome/panels stopped reading
// it.
export const NAV_ACCENT = "var(--user-accent, var(--wl-accent))";

export const PRIMARY_NAV_ORDER: DestinationKey[] = ["team", "league", "home", "matchups", "gamecast", "chat"];

// The mobile bottom bar's 5 fixed slots (BottomNav.tsx) — this is the
// DEFAULT order only; an owner can reorder these 5 (never add/remove
// one) via Settings > Navigation, persisted as owner_preferences'
// bottom_nav_order.
export const MOBILE_NAV_ORDER: DestinationKey[] = ["team", "league", "home", "matchups", "chat"];

// League-family destinations — everything that's "browse the league,"
// as opposed to "manage my own roster" (My Team's own sub-nav:
// Roster/Keepers/Free Agents — see MyTeamSubNav.tsx). This is also the
// one list Home's Discover tiles and /weekend's vacancy signs both
// read from now, instead of each keeping its own copy.
export const LEAGUE_SUBNAV_ORDER: DestinationKey[] = [
  "league",
  "standings",
  "playerCards",
  "playerResearch",
  "awards",
  "rivalries",
  "rules",
  "chug",
  "powerRankings",
];

// My Team's own sub-nav (MyTeamSubNav.tsx) — the "my own roster"
// destinations, as opposed to LEAGUE_SUBNAV_ORDER's "browse the
// league" ones. `team` itself (labeled "Roster" there) is first but
// isn't repeated here since it's the page these tabs sit on top of,
// not a link to itself.
export const MY_TEAM_SUBNAV_ORDER: DestinationKey[] = ["draft", "keepers", "freeAgents"];

// /gamecast/[gameId] (a single game) is still deliberately absent from
// this config — a game_id has no stable identity between weeks, so a
// fixed link to one specific game would 404 outside its own live
// window. `gamecast` above points at the hub (app/(app)/gamecast/
// page.tsx), a real static nav destination that lists this week's live/
// upcoming/final games and links into whichever ones have a Gamecast —
// added 2026-08-31 after the audit found the feature had no
// discoverable entry point at all outside a live game's own ticker
// window, six days out of seven.
