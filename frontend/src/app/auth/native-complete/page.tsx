"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { completeSignIn } from "@/lib/authApi";

const ERROR_MESSAGES: Record<string, string> = {
  not_a_league_member: "That Discord account isn't linked to a league member yet.",
};

/**
 * Landing point for the native OAuth deep link — see
 * backend/app/routers/auth.py's discord_callback/google_callback
 * (client=native branch) and docs/NATIVE_PHASE_1_PLAN.md §7 for the
 * full lifecycle. A native client's OAuth login opens in the system
 * browser, not this app's own embedded Capacitor WebView (required by
 * Google/Apple's OAuth policies, and why this can't just reuse
 * /auth/complete's #token= fragment — a cookie set in that separate
 * browser session would never be visible to the app's own WebView).
 * The backend hands back a short-lived, single-use ticket instead —
 * this page exchanges it via POST /auth/native/redeem for a real
 * session token, then finishes sign-in exactly like the web flow does
 * (completeSignIn sets this app's own first-party cookie), which is
 * enough for this app's Capacitor shell today (a WebView pointed at
 * this same site — see frontend/capacitor.config.ts) since it shares
 * this origin's cookie jar. A separate, non-WebView native client
 * would instead store the token itself (Keychain/Keystore) and send
 * it as Authorization: Bearer thereafter — not needed yet.
 */
function NativeCompleteInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error");
  const ticket = searchParams.get("ticket");
  const [redeemError, setRedeemError] = useState<string | null>(null);

  useEffect(() => {
    if (errorCode) return;
    if (!ticket) {
      router.replace("/");
      return;
    }

    fetch("/api/backend/auth/native/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("ticket redemption failed");
        const { token } = await res.json();
        await completeSignIn(token);
        router.replace("/");
        router.refresh();
      })
      .catch(() => setRedeemError("This sign-in link has expired or already been used — try signing in again."));
  }, [router, ticket, errorCode]);

  const message = errorCode
    ? (ERROR_MESSAGES[errorCode] ?? "Something went wrong signing you in.")
    : (redeemError ?? "Signing you in…");

  return (
    <div className="flex min-h-[50vh] items-center justify-center px-6 text-center">
      <p className="text-sm text-black/60 dark:text-white/60">{message}</p>
    </div>
  );
}

export default function NativeCompletePage() {
  return (
    <Suspense fallback={null}>
      <NativeCompleteInner />
    </Suspense>
  );
}
