"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { App } from "@capacitor/app";
import { useIsNativeApp } from "@/lib/nativeApp";
import { nativeCallbackToPath } from "@/lib/nativeAuth";

/**
 * Routes a `weekendleague://auth/native-complete?…` link that opened
 * the native app into this WebView. That's how Android finishes Discord
 * sign-in: the login runs in the system browser, and the backend's
 * redirect to the custom scheme brings the app back (see
 * AndroidManifest.xml). Capacitor doesn't navigate the WebView on its
 * own, so without this the app would come to the front and sit on
 * whatever page it was already showing. iOS never needs this path: its
 * in-app sign-in sheet hands the callback straight back to SignInCard
 * (lib/nativeAuth.ts).
 *
 * nativeCallbackToPath only ever yields that one in-app page, so a link
 * another app fires at the scheme can't navigate anywhere else.
 * Renders nothing.
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
      const path = nativeCallbackToPath(url);
      if (path) router.push(path);
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
