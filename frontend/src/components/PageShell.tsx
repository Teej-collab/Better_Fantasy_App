"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Only used by app/(app)/layout.tsx — /weekend lives outside that route
 * group entirely (its own minimal app/weekend/layout.tsx) since it
 * needs to bleed edge-to-edge with no nav/ticker chrome at all, which
 * isn't something a client-side pathname check inside a shared layout
 * can reliably do (it can't stop that chrome from being server-rendered
 * in the first place — the route group is what actually solves that).
 *
 * Every remaining page lives in a centered, max-width, padded column —
 * that's baked in here instead of repeated in every page.tsx. /chat is
 * a real two-pane messaging app (ChatApp.tsx) that needs more width and
 * a near-full-height canvas, not a narrow centered column with a lot of
 * dead space on desktop, so it gets a wider max-width and tighter
 * vertical padding instead of the standard treatment. /draft is the
 * same story for a different reason — DraftBoard.tsx is a real
 * round-by-team grid (one column per team) that was getting squeezed
 * into a narrower reading column even on a large desktop monitor,
 * cutting off teams on the right with no way to see them short of that
 * table's own overflow-x-auto scrollbar. A much wider cap there means a
 * normal-sized league's full board actually fits on a real desktop
 * screen; DraftBoard's own overflow-x-auto is still there underneath
 * as the fallback for a league with enough teams/rounds to exceed even
 * that width, or on a narrower laptop screen.
 *
 * Every other page's own content is already responsive row-lists
 * rather than wide tables (a deliberate choice — see e.g.
 * RosterList.tsx's own comment on why it's not a <table>), so none of
 * them were actually cutting content off the way /draft was. They
 * still sat in a fairly narrow column with a lot of unused space on a
 * real desktop/laptop screen, though (2026-09-04 audit), so the shared
 * default below got the same wider treatment as /chat rather than
 * staying narrower than every page that opts out of it.
 *
 * Extra bottom padding below `sm:` clears NavBar's fixed BottomNav
 * (same breakpoint BottomNav itself hides at) — otherwise the last
 * bit of every page's content would render underneath it. ChatApp.tsx
 * already computes its own exact height as `100dvh` minus the known
 * header/ticker chrome (`h-[calc(100dvh-3.5rem)]`) rather than relying
 * on container padding, so it gets the bottom nav's height subtracted
 * the same way instead of double-padding on top of that calculation.
 *
 * `wl-page-shell`/`wl-page-shell--chat` (below) are what actually let
 * every page's content move up into the space MobileNavDrawer.tsx's
 * Labs mode reclaims — NavBar.tsx drops its sticky header and bottom
 * bar entirely on mobile under Labs > "Try the new look", so this
 * shell needs a smaller top offset (just enough to clear the floating
 * hamburger button) and no bottom offset at all (there's no bottom bar
 * to clear) whenever that's active. That override lives in globals.css
 * as a `[data-wl-layout="beta"]` attribute-selector rule, not computed
 * here — this component is a plain client component with no per-
 * request knowledge of owner_preferences.beta_layout, and reading
 * document.documentElement's attribute during render would compute a
 * different className on the client than the server actually rendered,
 * which React reports as a hydration mismatch. Every other beta-only
 * style in this app already avoids that the same way (see globals.css's
 * own `[data-wl-layout="beta"] .neon-panel::before` rule).
 */
export function PageShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/chat") {
    return <main className="wl-page-shell wl-page-shell--chat safe-px mx-auto w-full max-w-5xl flex-1 py-4">{children}</main>;
  }
  if (pathname === "/draft") {
    return (
      <main className="wl-page-shell safe-px mx-auto w-full max-w-[100rem] flex-1 py-6 pb-24 sm:pb-6">{children}</main>
    );
  }
  return <main className="wl-page-shell safe-px mx-auto w-full max-w-5xl flex-1 py-6 pb-24 sm:pb-6">{children}</main>;
}
