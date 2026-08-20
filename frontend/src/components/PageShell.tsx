"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Every page except the landing page (/) lives in a centered,
 * max-width, padded column — that's baked in here instead of repeated
 * in every page.tsx. The landing page needs to bleed edge-to-edge for
 * the room background to fill the screen, so it opts out entirely
 * rather than fighting the constraint with negative margins.
 */
export function PageShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/") {
    return <main className="flex-1">{children}</main>;
  }
  return <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">{children}</main>;
}
