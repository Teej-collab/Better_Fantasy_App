"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { completeSignIn } from "@/lib/authApi";

const ERROR_MESSAGES: Record<string, string> = {
  not_a_league_member: "That Discord account isn't linked to a league member yet.",
};

/**
 * Redeems a single-use ticket for a real session, then finishes
 * sign-in exactly like the web flow (completeSignIn sets this site's
 * own first-party cookie). The native app (mobile/) sends people here
 * through its web handoff (mobile/src/lib/webHandoff.ts, POST
 * /auth/native/web-handoff) to open a page of the site already signed
 * in; the ticket is exchanged via POST /auth/native/redeem. The old
 * Capacitor wrapper that also used this page is gone (2026-10-20).
 */
function NativeCompleteInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error");
  const ticket = searchParams.get("ticket");
  // Set by the native app's web handoff (POST /auth/native/web-handoff)
  // when it opens a page that needs the browser, like a Watch Party or
  // Lounge video room. Only a same-site path is honored ("/x", never
  // "//host" or "https://…"), so this can't become an open redirect.
  const nextParam = searchParams.get("next");
  const next = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") && !nextParam.startsWith("/\\") ? nextParam : "/";
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
        router.replace(next);
        router.refresh();
      })
      .catch(() => setRedeemError("This sign-in link has expired or already been used — try signing in again."));
  }, [router, ticket, errorCode, next]);

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
