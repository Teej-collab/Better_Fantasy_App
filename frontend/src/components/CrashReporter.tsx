"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { startCrashReporter } from "@/lib/crashReporter";

// Mounted once, app-wide (app/layout.tsx), next to PageViewTracker —
// see lib/crashReporter.ts for how a crash is detected. Renders nothing.
export function CrashReporter() {
  const pathname = usePathname();
  const reporter = useRef<ReturnType<typeof startCrashReporter> | null>(null);

  useEffect(() => {
    reporter.current = startCrashReporter(window.location.pathname);
    return () => {
      reporter.current?.stop();
      reporter.current = null;
    };
  }, []);

  useEffect(() => {
    reporter.current?.setRoute(pathname);
  }, [pathname]);

  return null;
}
