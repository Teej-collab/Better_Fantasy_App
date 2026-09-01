import { NavLink } from "@/components/nav/NavLink";
import { ChatNavLink } from "@/components/nav/ChatNavLink";
import { NAV_ACCENT } from "@/lib/navDestinations";

const ACTIVE = "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium";
const INACTIVE = "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium";

// A "Live" mark, not just a colored dot — accessibility requires state
// never rest on color alone, and this is a live-game indicator, not a
// literal on/off toggle, so a small text label (not just .live-dot)
// is the honest way to say it.
function LiveMark() {
  return (
    <span className="flex items-center gap-1 text-[10px] font-semibold tracking-wide text-[var(--wl-live)] uppercase">
      <span className="live-dot" aria-hidden />
      Live
    </span>
  );
}

/**
 * Desktop header row — My Team, League, Home, Matchups, Gamecast, Chat.
 * Plain text instead of icons (the mobile bar is where icons carry
 * weight; here clean typography does). Free Agents used to be a 6th
 * item here even though it wasn't in the mobile bar — now consistently
 * lives under My Team's own sub-nav (MyTeamSubNav.tsx) on both.
 * Matchups/My Team's LIVE mark reflects the signed-in visitor's own
 * matchup (myMatchupLive, computed once in NavBar.tsx from getMyWeek +
 * the same isGameDay the ticker already computes) — not a generic "some
 * game somewhere is live" signal. Gamecast's own LIVE mark is the
 * opposite: it's real whenever ANY NFL game is live, not just the
 * viewer's own matchup, since that's genuinely what the hub shows.
 *
 * Gamecast added 2026-08-31 — previously reachable only via a transient
 * ticker link while a game was actually live, so the feature had no
 * discoverable entry point the other six days of the week (a finding
 * from that day's competitive UX audit). Not in the mobile bottom bar
 * (BottomNav.tsx's 5 slots are fixed, reorderable, never added-to — see
 * lib/navDestinations.ts) — mobile reaches it via the Home page's
 * Discover grid instead.
 */
export function PrimaryNav({
  signedIn,
  matchupsHref,
  myMatchupLive,
  isGameDay,
}: {
  signedIn: boolean;
  matchupsHref: string;
  myMatchupLive: boolean;
  isGameDay: boolean;
}) {
  return (
    <div className="hidden items-center gap-1 sm:flex">
      {signedIn && (
        <NavLink href="/team" section="team" activeClassName={ACTIVE} inactiveClassName={INACTIVE} color={NAV_ACCENT}>
          <span className="flex flex-col items-start leading-none">
            My Team
            {myMatchupLive && <LiveMark />}
          </span>
        </NavLink>
      )}
      <NavLink href="/league" section="league" activeClassName={ACTIVE} inactiveClassName={INACTIVE} color={NAV_ACCENT}>
        League
      </NavLink>
      <NavLink href="/" section="home" activeClassName={ACTIVE} inactiveClassName={INACTIVE} color={NAV_ACCENT}>
        Home
      </NavLink>
      <NavLink
        href={matchupsHref}
        section="matchups"
        activeClassName={ACTIVE}
        inactiveClassName={INACTIVE}
        color={NAV_ACCENT}
      >
        <span className="flex flex-col items-start leading-none">
          Matchups
          {myMatchupLive && <LiveMark />}
        </span>
      </NavLink>
      <NavLink href="/gamecast" section="gamecast" activeClassName={ACTIVE} inactiveClassName={INACTIVE} color={NAV_ACCENT}>
        <span className="flex flex-col items-start leading-none">
          Gamecast
          {isGameDay && <LiveMark />}
        </span>
      </NavLink>
      {signedIn && <ChatNavLink variant="primary" />}
    </div>
  );
}
