"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * The landing page (/) is its own immersive nav (the neon signs) —
 * the plain text nav bar would clash with it, so it's hidden there and
 * shown everywhere else. `children` is layout.tsx's <NavBar/>, an
 * async Server Component — passing it in as children (rather than this
 * component fetching anything itself) keeps this file a plain client
 * component with no data-fetching of its own.
 */
export function HideOnHome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/") return null;
  return <>{children}</>;
}
