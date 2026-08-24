import { cookies } from "next/headers";
import {
  getCurrentWeek,
  getMe,
  getMyWeek,
  getNflScoreboard,
  isNflGameLive,
  listSeasons,
} from "@/lib/api";
import { BrandMark } from "@/components/BrandMark";
import { PrimaryNav } from "@/components/nav/PrimaryNav";
import { BottomNav } from "@/components/nav/BottomNav";
import { AuthStatus } from "@/components/AuthStatus";

/**
 * Shared by app/(app)/layout.tsx and app/(home)/layout.tsx — every
 * route except /weekend, which lives outside both groups specifically
 * so it never receives this chrome at all (not even server-rendered —
 * see those layouts' own comments for why that distinction matters).
 *
 * Session-aware (reads the first-party cookie server-side, same
 * `getMe(sessionCookie)` every page.tsx already uses — not the
 * client-side /auth/me check AuthStatus.tsx does for the account menu
 * itself, which this deliberately leaves untouched) for two things
 * only: which primary destinations to show (League/Matchups/Players
 * are genuinely public today — their routers have no auth gate — so
 * they stay visible signed out; My Team/Chat do not, matching each
 * page's own existing sign-in gate), and the signed-in visitor's own
 * live-matchup state for the LIVE marks on My Team/Matchups.
 *
 * getMyWeek + getNflScoreboard are the exact same calls
 * app/(home)/page.tsx already makes for its own "your week" hero —
 * getNflScoreboard() is a plain fetch(), and Next's per-request fetch
 * memoization means calling it here too (in addition to
 * AppTickerBar's own identical call) hits the network once per page
 * render, not twice.
 */
export async function NavBar() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;

  const [{ seasons }, me, myWeek, nflGames] = await Promise.all([
    listSeasons(),
    getMe(sessionCookie),
    getMyWeek(sessionCookie),
    getNflScoreboard(),
  ]);
  const signedIn = me !== null;
  const latestSeason = seasons.length > 0 ? Math.max(...seasons) : null;

  let matchupsHref = "/standings"; // only reachable if a league has no seasons synced at all yet
  let awardsHref = "/rivalries";
  if (latestSeason !== null) {
    const { current_week } = await getCurrentWeek(latestSeason);
    const week = current_week && current_week >= 1 ? current_week : 1;
    matchupsHref = `/seasons/${latestSeason}/weeks/${week}`;
    awardsHref = `/seasons/${latestSeason}/awards`;
  }

  const myMatchupLive = Boolean(myWeek?.matchup?.started) && isNflGameLive(nflGames);

  return (
    <>
      <header id="site-nav" className="border-b border-black/10 dark:border-white/10">
        <nav className="safe-px mx-auto flex max-w-5xl items-center justify-between gap-3 py-3">
          <div className="flex min-w-0 items-center gap-1">
            <BrandMark href="/" />
            <span className="mx-2 hidden h-5 w-px bg-black/10 sm:block dark:bg-white/10" aria-hidden />
            <PrimaryNav signedIn={signedIn} matchupsHref={matchupsHref} myMatchupLive={myMatchupLive} />
          </div>
          <AuthStatus />
        </nav>
      </header>
      <BottomNav signedIn={signedIn} matchupsHref={matchupsHref} awardsHref={awardsHref} />
    </>
  );
}
