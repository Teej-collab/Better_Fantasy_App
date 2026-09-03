import { NavLink } from "@/components/nav/NavLink";
import { GamecastIcon, HomeIcon, LeagueIcon, MatchupsIcon, TeamIcon } from "@/components/nav/icons";
import { DESTINATIONS, MOBILE_NAV_ORDER, NAV_ACCENT, isValidNavOrder } from "@/lib/navDestinations";

const ACTIVE_ITEM = "flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium";
const INACTIVE_ITEM = "flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px]";

// Compact counterpart to PrimaryNav.tsx's own LiveMark — same "state
// never rests on color alone" reasoning (a real "Live" word, not just
// a colored dot), just sized for a narrow bottom-nav slot instead of a
// header link.
function LiveMark() {
  return (
    <span className="flex items-center gap-1 text-[9px] leading-none font-semibold tracking-wide text-[var(--wl-live)] uppercase">
      <span className="live-dot" aria-hidden />
      Live
    </span>
  );
}

/**
 * Fixed bottom bar — mobile only (hidden sm: and up, where PrimaryNav
 * takes over). Slots drawn from MOBILE_NAV_ORDER (lib/
 * navDestinations.ts) in the owner's own saved order (`order` prop,
 * NavBar.tsx's parsed owner_preferences.bottom_nav_order — falls back
 * to the default order when null, corrupted, or the wrong length for
 * the current slot set) — reorderable via Settings > Navigation. No
 * "More" tab and no Players tab: the old More sheet (Player Cards,
 * Free Agents, Standings, Awards, Rivalries, Rules, Chug) is gone
 * entirely — every one of those destinations now lives in LeagueSubNav
 * instead (reachable once on any League-family page), per the owner's
 * own call on removing More for good rather than keeping it as a
 * selectable slot.
 *
 * gamecast added 2026-09-02 — used to have zero presence here (mobile
 * could only reach it via the Home page's Discover grid), a real gap
 * for the app's one genuinely live, real-time feature per that day's
 * re-audit. Carries its own LiveMark (below) exactly when a real NFL
 * game is in progress, matching the isGameDay signal PrimaryNav's own
 * Gamecast link already uses on desktop.
 *
 * Used to carry a neon glow along its top edge — flattened to a plain
 * hairline border 2026-08-31 to match the approved mock exactly (its
 * phone-frame bottom bar has no glow at all, just var(--wl-border)).
 *
 * The `id="app-bottom-nav"` is load-bearing: ChatApp.tsx measures this
 * element's real rendered height (via ResizeObserver, not a hardcoded
 * guess) to size the chat panel above it on mobile — this bar's height
 * isn't constant (the Gamecast tab grows a third row on game day), so
 * removing this id or renaming it silently breaks that measurement.
 */
export function BottomNav({
  signedIn,
  matchupsHref,
  isGameDay,
  order,
}: {
  signedIn: boolean;
  matchupsHref: string;
  isGameDay: boolean;
  order: string[] | null;
}) {
  const tabOrder = order && isValidNavOrder(order) ? order : MOBILE_NAV_ORDER;

  return (
    <nav
      id="app-bottom-nav"
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
                  cosmicColor={DESTINATIONS.team.color}
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
                cosmicColor={DESTINATIONS.league.color}
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
                cosmicColor={DESTINATIONS.home.color}
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
                cosmicColor={DESTINATIONS.matchups.color}
              >
                <MatchupsIcon className="h-6 w-6" />
                Matchups
              </NavLink>
            );
          case "gamecast":
            return (
              <NavLink
                key={key}
                href="/gamecast"
                section="gamecast"
                activeClassName={ACTIVE_ITEM}
                inactiveClassName={INACTIVE_ITEM}
                color={NAV_ACCENT}
                cosmicColor={DESTINATIONS.gamecast.color}
              >
                <GamecastIcon className="h-6 w-6" />
                Gamecast
                {isGameDay && <LiveMark />}
              </NavLink>
            );
          default:
            return null;
        }
      })}
    </nav>
  );
}
