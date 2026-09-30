"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { App } from "@capacitor/app";
import { useIsNativeApp } from "@/lib/nativeApp";

/**
 * Routes a universal link / Android App Link that opened the native
 * app into this WebView. The OS hands the URL to the native shell, but
 * Capacitor doesn't navigate the WebView on its own — without this,
 * the Discord sign-in handoff (backend redirects the system browser to
 * /auth/native-complete?ticket=…, see app/auth/native-complete/page.tsx)
 * brings the app to the front and then sits on whatever page it was
 * already showing, never redeeming the ticket.
 *
 * Only same-host URLs are followed, and only their path + query, so a
 * link can never navigate the WebView off this site. Renders nothing.
 */
export function NativeDeepLinks() {
  const isNative = useIsNativeApp();
  const router = useRouter();

  useEffect(() => {
    if (!isNative) return;

    // A ticket is single-use, so the same URL arriving twice (the
    // launch URL on a cold start plus appUrlOpen) must only be followed once.
    const handled = new Set<string>();
    const open = (url: string | undefined) => {
      if (!url || handled.has(url)) return;
      handled.add(url);
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return;
      }
      if (parsed.host !== window.location.host) return;
      router.push(parsed.pathname + parsed.search);
    };

    App.getLaunchUrl()
      .then((launch) => open(launch?.url))
      .catch(() => {});
    const listener = App.addListener("appUrlOpen", ({ url }) => open(url));

    return () => {
      listener.then((l) => l.remove()).catch(() => {});
    };
  }, [isNative, router]);

  return null;
}
