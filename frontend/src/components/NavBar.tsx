import { cookies } from "next/headers";
import {
  getCurrentWeek,
  getMe,
  getMyPreferences,
  getMyWeek,
  getNflScoreboard,
  isNflGameLive,
  listSeasons,
  matchupsHrefFor,
  resolveWeek,
  safeLatestSeason,
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

  const [{ seasons }, me, myWeek, nflGames, myPreferences] = await Promise.all([
    listSeasons(),
    getMe(sessionCookie),
    getMyWeek(sessionCookie),
    getNflScoreboard(),
    getMyPreferences(sessionCookie),
  ]);
  const signedIn = me !== null;
  const latestSeason = safeLatestSeason(seasons);

  let week: number | null = null;
  if (latestSeason !== null) {
    const { current_week } = await getCurrentWeek(latestSeason);
    week = resolveWeek(current_week);
  }
  const matchupsHref = matchupsHrefFor(latestSeason, week);

  const myMatchupLive = Boolean(myWeek?.matchup?.started) && isNflGameLive(nflGames);
  const isGameDay = isNflGameLive(nflGames);

  // bottom_nav_order is stored as a raw JSON-encoded string (same
  // convention as home_card_order) — parsed once here rather than in
  // BottomNav/PrimaryNav themselves, since this is the one place
  // already doing the session-aware server fetch. Both nav surfaces
  // consume the same parsed order (see PrimaryNav.tsx's own comment).
  let bottomNavOrder: string[] | null = null;
  if (myPreferences?.bottom_nav_order) {
    try {
      bottomNavOrder = JSON.parse(myPreferences.bottom_nav_order);
    } catch {
      bottomNavOrder = null;
    }
  }

  return (
    <>
      {/* sticky, not the pre-2026-08-31 static-in-flow header — a header
          that scrolls away on every page (confirmed: any page long
          enough to actually scroll, like the new /gamecast hub, made
          this obvious) means losing the sign-in/account menu and every
          primary destination the instant you read past the fold. The
          persistent bottom bar (BottomNav.tsx) was already fixed; this
          brings the top header to the same standard instead of leaving
          it the odd one out. The ticker (AppTickerBar, rendered as its
          own sibling below this) deliberately stays non-sticky — transient
          live-score content, not primary navigation, doesn't need to
          permanently eat mobile vertical space. */}
      <header
        id="site-nav"
        className="sticky top-0 z-40 border-b border-black/10 bg-[var(--background)]/95 backdrop-blur-sm dark:border-white/10"
      >
        {/* pt- accounts for the notch/Dynamic Island/status bar — this
            app runs with viewport-fit=cover and a translucent iOS status
            bar (layout.tsx), so nothing reserves that space by default;
            without it, the header sits partly underneath the status
            bar/notch instead of below it. The extra +0.75rem on top of
            the raw inset is deliberate breathing room — the bare safe
            area alone (env(safe-area-inset-top)) reaches exactly the
            bottom edge of the status bar, no gap at all, which reads as
            cramped/glued-to-the-status-bar rather than a proper header. */}
        <nav className="safe-px mx-auto flex max-w-5xl items-center justify-between gap-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3">
          <div className="flex min-w-0 items-center gap-1">
            <BrandMark href="/" />
            <span className="mx-2 hidden h-5 w-px bg-black/10 sm:block dark:bg-white/10" aria-hidden />
            <PrimaryNav
              signedIn={signedIn}
              matchupsHref={matchupsHref}
              myMatchupLive={myMatchupLive}
              isGameDay={isGameDay}
              order={bottomNavOrder}
            />
          </div>
          <AuthStatus />
        </nav>
      </header>
      <BottomNav signedIn={signedIn} matchupsHref={matchupsHref} isGameDay={isGameDay} order={bottomNavOrder} />
    </>
  );
}
