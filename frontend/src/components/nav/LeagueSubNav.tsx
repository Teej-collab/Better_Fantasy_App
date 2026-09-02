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
 * Two fixed rows since 2026-09-02: LEAGUE_SUBNAV_PRIMARY (lib/
 * navDestinations.ts) is row 1, everything else in LEAGUE_SUBNAV_ORDER
 * is row 2 — both always visible, no collapse/toggle. (A "More" toggle
 * briefly stood in for row 2 the same day; replaced with a second
 * static row per the owner's own follow-up call — a fixed row you can
 * always see beats a hidden one you have to tap open.)
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
        {/* flex-wrap, not overflow-x-auto — a narrow mobile viewport
            can't fit every tab in a row on one line, and a scrolling row
            with no visible affordance would leave the far end of a row
            undiscoverable. Wrapping keeps every tab always on screen
            with no hidden scroll; on desktop's wider primary nav each
            row still renders as one line, same as before. */}
        <div className="flex flex-wrap items-center gap-1">{primaryTabs.map(tabLink)}</div>
        <div className="flex flex-wrap items-center gap-1">{secondaryTabs.map(tabLink)}</div>
      </nav>
    </div>
  );
}
