"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { trackGamecastGameSelected } from "@/lib/analyticsEvents";

// The one piece of app/(app)/gamecast/page.tsx (a server component)
// that needs client-side interactivity — firing the gamecast_game_
// selected feature event on click, before navigating. Everything else
// about that link (the href, the styling) stays exactly as it was.
export function TrackedGamecastLink({
  gamecastId,
  href,
  className,
  children,
}: {
  gamecastId: string;
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={className} onClick={() => trackGamecastGameSelected(gamecastId)}>
      {children}
    </Link>
  );
}
