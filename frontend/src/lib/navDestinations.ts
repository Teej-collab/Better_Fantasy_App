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
  | "awardsAllTime"
  | "history"
  | "trades";

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
  matchups: { key: "matchups", label: "Matchup", color: "#ec4899" },
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
  // Used to be reachable only two taps deep (League -> Awards -> the
  // All-Time Records tab inside SeasonTabs) instead of the one tap
  // every other League-family destination gets from this row —
  // 2026-08-31 audit. A muted gold, distinct from Awards' own bright
  // yellow but clearly in the same family (both real award/record
  // destinations sitting right next to each other in this row). No
  // longer in LEAGUE_SUBNAV_ORDER itself (folded into "history" below,
  // 2026-09-02) — kept as a real destination since the season Awards
  // page still links into it directly via SeasonTabs' own extra tab.
  awardsAllTime: { key: "awardsAllTime", label: "All-Time", color: "#ca8a04" },
  // A single tab for "look back at the league's past" — Awards,
  // Player Cards, and the lifetime Chug leaderboard, each previously
  // its own top-level League-sub-nav tab (2026-09-02 simplification,
  // 10 tabs down to 6 — see frontend/src/app/(app)/history/page.tsx).
  // Amber: distinct from Awards' yellow and All-Time's gold, but still
  // clearly in the same "records" family.
  history: { key: "history", label: "History", color: "#f59e0b" },
  // Fresh fuchsia — sits in the same My Team sub-nav row as Draft
  // (gold)/Keepers (emerald)/Free Agents (teal), distinct from all
  // three plus everything else in that row's line of sight.
  trades: { key: "trades", label: "Trades", color: "#d946ef" },
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
  history: "/history",
  trades: "/trades",
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

// Chat dropped 2026-09-02: no longer one of the reorderable tabs on
// either bar — it now lives as a fixed icon-only bubble next to the
// account menu in the header (see NavBar.tsx + ChatNavLink.tsx's
// "header" variant), the same place on every screen size, so it's
// never competing with these for one of a limited number of slots
// (the mobile bar was capped at 6 visible tabs, which the owner found
// crowded). DESTINATIONS.chat itself is untouched — the header bubble
// still reads its color and href from there.
export const PRIMARY_NAV_ORDER: DestinationKey[] = ["team", "league", "home", "matchups", "gamecast"];

// The fixed slots both the mobile bottom bar (BottomNav.tsx) and the
// desktop header (PrimaryNav.tsx) draw from — this is the DEFAULT order
// only; an owner can reorder these (never add/remove one) via
// Settings > Navigation, persisted as owner_preferences'
// bottom_nav_order and applied to both surfaces alike (2026-09-02: used
// to drive only the mobile bar, with desktop's order hardcoded and
// fixed — extended to desktop once it was clear both bars show the
// exact same six destinations, so one saved order should mean one nav
// order everywhere, not two independent settings). gamecast added
// 2026-09-02: it used to be reachable on mobile only via the Home
// page's Discover grid, with zero presence in the persistent nav at
// all — a real gap for a destination the 2026-09-02 re-audit
// specifically called out as strategically important (the app's one
// genuinely live, real-time feature). Same position relative to
// matchups as PRIMARY_NAV_ORDER above. Chat isn't in this list at all
// as of 2026-09-02 — see PRIMARY_NAV_ORDER's own comment above.
export const MOBILE_NAV_ORDER: DestinationKey[] = ["team", "league", "home", "matchups", "gamecast"];

// Shared by BottomNav.tsx and PrimaryNav.tsx — both render from an
// owner's saved order (bottom_nav_order) but must fall back to the
// default if it's missing, corrupted, or the wrong shape (e.g. saved
// before a slot was added/removed).
export function isValidNavOrder(order: string[]): order is DestinationKey[] {
  return (
    order.length === MOBILE_NAV_ORDER.length &&
    new Set(order).size === MOBILE_NAV_ORDER.length &&
    order.every((k) => (MOBILE_NAV_ORDER as string[]).includes(k))
  );
}

// League-family destinations — everything that's "browse the league,"
// as opposed to "manage my own roster" (My Team's own sub-nav:
// Roster/Keepers/Free Agents — see MyTeamSubNav.tsx). This is also the
// one list Home's Discover tiles and /weekend's vacancy signs both
// read from now, instead of each keeping its own copy.
//
// Down from ten entries to six as of 2026-09-02: Player Cards, Awards,
// All-Time, and Chug collapsed into the single "history" destination
// below (see frontend/src/app/(app)/history/page.tsx — a small hub
// linking out to those three existing, unchanged pages, not a new
// merged view); Player Research dropped entirely, confirmed to be a
// near-duplicate of Free Agents (My Team's own sub-nav) — same
// backend query, same filters/sort, Player Research's only real
// difference was including already-rostered players with no way to
// act on them, versus Free Agents' fuller "here's who you can actually
// add" view.
export const LEAGUE_SUBNAV_ORDER: DestinationKey[] = [
  "league",
  "standings",
  "powerRankings",
  "rivalries",
  "rules",
  "history",
];

// Primary/secondary split for LeagueSubNav.tsx's own two-tier layout —
// grouping is specific to how that one component presents these tabs,
// not a reordering of LEAGUE_SUBNAV_ORDER itself (Home's Discover grid
// still reads that flat list directly and has no concept of "primary").
// Exactly 3 tabs each side (2026-09-03 fix) — LeagueSubNav.tsx renders
// each side as a fixed 3-column grid, so this set's size must stay 3
// for the two rows to come out even; changing it requires updating
// LeagueSubNav's grid-cols count to match. Primary = "what's the
// current state of my league" (checked often, no extra tap).
export const LEAGUE_SUBNAV_PRIMARY = new Set<DestinationKey>([
  "league",
  "standings",
  "powerRankings",
]);

// My Team's own sub-nav (MyTeamSubNav.tsx) — the "my own roster"
// destinations, as opposed to LEAGUE_SUBNAV_ORDER's "browse the
// league" ones. `team` itself (labeled "Roster" there) is first but
// isn't repeated here since it's the page these tabs sit on top of,
// not a link to itself.
export const MY_TEAM_SUBNAV_ORDER: DestinationKey[] = ["draft", "keepers", "freeAgents", "trades"];

// /gamecast/[gameId] (a single game) is still deliberately absent from
// this config — a game_id has no stable identity between weeks, so a
// fixed link to one specific game would 404 outside its own live
// window. `gamecast` above points at the hub (app/(app)/gamecast/
// page.tsx), a real static nav destination that lists this week's live/
// upcoming/final games and links into whichever ones have a Gamecast —
// added 2026-08-31 after the audit found the feature had no
// discoverable entry point at all outside a live game's own ticker
// window, six days out of seven.
