"use client";

import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { Device } from "@capacitor/device";
import { PushNotifications } from "@capacitor/push-notifications";
import { useIsNativeApp } from "@/lib/nativeApp";

/**
 * Registers this device for native push (APNs/FCM) once per app
 * session, for a signed-in visitor with a real league — see
 * backend/app/routers/push.py's POST /push/native/register and
 * docs/NATIVE_PHASE_1_IMPLEMENTATION.md §8 for the full lifecycle.
 * Mounted once in (app)/layout.tsx alongside AppEntry, deliberately
 * NOT threaded through AppEntry's own auth-check state — that
 * component's timing is carefully tuned for the intro animation (see
 * its own docstring), and this has no timing requirement of its own,
 * so a fully separate, self-contained effect is the lower-risk way to
 * add it. Renders nothing; this is a pure side-effect component.
 *
 * Only requests OS permission for a genuinely native build
 * (useIsNativeApp) — never for the plain web app, where there is no
 * native push channel and asking would just be a confusing, useless
 * prompt. Uses /auth/me (this app's own first-party-cookie route, not
 * the generic /api/backend proxy — matches AppEntry.tsx's own check)
 * rather than assuming a signed-in state, since a fresh app install
 * opens straight to this layout before any sign-in has happened.
 */
export function NativePushRegistration() {
  const isNative = useIsNativeApp();
  const attempted = useRef(false);

  useEffect(() => {
    if (!isNative || attempted.current) return;
    attempted.current = true;

    let cancelled = false;
    let registrationHandle: { remove: () => void } | undefined;
    let errorHandle: { remove: () => void } | undefined;

    async function run() {
      const me = await fetch("/auth/me")
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
      // No session yet, or signed in but no league joined/created —
      // POST /push/native/register would 401/409 either way (same
      // owner_id-required gate every other push route already has).
      // NativePushRegistration.tsx isn't re-mounted on sign-in today
      // (see (app)/layout.tsx), so a visitor who signs in mid-session
      // won't register until their next app open — acceptable for now,
      // matching this phase's "additive, not a full native UI" scope.
      if (cancelled || !me || me.owner_id == null) return;

      const permission = await PushNotifications.requestPermissions();
      if (cancelled || permission.receive !== "granted") return;

      const registration = await PushNotifications.addListener("registration", async (token) => {
        const { identifier: deviceId } = await Device.getId();
        await fetch("/api/backend/push/native/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            device_id: deviceId,
            platform: Capacitor.getPlatform(),
            push_token: token.value,
          }),
        }).catch(() => {
          // Best-effort — a failed registration just means this device
          // doesn't get native push until the next app open retries it;
          // never worth surfacing to the visitor over.
        });
      });
      const registrationError = await PushNotifications.addListener("registrationError", (error) => {
        console.warn("Native push registration failed", error);
      });
      if (cancelled) {
        registration.remove();
        registrationError.remove();
        return;
      }
      registrationHandle = registration;
      errorHandle = registrationError;

      await PushNotifications.register();
    }

    void run();

    return () => {
      cancelled = true;
      registrationHandle?.remove();
      errorHandle?.remove();
    };
  }, [isNative]);

  return null;
}
