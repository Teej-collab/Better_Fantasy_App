"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// Which primary destination a given URL belongs to — same pattern
// PageShell.tsx already uses (a small client component reading
// usePathname()) rather than a route-group layout, since these
// patterns cut across route groups (e.g. /owners/[id] and /teams/[id]
// are drill-downs reachable from several League pages, not their own
// primary section). /seasons/{s}/awards (League) and
// /seasons/{s}/weeks/{w} (Matchups) share a root segment, so this
// needs real patterns, not a simple prefix string.
export type NavSection = "team" | "league" | "matchups" | "chat" | "players";

const SECTION_PATTERNS: Record<NavSection, RegExp[]> = {
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
  ],
  matchups: [/^\/seasons\/[^/]+\/weeks\//, /^\/matchups\//],
  chat: [/^\/chat(\/|$)/],
  players: [/^\/free-agents(\/|$)/],
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
}: {
  href: string;
  section: NavSection;
  children: ReactNode;
  activeClassName: string;
  inactiveClassName: string;
}) {
  const pathname = usePathname();
  const active = isSectionActive(section, pathname);
  return (
    <a href={href} aria-current={active ? "page" : undefined} className={active ? activeClassName : inactiveClassName}>
      {children}
    </a>
  );
}
