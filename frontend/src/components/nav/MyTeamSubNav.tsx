import Link from "next/link";
import {
  DESTINATIONS,
  DESTINATION_HREF,
  MY_TEAM_SUBNAV_ORDER,
  NAV_ACCENT,
  type DestinationKey,
} from "@/lib/navDestinations";

export type MyTeamTab = "team" | "draft" | "keepers" | "freeAgents";

// "Roster" reads better than the shared "My Team" label once it's a
// tab sitting on top of the My Team page itself, not a link to
// somewhere else — the one label override this sub-nav needs.
const LABEL_OVERRIDE: Partial<Record<DestinationKey, string>> = {
  team: "Roster",
};

/**
 * My Team's own sub-nav — same "neon-navlink" pill pattern as
 * LeagueSubNav.tsx, scoped to the things that are actually about
 * *your own* roster (this season's lineup, next season's keeper
 * picks, and free agency) rather than league-wide browsing. Keepers
 * and Free Agents both used to live in LeagueSubNav; moved here per
 * the project owner's own read that a roster decision belongs under
 * My Team, not League — and Free Agents specifically also used to be
 * a *different* top-level destination on desktop than on mobile
 * (PrimaryNav vs. LeagueSubNav), which this fixes by giving it one
 * consistent home everywhere.
 */
export function MyTeamSubNav({ active }: { active: MyTeamTab }) {
  const tabs: { key: MyTeamTab; href: string }[] = [
    { key: "team", href: DESTINATION_HREF.team! },
    ...(MY_TEAM_SUBNAV_ORDER as MyTeamTab[]).map((key) => ({ key, href: DESTINATION_HREF[key]! })),
  ];

  return (
    <nav
      aria-label="My Team sections"
      className="flex gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => (
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
      ))}
    </nav>
  );
}
