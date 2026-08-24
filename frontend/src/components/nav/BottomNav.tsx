import { NavLink } from "@/components/nav/NavLink";
import { ChatNavLink } from "@/components/nav/ChatNavLink";
import { MoreSheet } from "@/components/nav/MoreSheet";
import { TeamIcon, LeagueIcon, MatchupsIcon } from "@/components/nav/icons";

// Same palette as PrimaryNav.tsx's TAB_COLOR — the desktop and mobile
// navs agree on which color means which destination.
const TAB_COLOR = {
  team: "#a855f7", // Neon Purple
  league: "#0ea5e9", // Neon Blue
  matchups: "#ec4899", // Neon Pink
};

const ACTIVE_ITEM = "flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium";
const INACTIVE_ITEM = "flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] text-black/45 dark:text-white/45";

// A dot, not a color change, next to the label — same "never color
// alone" reasoning as PrimaryNav's LiveMark, just compact enough for
// the bottom bar's tight vertical rhythm.
function LiveDot() {
  return <span className="live-dot absolute top-1 right-[calc(50%-1.1rem)]" aria-hidden />;
}

/**
 * Fixed bottom bar — mobile only (hidden sm: and up, where PrimaryNav
 * takes over). Five permanent destinations exactly per the brief: My
 * Team, League, Matchups, Chat, More — no Settings/Profile/Logout (the
 * account menu in the header owns those) and no Players tab (folded
 * into More on mobile, since five is the ceiling before this stops
 * reading like a real app tab bar). Safe-area padding keeps it clear
 * of the iPhone home indicator; PageShell.tsx adds matching bottom
 * padding to page content so nothing renders hidden underneath it.
 */
export function BottomNav({
  signedIn,
  matchupsHref,
  awardsHref,
  myMatchupLive,
}: {
  signedIn: boolean;
  matchupsHref: string;
  awardsHref: string;
  myMatchupLive: boolean;
}) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-black/10 bg-[var(--background)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm sm:hidden dark:border-white/10"
    >
      {signedIn && (
        <NavLink
          href="/team"
          section="team"
          activeClassName={`relative ${ACTIVE_ITEM}`}
          inactiveClassName={`relative ${INACTIVE_ITEM}`}
          color={TAB_COLOR.team}
        >
          {myMatchupLive && <LiveDot />}
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
        activeClassName={`relative ${ACTIVE_ITEM}`}
        inactiveClassName={`relative ${INACTIVE_ITEM}`}
        color={TAB_COLOR.matchups}
      >
        {myMatchupLive && <LiveDot />}
        <MatchupsIcon className="h-6 w-6" />
        Matchups
      </NavLink>
      {signedIn && <ChatNavLink variant="bottom" />}
      <MoreSheet awardsHref={awardsHref} />
    </nav>
  );
}
