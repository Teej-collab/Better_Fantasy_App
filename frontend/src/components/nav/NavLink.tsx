"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";

// Which primary destination a given URL belongs to — same pattern
// PageShell.tsx already uses (a small client component reading
// usePathname()) rather than a route-group layout, since these
// patterns cut across route groups (e.g. /owners/[id] and /teams/[id]
// are drill-downs reachable from several League pages, not their own
// primary section). /seasons/{s}/awards (League) and
// /seasons/{s}/weeks/{w} (Matchups) share a root segment, so this
// needs real patterns, not a simple prefix string.
export type NavSection = "team" | "league" | "home" | "matchups" | "gamecast" | "chat" | "more";

const SECTION_PATTERNS: Record<NavSection, RegExp[]> = {
  // Exact root only — a prefix match here would light up Home on every
  // route in the app, not just "/" itself.
  home: [/^\/$/],
  team: [/^\/team(\/|$)/],
  league: [
    /^\/league(\/|$)/,
    /^\/standings(\/|$)/,
    /^\/players(\/|$)/,
    /^\/rivalries(\/|$)/,
    /^\/rules(\/|$)/,
    /^\/seasons\/[^/]+\/awards(\/|$)/,
    /^\/owners\//,
    /^\/teams\//,
    /^\/power-rankings(\/|$)/,
    /^\/chug(\/|$)/,
  ],
  matchups: [/^\/seasons\/[^/]+\/weeks\//, /^\/matchups\//],
  gamecast: [/^\/gamecast(\/|$)/],
  chat: [/^\/chat(\/|$)/],
  // Beta nav's catch-all tab (Documentation/UX/02_Information_Architecture.md)
  // — everything that moved out of a dedicated top-level slot to make
  // room for Chat: My Team's own sub-nav destinations, Gamecast,
  // Settings, and League Management. Independent of the legacy "team"/
  // "gamecast" patterns above — the two nav trees never render at the
  // same time (gated by beta_layout), so there's no conflict in a
  // route matching both.
  more: [
    /^\/more(\/|$)/,
    /^\/team(\/|$)/,
    /^\/draft(\/|$)/,
    /^\/keepers(\/|$)/,
    /^\/free-agents(\/|$)/,
    /^\/trades(\/|$)/,
    /^\/gamecast(\/|$)/,
    /^\/settings(\/|$)/,
    /^\/commissioner(\/|$)/,
  ],
};

export function isSectionActive(section: NavSection, pathname: string): boolean {
  return SECTION_PATTERNS[section].some((pattern) => pattern.test(pathname));
}

export function NavLink({
  href,
  section,
  children,
  activeClassName,
  inactiveClassName,
  color,
  cosmicColor,
  onNavigate,
}: {
  href: string;
  section: NavSection;
  children: ReactNode;
  activeClassName: string;
  inactiveClassName: string;
  // This tab's own color from the shared neon palette (lib/
  // neonPalette.ts) — drives .neon-navlink's hover/active glow
  // (globals.css) via the --nav-color custom property.
  color: string;
  // This tab's real per-destination color (DESTINATIONS[key].color,
  // lib/navDestinations.ts) — only takes effect under Settings >
  // Appearance > Look = Cosmic (see globals.css's
  // [data-wl-theme="cosmic"] .neon-navlink rule); Calm ignores this
  // entirely and always renders `color` above.
  cosmicColor?: string;
  // Fires on click, in addition to the real navigation — every other
  // caller (the persistent header/bottom bars) has nothing to do here,
  // so this stays optional; MobileNavDrawer.tsx is the one caller that
  // needs to close itself when one of its own links is tapped.
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = isSectionActive(section, pathname);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={`neon-navlink ${active ? activeClassName : inactiveClassName}`}
      style={{ ["--nav-color" as string]: color, ["--nav-color-cosmic" as string]: cosmicColor }}
    >
      {children}
    </Link>
  );
}
