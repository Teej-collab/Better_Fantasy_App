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
 * Two fixed rows of 3 since 2026-09-02 (row split rebalanced 2026-09-03
 * from 4+2 to 3+3): LEAGUE_SUBNAV_PRIMARY (lib/navDestinations.ts) is
 * row 1, everything else in LEAGUE_SUBNAV_ORDER is row 2 — both always
 * visible, no collapse/toggle. (A "More" toggle briefly stood in for
 * row 2 the same day it was introduced; replaced with a second static
 * row per the owner's own follow-up call — a fixed row you can always
 * see beats a hidden one you have to tap open.) Each row renders as a
 * fixed grid-cols-3, not flex-wrap, so it's always exactly one line
 * regardless of device — see the grid comment below for why flex-wrap
 * couldn't guarantee that.
 */
export function LeagueSubNav({
  active,
  awardsHref,
  activeLeagueName,
}: {
  active: LeagueTab;
  awardsHref: string;
  // Null/omitted for a signed-out visitor or one with no active league
  // yet (NeedsLeagueCard/SignInCard handle those states before this
  // ever renders in practice) — a member of more than one league is
  // the only case this chip actually needs to disambiguate for.
  activeLeagueName?: string | null;
}) {
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
        className="neon-navlink flex w-full items-center justify-center truncate rounded-full px-2 py-1.5 text-xs font-medium sm:px-3 sm:text-sm"
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
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/league"
          className="flex w-fit items-center gap-1 text-sm text-black/50 sm:hidden dark:text-white/50"
        >
          ‹ League
        </Link>
        {activeLeagueName && (
          <span
            className="ml-auto truncate rounded-full px-2.5 py-1 text-xs font-medium"
            style={{ background: "var(--wl-surface)", border: "1px solid var(--wl-border)", color: "var(--wl-text-secondary)" }}
            title="Your active league"
          >
            {activeLeagueName}
          </span>
        )}
      </div>
      <nav aria-label="League sections" className="flex flex-col gap-1.5">
        {/* Fixed 3-column grid, not flex-wrap — flex-wrap's row-break
            point depends on each pill's rendered text width, which
            doesn't scale monotonically with viewport width (iOS font
            metrics/text-size-adjust can make a *wider* phone wrap
            *more* than a narrower one — confirmed 2026-09-03 from two
            real devices showing 3 rows vs. 2 rows for identical
            markup). A 3-item grid-cols-3 row is structurally always
            exactly one row regardless of device, since grid doesn't
            add rows until item count exceeds column count. Each pill
            fills its cell (w-full) and truncates as a safety net
            rather than sizing to its own content. */}
        <div className="grid grid-cols-3 gap-1">{primaryTabs.map(tabLink)}</div>
        <div className="grid grid-cols-3 gap-1">{secondaryTabs.map(tabLink)}</div>
      </nav>
    </div>
  );
}
