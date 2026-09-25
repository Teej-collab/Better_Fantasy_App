"use client";

import { Capacitor } from "@capacitor/core";
import { useSyncExternalStore } from "react";

// Whether this page is running inside the native iOS/Android Capacitor
// shell (frontend/capacitor.config.ts's WebView around this same site)
// rather than a plain browser — used to route OAuth login through the
// native deep-link ticket flow instead of the web #token= fragment (see
// app/auth/native-complete/page.tsx). Capacitor.isNativePlatform() needs
// the browser/WebView runtime, unavailable during SSR, so this can't be
// read directly during render without either a hydration mismatch (server
// has no concept of "native shell") or the react-hooks/set-state-in-effect
// lint rule's cascading-render warning (setState synchronously inside an
// effect) — same problem and same fix as src/lib/appBoot.ts's
// useHasBootedSnapshot: useSyncExternalStore reads it as the *initial*
// render decision, with a fixed false snapshot during SSR and no
// subscription needed since a WebView never switches into or out of
// being one after the app starts.
const noSubscription = () => () => {};
const alwaysWebOnServer = () => false;

function isNativePlatform(): boolean {
  return typeof window !== "undefined" && Capacitor.isNativePlatform();
}

export function useIsNativeApp(): boolean {
  return useSyncExternalStore(noSubscription, isNativePlatform, alwaysWebOnServer);
}
