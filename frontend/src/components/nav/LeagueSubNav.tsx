"use client";

import { useState } from "react";
import Link from "next/link";
import {
  DESTINATIONS,
  DESTINATION_HREF,
  LEAGUE_SUBNAV_ORDER,
  LEAGUE_SUBNAV_PRIMARY,
  NAV_ACCENT,
  type DestinationKey,
} from "@/lib/navDestinations";

export type LeagueTab = Exclude<DestinationKey, "team" | "home" | "matchups" | "chat" | "keepers" | "freeAgents">;

// "League" reads fine as a top-level destination, but repeating the
// same word as the first tab *inside* the page you already tapped
// "League" to reach ("League > League") is redundant — this is the
// only label override any tab here needs.
const LABEL_OVERRIDE: Partial<Record<LeagueTab, string>> = {
  league: "Overview",
};

/**
 * Rendered manually at the top of each League-family page (League,
 * Standings, Player Cards, Awards, Rivalries, Rules, Chug, Power
 * Rankings) rather than via a shared route-group layout — keeps this
 * additive (one line per page) instead of restructuring how those
 * routes are organized. No usePathname() needed: each page already
 * knows which tab it is, so `active` is just passed in directly.
 * `‹ League` only shows on mobile (sm:hidden) — desktop already has
 * "League" one click away in the primary header, this is purely the
 * mobile "how do I get back" affordance from spec §23.
 *
 * Two-tier since 2026-09-02: LEAGUE_SUBNAV_PRIMARY (lib/
 * navDestinations.ts) always shows; everything else collapses behind
 * a "More" toggle. The flat 10-tab single row had no hierarchy at all
 * (2026-09-02 re-audit's Critical Issue #4) — this is what makes the
 * component a client component now (needs local open/closed state),
 * it was a plain server component before. Auto-expanded whenever the
 * current page's own active tab is one of the secondary ones, so a
 * page you're already on is never hidden behind its own collapsed
 * toggle.
 */
export function LeagueSubNav({ active, awardsHref }: { active: LeagueTab; awardsHref: string }) {
  // awardsAllTime's href is derived from awardsHref the same reason
  // awards' own is passed in rather than living in DESTINATION_HREF —
  // both depend on the latest season, which this component doesn't
  // know on its own. Used to be reachable only two taps deep (League ->
  // Awards -> the All-Time Records tab inside SeasonTabs) — 2026-08-31
  // audit.
  const tabs = (LEAGUE_SUBNAV_ORDER as LeagueTab[]).map((key) => ({
    key,
    href: key === "awards" ? awardsHref : key === "awardsAllTime" ? `${awardsHref}/all-time` : DESTINATION_HREF[key]!,
  }));
  const primaryTabs = tabs.filter((tab) => LEAGUE_SUBNAV_PRIMARY.has(tab.key));
  const secondaryTabs = tabs.filter((tab) => !LEAGUE_SUBNAV_PRIMARY.has(tab.key));
  const activeIsSecondary = secondaryTabs.some((tab) => tab.key === active);

  const [expanded, setExpanded] = useState(activeIsSecondary);

  function tabLink(tab: { key: LeagueTab; href: string }) {
    return (
      <Link
        key={tab.key}
        href={tab.href}
        aria-current={tab.key === active ? "page" : undefined}
        className="neon-navlink shrink-0 rounded-full px-3 py-1.5 text-sm font-medium"
        style={{
          ["--nav-color" as string]: NAV_ACCENT,
          ["--nav-color-cosmic" as string]: DESTINATIONS[tab.key].color,
        }}
      >
        {LABEL_OVERRIDE[tab.key] ?? DESTINATIONS[tab.key].label}
      </Link>
    );
  }

  return (
    <div className="mb-4 flex flex-col gap-2">
      <Link
        href="/league"
        className="flex w-fit items-center gap-1 text-sm text-black/50 sm:hidden dark:text-white/50"
      >
        ‹ League
      </Link>
      <nav aria-label="League sections" className="flex flex-col gap-1.5">
        {/* flex-wrap, not overflow-x-auto — on a narrow mobile viewport,
            4 primary tabs plus the "More" toggle don't fit on one line
            (a real, measured overflow: the toggle button landed at
            x:436 on a 430px-wide iPhone 16 Pro Max), and a scrolling row
            with no visible affordance meant "More" — the only way to
            reach the other 6 League destinations — was effectively
            undiscoverable. Wrapping keeps every tab, including the
            toggle, always on screen with no hidden scroll; on desktop's
            wider primary nav this still renders as one line, same as
            before. */}
        <div className="flex flex-wrap items-center gap-1">
          {primaryTabs.map(tabLink)}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? "Show fewer sections" : "Show more sections"}
            className="neon-navlink shrink-0 rounded-full px-3 py-1.5 text-sm font-medium"
            style={{ ["--nav-color" as string]: NAV_ACCENT }}
          >
            More {expanded ? "▴" : "▾"}
          </button>
        </div>
        {expanded && (
          <div className="flex flex-wrap gap-1">{secondaryTabs.map(tabLink)}</div>
        )}
      </nav>
    </div>
  );
}
