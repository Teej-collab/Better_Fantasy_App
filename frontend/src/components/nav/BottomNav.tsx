"use client";

import { useEffect, useState } from "react";
import { NavLink } from "@/components/nav/NavLink";
import { GamecastIcon, HomeIcon, LeagueIcon, MatchupsIcon, TeamIcon } from "@/components/nav/icons";
import { DESTINATIONS, MOBILE_NAV_ORDER, NAV_ACCENT, isValidNavOrder } from "@/lib/navDestinations";

// `fixed bottom-0` alone assumes the layout viewport's bottom edge
// tracks the on-screen keyboard — layout.tsx's own
// interactiveWidget:"resizes-content" viewport meta is supposed to
// guarantee that on iOS 17.4+/Android Chrome, but it isn't reliable
// on every real device (confirmed live: this bar floated disconnected
// from both the content above it and the keyboard below it on an
// actual phone, with dead space on both sides — the classic symptom
// of the layout viewport NOT actually shrinking the way the meta tag
// promises). window.visualViewport is the one API that always
// reports the REAL visible region regardless of whether that promise
// held, so this measures the gap between it and the full window
// height directly and nudges the bar up by exactly that amount —
// zero effect whenever the browser's own resize behavior is already
// correct (the gap is 0), a real fix when it isn't.
//
// MIN_KEYBOARD_GAP_PX guards against a real regression (2026-09): the
// same innerHeight-vs-visualViewport gap this measures also shows up
// for reasons that have nothing to do with a keyboard — Safari's own
// collapsible bottom toolbar being in its expanded state (the default
// right after navigating somewhere, before a scroll auto-collapses
// it), or the extra system status bar iOS adds while a phone call is
// active in the background. Both are real, everyday-sized gaps
// (tens of px), and without a floor this bar would misread either one
// as "a keyboard is open" and shift itself upward over content that
// never actually needed the room — concretely, sliding up over Chat's
// message composer (ChatApp.tsx sizes the panel above this bar
// assuming its DEFAULT, non-shifted position, so this bar moving on
// its own without the panel above it knowing is exactly what re-
// covers the composer). A real on-screen keyboard eats a much bigger
// share of the screen than either of those — comfortably clearing this
// floor on every phone this app supports — so this only ever
// suppresses the false positives, never a genuine keyboard.
const MIN_KEYBOARD_GAP_PX = 150;

function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    function measure() {
      if (!viewport) return;
      const gap = window.innerHeight - viewport.height - viewport.offsetTop;
      setInset(gap > MIN_KEYBOARD_GAP_PX ? Math.round(gap) : 0);
    }

    measure();
    viewport.addEventListener("resize", measure);
    viewport.addEventListener("scroll", measure);
    return () => {
      viewport.removeEventListener("resize", measure);
      viewport.removeEventListener("scroll", measure);
    };
  }, []);

  return inset;
}

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
  const keyboardInset = useKeyboardInset();

  return (
    <nav
      id="app-bottom-nav"
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 flex bg-[var(--background)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm sm:hidden"
      style={{ borderTop: "1px solid var(--wl-border)", transform: keyboardInset > 0 ? `translateY(-${keyboardInset}px)` : undefined }}
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
