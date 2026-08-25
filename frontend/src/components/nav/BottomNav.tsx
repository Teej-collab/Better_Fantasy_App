import { NavLink } from "@/components/nav/NavLink";
import { ChatNavLink } from "@/components/nav/ChatNavLink";
import { MoreSheet } from "@/components/nav/MoreSheet";
import { TeamIcon, LeagueIcon, MatchupsIcon } from "@/components/nav/icons";
import { DESTINATIONS } from "@/lib/navDestinations";

// Same source as PrimaryNav.tsx's TAB_COLOR (lib/navDestinations.ts) —
// the desktop and mobile navs agree on which color means which
// destination.
const TAB_COLOR = {
  team: DESTINATIONS.team.color,
  league: DESTINATIONS.league.color,
  matchups: DESTINATIONS.matchups.color,
};

const ACTIVE_ITEM = "flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium";
const INACTIVE_ITEM = "flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px]";

/**
 * Fixed bottom bar — mobile only (hidden sm: and up, where PrimaryNav
 * takes over). Five permanent destinations exactly per the brief: My
 * Team, League, Matchups, Chat, More — no Settings/Profile/Logout (the
 * account menu in the header owns those) and no Players tab (folded
 * into More on mobile, since five is the ceiling before this stops
 * reading like a real app tab bar). Safe-area padding keeps it clear
 * of the iPhone home indicator; PageShell.tsx adds matching bottom
 * padding to page content so nothing renders hidden underneath it.
 *
 * The bar itself carries a neon glow along its top edge now (the same
 * default accent every .neon-panel falls back to — see globals.css's
 * --user-accent/--wl-accent chain), replacing the old plain border-
 * black/10 dark:border-white/10 hairline. With the whole bar reading
 * as lit, the separate small live-game dot that used to sit in the
 * corner of the My Team/Matchups icons was dropped as redundant —
 * each tab's own color (from NavLink's aria-current glow) is already
 * doing the "something's going on here" signaling on its own.
 */
export function BottomNav({
  signedIn,
  matchupsHref,
  awardsHref,
}: {
  signedIn: boolean;
  matchupsHref: string;
  awardsHref: string;
}) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 flex bg-[var(--background)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm sm:hidden"
      style={{
        borderTop: "1px solid color-mix(in srgb, var(--user-accent, var(--wl-accent)) 55%, transparent)",
        boxShadow:
          "0 0 10px color-mix(in srgb, var(--user-accent, var(--wl-accent)) 40%, transparent), 0 0 1px color-mix(in srgb, var(--user-accent, var(--wl-accent)) 70%, transparent)",
      }}
    >
      {signedIn && (
        <NavLink href="/team" section="team" activeClassName={ACTIVE_ITEM} inactiveClassName={INACTIVE_ITEM} color={TAB_COLOR.team}>
          <TeamIcon className="h-6 w-6" />
          My Team
        </NavLink>
      )}
      <NavLink href="/league" section="league" activeClassName={ACTIVE_ITEM} inactiveClassName={INACTIVE_ITEM} color={TAB_COLOR.league}>
        <LeagueIcon className="h-6 w-6" />
        League
      </NavLink>
      <NavLink
        href={matchupsHref}
        section="matchups"
        activeClassName={ACTIVE_ITEM}
        inactiveClassName={INACTIVE_ITEM}
        color={TAB_COLOR.matchups}
      >
        <MatchupsIcon className="h-6 w-6" />
        Matchups
      </NavLink>
      {signedIn && <ChatNavLink variant="bottom" />}
      <MoreSheet awardsHref={awardsHref} />
    </nav>
  );
}
