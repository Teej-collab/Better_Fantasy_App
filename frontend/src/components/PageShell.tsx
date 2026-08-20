"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Every page except /weekend and /chat lives in a centered, max-width,
 * padded column — that's baked in here instead of repeated in every
 * page.tsx. /weekend needs to bleed edge-to-edge for its room
 * background to fill the screen, so it opts out entirely rather than
 * fighting the constraint with negative margins. /chat is a real
 * two-pane messaging app (ChatApp.tsx) that needs more width and a
 * near-full-height canvas, not a narrow centered column with a lot of
 * dead space on desktop — it keeps the nav bar (unlike /weekend) but
 * gets a wider max-width and tighter vertical padding.
 */
export function PageShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/weekend") {
    return <main className="flex-1">{children}</main>;
  }
  if (pathname === "/chat") {
    return <main className="safe-px mx-auto w-full max-w-5xl flex-1 py-4">{children}</main>;
  }
  return <main className="safe-px mx-auto w-full max-w-4xl flex-1 py-6">{children}</main>;
}
