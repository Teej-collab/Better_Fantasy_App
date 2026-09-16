import { NavLink } from "@/components/nav/NavLink";
import { HomeIcon, MatchupsIcon, GamecastIcon } from "@/components/nav/icons";
import { DESTINATIONS, NAV_ACCENT } from "@/lib/navDestinations";

const ITEM = "flex h-12 w-12 items-center justify-center rounded-full";

/**
 * Settings > Labs > Design Direction = "Stadium Lights" only (see
 * /design-exploration/direction-c for the source mockup) — a small
 * floating quick-access dock, purely additive on top of whichever real
 * nav (legacy BottomNav or beta MobileNavDrawer) is already rendering.
 * Reuses NavLink (same active-section detection, same --nav-color/
 * .neon-navlink mechanism every other nav surface uses) rather than
 * inventing its own routing/active-state logic — this is a visual
 * layer, not a new navigation system; every destination it links to is
 * already reachable through the existing nav underneath it.
 */
export function StadiumDock({ matchupsHref }: { matchupsHref: string }) {
  return (
    <nav
      aria-label="Quick access"
      className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-30 mx-auto flex w-fit gap-1 rounded-full p-1.5 sm:hidden"
      style={{
        background: "var(--wl-surface)",
        border: "1px solid var(--wl-border)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
      }}
    >
      <NavLink
        href="/"
        section="home"
        activeClassName={ITEM}
        inactiveClassName={ITEM}
        color={NAV_ACCENT}
        cosmicColor={DESTINATIONS.home.color}
      >
        <HomeIcon className="h-6 w-6" />
      </NavLink>
      <NavLink
        href={matchupsHref}
        section="matchups"
        activeClassName={ITEM}
        inactiveClassName={ITEM}
        color={NAV_ACCENT}
        cosmicColor={DESTINATIONS.matchups.color}
      >
        <MatchupsIcon className="h-6 w-6" />
      </NavLink>
      <NavLink
        href="/gamecast"
        section="gamecast"
        activeClassName={ITEM}
        inactiveClassName={ITEM}
        color={NAV_ACCENT}
        cosmicColor={DESTINATIONS.gamecast.color}
      >
        <GamecastIcon className="h-6 w-6" />
      </NavLink>
    </nav>
  );
}
