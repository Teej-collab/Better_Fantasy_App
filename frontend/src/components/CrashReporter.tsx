"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { startCrashReporter } from "@/lib/crashReporter";
import { startErrorReporter } from "@/lib/errorReporter";

// Mounted once, app-wide (app/layout.tsx), next to PageViewTracker —
// app-health reporting for the admin dashboard: crashes (see lib/
// crashReporter.ts for how one is detected) and JavaScript errors
// (lib/errorReporter.ts). Renders nothing.
export function CrashReporter() {
  const pathname = usePathname();
  const reporter = useRef<ReturnType<typeof startCrashReporter> | null>(null);

  useEffect(() => {
    reporter.current = startCrashReporter(window.location.pathname);
    const stopErrors = startErrorReporter();
    return () => {
      stopErrors();
      reporter.current?.stop();
      reporter.current = null;
    };
  }, []);

  useEffect(() => {
    reporter.current?.setRoute(pathname);
  }, [pathname]);

  return null;
}
