import { NavLink } from "@/components/nav/NavLink";
import { ChatNavLink } from "@/components/nav/ChatNavLink";
import { DESTINATIONS, NAV_ACCENT } from "@/lib/navDestinations";

const ACTIVE = "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium";
const INACTIVE = "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium";

/**
 * Beta counterpart to PrimaryNav.tsx — desktop header row for the same
 * 5-tab set as BottomNavBeta.tsx (Home / League / Matchup / Chat /
 * More). Chat moves from its header-icon-only spot into a real tab
 * here too, so desktop and mobile agree on the IA rather than diverging.
 */
export function PrimaryNavBeta({ signedIn, matchupsHref }: { signedIn: boolean; matchupsHref: string }) {
  return (
    <div className="hidden items-center gap-1 sm:flex">
      <NavLink
        href="/"
        section="home"
        activeClassName={ACTIVE}
        inactiveClassName={INACTIVE}
        color={NAV_ACCENT}
        cosmicColor={DESTINATIONS.home.color}
      >
        Home
      </NavLink>
      <NavLink
        href="/league"
        section="league"
        activeClassName={ACTIVE}
        inactiveClassName={INACTIVE}
        color={NAV_ACCENT}
        cosmicColor={DESTINATIONS.league.color}
      >
        League
      </NavLink>
      <NavLink
        href={matchupsHref}
        section="matchups"
        activeClassName={ACTIVE}
        inactiveClassName={INACTIVE}
        color={NAV_ACCENT}
        cosmicColor={DESTINATIONS.matchups.color}
      >
        Matchup
      </NavLink>
      {signedIn && <ChatNavLink variant="primary" />}
      <NavLink href="/more" section="more" activeClassName={ACTIVE} inactiveClassName={INACTIVE} color={NAV_ACCENT}>
        More
      </NavLink>
    </div>
  );
}
