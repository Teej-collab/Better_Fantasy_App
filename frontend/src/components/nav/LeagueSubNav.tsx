import Link from "next/link";
import { DESTINATIONS, LEAGUE_SUBNAV_ORDER, type DestinationKey } from "@/lib/navDestinations";

export type LeagueTab = Exclude<DestinationKey, "team" | "home" | "matchups" | "chat">;

/**
 * Rendered manually at the top of each League-family page (League,
 * Standings, Player Cards, Awards, Rivalries, Rules, Chug) rather than
 * via a shared route-group layout — keeps this additive (one line per page)
 * instead of restructuring how those routes are organized. No
 * usePathname() needed: each page already knows which tab it is, so
 * `active` is just passed in directly — a plain server component, no
 * client JS for something this simple. `‹ League` only shows on
 * mobile (sm:hidden) — desktop already has "League" one click away in
 * the primary header, this is purely the mobile "how do I get back"
 * affordance from spec §23.
 */
const STATIC_HREF: Record<Exclude<LeagueTab, "awards">, string> = {
  league: "/league",
  standings: "/standings",
  playerCards: "/players",
  freeAgents: "/free-agents",
  rivalries: "/rivalries",
  rules: "/rules",
  chug: "/chug",
  keepers: "/keepers",
};

export function LeagueSubNav({ active, awardsHref }: { active: LeagueTab; awardsHref: string }) {
  const tabs = (LEAGUE_SUBNAV_ORDER as LeagueTab[]).map((key) => ({
    key,
    href: key === "awards" ? awardsHref : STATIC_HREF[key],
  }));

  return (
    <div className="mb-4 flex flex-col gap-2">
      <Link
        href="/league"
        className="flex w-fit items-center gap-1 text-sm text-black/50 sm:hidden dark:text-white/50"
      >
        ‹ League
      </Link>
      <nav
        aria-label="League sections"
        className="flex gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={tab.key === active ? "page" : undefined}
            className="neon-navlink shrink-0 rounded-full px-3 py-1.5 text-sm font-medium"
            style={{ ["--nav-color" as string]: DESTINATIONS[tab.key].color }}
          >
            {DESTINATIONS[tab.key].label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
