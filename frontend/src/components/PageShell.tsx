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
 * vertical padding instead of the standard treatment.
 */
export function PageShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/chat") {
    return <main className="safe-px mx-auto w-full max-w-5xl flex-1 py-4">{children}</main>;
  }
  return <main className="safe-px mx-auto w-full max-w-4xl flex-1 py-6">{children}</main>;
}
