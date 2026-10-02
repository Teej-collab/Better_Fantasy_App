"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

// AppTickerBar's league strip, left off the league picker (/start) —
// a screen outside any one league gets the NFL ticker alone. The bar
// is rendered once by app/(app)/layout.tsx, which can't see the path.
export function LeagueTickerSlot({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/start" || pathname.startsWith("/start/")) return null;
  return <>{children}</>;
}
