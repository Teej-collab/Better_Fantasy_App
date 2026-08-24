"use client";

import { useEffect } from "react";

// Registers public/sw.js on mount — renders nothing. Feature-detected
// (Safari on older iOS, and any non-browser environment, simply won't
// have `serviceWorker` on navigator) rather than assumed available.
// Mounted once in the true root layout so it's live everywhere, not
// per-route — push notifications aren't tied to any one page.
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration can fail (unsupported browser, privacy mode,
      // etc.) — the rest of the app works fine without push, so this
      // is silently non-fatal rather than surfacing an error.
    });
  }, []);

  return null;
}
