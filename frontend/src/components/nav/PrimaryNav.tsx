import { NavLink } from "@/components/nav/NavLink";
import { ChatNavLink } from "@/components/nav/ChatNavLink";

// One color per primary destination, from the app's shared 7-color
// neon palette (lib/neonPalette.ts) — .neon-navlink (globals.css)
// always renders each tab in its own color, like a lit neon sign, with
// the active tab reading as the brighter/boxed one.
const TAB_COLOR = {
  team: "#a855f7", // Neon Purple
  league: "#0ea5e9", // Neon Blue
  matchups: "#ec4899", // Neon Pink
  chat: "#39ff14", // Neon Green
  players: "#22d3ee", // Neon Lightning Blue
};

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
 * Desktop header row — five text destinations, no icons (the mobile
 * bottom nav is where icons carry weight; here plain, clean typography
 * does). Matchups/My Team's LIVE mark reflects the signed-in visitor's
 * own matchup (myMatchupLive, computed once in NavBar.tsx from
 * getMyWeek + the same isGameDay the ticker already computes) — not a
 * generic "some game somewhere is live" signal.
 */
export function PrimaryNav({
  signedIn,
  matchupsHref,
  myMatchupLive,
}: {
  signedIn: boolean;
  matchupsHref: string;
  myMatchupLive: boolean;
}) {
  return (
    <div className="hidden items-center gap-1 sm:flex">
      {signedIn && (
        <NavLink href="/team" section="team" activeClassName={ACTIVE} inactiveClassName={INACTIVE} color={TAB_COLOR.team}>
          <span className="flex flex-col items-start leading-none">
            My Team
            {myMatchupLive && <LiveMark />}
          </span>
        </NavLink>
      )}
      <NavLink href="/league" section="league" activeClassName={ACTIVE} inactiveClassName={INACTIVE} color={TAB_COLOR.league}>
        League
      </NavLink>
      <NavLink
        href={matchupsHref}
        section="matchups"
        activeClassName={ACTIVE}
        inactiveClassName={INACTIVE}
        color={TAB_COLOR.matchups}
      >
        <span className="flex flex-col items-start leading-none">
          Matchups
          {myMatchupLive && <LiveMark />}
        </span>
      </NavLink>
      {signedIn && <ChatNavLink variant="primary" />}
      <NavLink
        href="/free-agents"
        section="players"
        activeClassName={ACTIVE}
        inactiveClassName={INACTIVE}
        color={TAB_COLOR.players}
      >
        Players
      </NavLink>
    </div>
  );
}
