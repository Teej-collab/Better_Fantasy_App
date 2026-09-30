"use client";

import { Capacitor, registerPlugin } from "@capacitor/core";

// Must match the backend's NATIVE_APP_CUSTOM_SCHEME (default
// "weekendleague") — the scheme its native OAuth callback redirects to
// (backend/app/routers/auth.py, _native_completion_url).
export const NATIVE_CALLBACK_SCHEME = "weekendleague";

interface NativeAuthPlugin {
  signIn(options: { url: string; callbackScheme: string }): Promise<{ url: string }>;
}

// iOS only: ios/App/App/NativeAuthPlugin.swift, an in-app
// ASWebAuthenticationSession sheet. Android opens the login in the
// system browser and returns through the same scheme as an intent
// (AndroidManifest.xml), picked up by components/NativeDeepLinks.tsx.
const NativeAuth = registerPlugin<NativeAuthPlugin>("NativeAuth");

/**
 * Maps a `weekendleague://auth/native-complete?…` callback to the
 * in-app page that redeems it ("/auth/native-complete?…"). Anything
 * else returns null, so a link another app fires at this scheme can
 * only ever land on that one page.
 */
export function nativeCallbackToPath(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${NATIVE_CALLBACK_SCHEME}:`) return null;
  if (parsed.host !== "auth" || parsed.pathname !== "/native-complete") return null;
  return `/auth/native-complete${parsed.search}`;
}

export function canUseSignInSheet(): boolean {
  return Capacitor.isPluginAvailable("NativeAuth");
}

/**
 * Runs the login in the in-app sheet. Resolves with the in-app path to
 * finish sign-in on, or null when the person closed the sheet.
 */
export async function signInWithSheet(loginUrl: string): Promise<string | null> {
  try {
    const { url } = await NativeAuth.signIn({ url: loginUrl, callbackScheme: NATIVE_CALLBACK_SCHEME });
    return nativeCallbackToPath(url);
  } catch (err) {
    if ((err as { code?: string })?.code === "CANCELED") return null;
    throw err;
  }
}
