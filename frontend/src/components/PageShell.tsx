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
 * into the standard 896px reading column even on a large desktop
 * monitor, cutting off teams on the right with no way to see them
 * short of that table's own overflow-x-auto scrollbar. A much wider
 * cap here means a normal-sized league's full board actually fits on
 * a real desktop screen; DraftBoard's own overflow-x-auto is still
 * there underneath as the fallback for a league with enough teams/
 * rounds to exceed even this width, or on a narrower laptop screen.
 *
 * Extra bottom padding below `sm:` clears NavBar's fixed BottomNav
 * (same breakpoint BottomNav itself hides at) — otherwise the last
 * bit of every page's content would render underneath it. ChatApp.tsx
 * already computes its own exact height as `100dvh` minus the known
 * header/ticker chrome (`h-[calc(100dvh-3.5rem)]`) rather than relying
 * on container padding, so it gets the bottom nav's height subtracted
 * the same way instead of double-padding on top of that calculation.
 */
export function PageShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/chat") {
    return <main className="safe-px mx-auto w-full max-w-5xl flex-1 py-4">{children}</main>;
  }
  if (pathname === "/draft") {
    return <main className="safe-px mx-auto w-full max-w-[100rem] flex-1 py-6 pb-24 sm:pb-6">{children}</main>;
  }
  return <main className="safe-px mx-auto w-full max-w-4xl flex-1 py-6 pb-24 sm:pb-6">{children}</main>;
}
