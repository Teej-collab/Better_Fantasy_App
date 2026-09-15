import { NavLink } from "@/components/nav/NavLink";
import { DESTINATIONS, MOBILE_NAV_ORDER, NAV_ACCENT, isValidNavOrder } from "@/lib/navDestinations";

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
 * Desktop header row — My Team, League, Home, Matchups, Gamecast, in
 * the owner's own saved order (`order` prop, NavBar.tsx's parsed
 * owner_preferences.bottom_nav_order — the same preference BottomNav.tsx
 * reads, falling back to MOBILE_NAV_ORDER when null/invalid). Reorderable
 * via Settings > Navigation since 2026-09-02 — previously hardcoded and
 * fixed here while the mobile bar was already reorderable, an
 * inconsistency closed by having both bars draw from the one saved
 * order instead of maintaining two separate settings for the same six
 * destinations. Plain text instead of icons (the mobile bar is where
 * icons carry weight; here clean typography does). Free Agents used to
 * be a 6th item here even though it wasn't in the mobile bar — now
 * consistently lives under My Team's own sub-nav (MyTeamSubNav.tsx) on
 * both. Matchups/My Team's LIVE mark reflects the signed-in visitor's
 * own matchup (myMatchupLive, computed once in NavBar.tsx from
 * getMyWeek + the same isGameDay the ticker already computes) — not a
 * generic "some game somewhere is live" signal. Gamecast's own LIVE
 * mark is the opposite: it's real whenever ANY NFL game is live, not
 * just the viewer's own matchup, since that's genuinely what the hub
 * shows.
 */
export function PrimaryNav({
  signedIn,
  matchupsHref,
  myMatchupLive,
  isGameDay,
  order,
}: {
  signedIn: boolean;
  matchupsHref: string;
  myMatchupLive: boolean;
  isGameDay: boolean;
  order: string[] | null;
}) {
  const tabOrder = order && isValidNavOrder(order) ? order : MOBILE_NAV_ORDER;

  return (
    <div className="hidden items-center gap-1 sm:flex">
      {tabOrder.map((key) => {
        switch (key) {
          case "team":
            return (
              signedIn && (
                <NavLink
                  key={key}
                  href="/team"
                  section="team"
                  activeClassName={ACTIVE}
                  inactiveClassName={INACTIVE}
                  color={NAV_ACCENT}
                  cosmicColor={DESTINATIONS.team.color}
                >
                  <span className="flex flex-col items-start leading-none">
                    My Team
                    {myMatchupLive && <LiveMark />}
                  </span>
                </NavLink>
              )
            );
          case "league":
            return (
              <NavLink
                key={key}
                href="/league"
                section="league"
                activeClassName={ACTIVE}
                inactiveClassName={INACTIVE}
                color={NAV_ACCENT}
                cosmicColor={DESTINATIONS.league.color}
              >
                League
              </NavLink>
            );
          case "home":
            return (
              <NavLink
                key={key}
                href="/"
                section="home"
                activeClassName={ACTIVE}
                inactiveClassName={INACTIVE}
                color={NAV_ACCENT}
                cosmicColor={DESTINATIONS.home.color}
              >
                Home
              </NavLink>
            );
          case "matchups":
            return (
              <NavLink
                key={key}
                href={matchupsHref}
                section="matchups"
                activeClassName={ACTIVE}
                inactiveClassName={INACTIVE}
                color={NAV_ACCENT}
                cosmicColor={DESTINATIONS.matchups.color}
              >
                <span className="flex flex-col items-start leading-none">
                  Matchup
                  {myMatchupLive && <LiveMark />}
                </span>
              </NavLink>
            );
          case "gamecast":
            return (
              <NavLink
                key={key}
                href="/gamecast"
                section="gamecast"
                activeClassName={ACTIVE}
                inactiveClassName={INACTIVE}
                color={NAV_ACCENT}
                cosmicColor={DESTINATIONS.gamecast.color}
              >
                <span className="flex flex-col items-start leading-none">
                  Gamecast
                  {isGameDay && <LiveMark />}
                </span>
              </NavLink>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
