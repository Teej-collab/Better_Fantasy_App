import { NavLink } from "@/components/nav/NavLink";
import { ChatNavLink } from "@/components/nav/ChatNavLink";
import { HomeIcon, LeagueIcon, MatchupsIcon, MoreIcon } from "@/components/nav/icons";
import { DESTINATIONS, NAV_ACCENT } from "@/lib/navDestinations";

const ACTIVE_ITEM = "flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium";
const INACTIVE_ITEM = "flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px]";

/**
 * Beta counterpart to BottomNav.tsx — Documentation/UX/02_Information_
 * Architecture.md's proposed 5-tab set: Home / League / Matchup / Chat
 * / More, replacing My Team + Gamecast's dedicated slots with a real
 * catch-all (see /more/page.tsx) and — the single highest-leverage
 * change in that document — restoring Chat to the tab bar instead of a
 * header-only icon. Rendered by NavBar.tsx instead of BottomNav.tsx
 * only when the signed-in owner has opted into Settings > Labs > "Try
 * the new look" (owner_preferences.beta_layout). Deliberately not
 * reorderable yet (unlike the legacy bar's bottom_nav_order) — a fixed
 * 5-tab set for the beta window, per the roadmap's scoped-down v1.
 */
export function BottomNavBeta({ signedIn, matchupsHref }: { signedIn: boolean; matchupsHref: string }) {
  return (
    <nav
      id="app-bottom-nav"
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 flex bg-[var(--background)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm sm:hidden"
      style={{ borderTop: "1px solid var(--wl-border)" }}
    >
      <NavLink
        href="/"
        section="home"
        activeClassName={ACTIVE_ITEM}
        inactiveClassName={INACTIVE_ITEM}
        color={NAV_ACCENT}
        cosmicColor={DESTINATIONS.home.color}
      >
        <HomeIcon className="h-6 w-6" />
        Home
      </NavLink>
      <NavLink
        href="/league"
        section="league"
        activeClassName={ACTIVE_ITEM}
        inactiveClassName={INACTIVE_ITEM}
        color={NAV_ACCENT}
        cosmicColor={DESTINATIONS.league.color}
      >
        <LeagueIcon className="h-6 w-6" />
        League
      </NavLink>
      <NavLink
        href={matchupsHref}
        section="matchups"
        activeClassName={ACTIVE_ITEM}
        inactiveClassName={INACTIVE_ITEM}
        color={NAV_ACCENT}
        cosmicColor={DESTINATIONS.matchups.color}
      >
        <MatchupsIcon className="h-6 w-6" />
        Matchup
      </NavLink>
      {signedIn && <ChatNavLink variant="bottom" />}
      <NavLink
        href="/more"
        section="more"
        activeClassName={ACTIVE_ITEM}
        inactiveClassName={INACTIVE_ITEM}
        color={NAV_ACCENT}
      >
        <MoreIcon className="h-6 w-6" />
        More
      </NavLink>
    </nav>
  );
}
