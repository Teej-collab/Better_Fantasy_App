"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Every page except /weekend lives in a centered, max-width, padded
 * column — that's baked in here instead of repeated in every page.tsx.
 * /weekend needs to bleed edge-to-edge for its room background to fill
 * the screen, so it opts out entirely rather than fighting the
 * constraint with negative margins. The real homepage (/) is a normal
 * functional dashboard now, so it keeps the standard shell.
 */
export function PageShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/weekend") {
    return <main className="flex-1">{children}</main>;
  }
  return <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">{children}</main>;
}
