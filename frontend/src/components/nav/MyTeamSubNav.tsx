import Link from "next/link";
import { DESTINATIONS } from "@/lib/navDestinations";

export type MyTeamTab = "team" | "keepers";

const TABS: { key: MyTeamTab; href: string; label: string }[] = [
  { key: "team", href: "/team", label: "Roster" },
  { key: "keepers", href: "/keepers", label: DESTINATIONS.keepers.label },
];

/**
 * My Team's own sub-nav — same "neon-navlink" pill pattern as
 * LeagueSubNav.tsx, scoped to the two things that are actually about
 * *your own* roster (this season's lineup, and next season's keeper
 * picks) rather than league-wide browsing. Keepers used to live in
 * LeagueSubNav; moved here per the project owner's own read that a
 * roster decision belongs under My Team, not League.
 */
export function MyTeamSubNav({ active }: { active: MyTeamTab }) {
  return (
    <nav
      aria-label="My Team sections"
      className="flex gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === active ? "page" : undefined}
          className="neon-navlink shrink-0 rounded-full px-3 py-1.5 text-sm font-medium"
          style={{ ["--nav-color" as string]: DESTINATIONS[tab.key].color }}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
