"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { trackPageView } from "@/lib/api";

// Mounted once, app-wide (app/layout.tsx) — logs one page-view event
// per route change to the admin-only usage dashboard (app/routers/
// admin.py's GET /admin/usage). trackPageView is fire-and-forget (it
// swallows its own errors and is a no-op server-side for a session
// with no owner_id yet), and this component renders nothing.
export function PageViewTracker() {
  const pathname = usePathname();

  useEffect(() => {
    trackPageView(pathname);
  }, [pathname]);

  return null;
}
