import { NavLink } from "@/components/nav/NavLink";
import { ChatNavLink } from "@/components/nav/ChatNavLink";
import { HomeIcon, LeagueIcon, MatchupsIcon, TeamIcon } from "@/components/nav/icons";
import { MOBILE_NAV_ORDER, NAV_ACCENT, type DestinationKey } from "@/lib/navDestinations";

const ACTIVE_ITEM = "flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium";
const INACTIVE_ITEM = "flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px]";

function isValidMobileOrder(order: string[]): order is DestinationKey[] {
  return (
    order.length === MOBILE_NAV_ORDER.length &&
    new Set(order).size === MOBILE_NAV_ORDER.length &&
    order.every((k) => (MOBILE_NAV_ORDER as string[]).includes(k))
  );
}

/**
 * Fixed bottom bar — mobile only (hidden sm: and up, where PrimaryNav
 * takes over). Five slots, drawn from MOBILE_NAV_ORDER (lib/
 * navDestinations.ts) in the owner's own saved order (`order` prop,
 * NavBar.tsx's parsed owner_preferences.bottom_nav_order — falls back
 * to the default order when null or corrupted) — reorderable via
 * Settings > Navigation. No "More" tab and no Players tab: the old
 * More sheet (Player Cards, Free Agents, Standings, Awards, Rivalries,
 * Rules, Chug) is gone entirely — every one of those destinations now
 * lives in LeagueSubNav instead (reachable once on any League-family
 * page), per the owner's own call on removing More for good rather
 * than keeping it as a selectable slot.
 *
 * Used to carry a neon glow along its top edge — flattened to a plain
 * hairline border 2026-08-31 to match the approved mock exactly (its
 * phone-frame bottom bar has no glow at all, just var(--wl-border)).
 */
export function BottomNav({
  signedIn,
  matchupsHref,
  order,
}: {
  signedIn: boolean;
  matchupsHref: string;
  order: string[] | null;
}) {
  const tabOrder = order && isValidMobileOrder(order) ? order : MOBILE_NAV_ORDER;

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 flex bg-[var(--background)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm sm:hidden"
      style={{ borderTop: "1px solid var(--wl-border)" }}
    >
      {tabOrder.map((key) => {
        switch (key) {
          case "team":
            return (
              signedIn && (
                <NavLink
                  key={key}
                  href="/team"
                  section="team"
                  activeClassName={ACTIVE_ITEM}
                  inactiveClassName={INACTIVE_ITEM}
                  color={NAV_ACCENT}
                >
                  <TeamIcon className="h-6 w-6" />
                  My Team
                </NavLink>
              )
            );
          case "league":
            return (
              <NavLink
                key={key}
                href="/league"
                section="league"
                activeClassName={ACTIVE_ITEM}
                inactiveClassName={INACTIVE_ITEM}
                color={NAV_ACCENT}
              >
                <LeagueIcon className="h-6 w-6" />
                League
              </NavLink>
            );
          case "home":
            return (
              <NavLink
                key={key}
                href="/"
                section="home"
                activeClassName={ACTIVE_ITEM}
                inactiveClassName={INACTIVE_ITEM}
                color={NAV_ACCENT}
              >
                <HomeIcon className="h-6 w-6" />
                Home
              </NavLink>
            );
          case "matchups":
            return (
              <NavLink
                key={key}
                href={matchupsHref}
                section="matchups"
                activeClassName={ACTIVE_ITEM}
                inactiveClassName={INACTIVE_ITEM}
                color={NAV_ACCENT}
              >
                <MatchupsIcon className="h-6 w-6" />
                Matchups
              </NavLink>
            );
          case "chat":
            return signedIn && <ChatNavLink key={key} variant="bottom" />;
          default:
            return null;
        }
      })}
    </nav>
  );
}
