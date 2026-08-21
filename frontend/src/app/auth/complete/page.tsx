"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Landing point for the cross-domain login handoff — see
 * backend/app/routers/auth.py's discord_callback for the full
 * reasoning. The token arrives as a URL fragment (#token=...), which
 * the browser never sends to any server (unlike a query param, which
 * would land in Vercel's/Railway's own access logs) — only this page's
 * own client-side JS can read it. Reads it, hands it to a same-origin
 * route that actually sets the first-party cookie, then goes home.
 */
export default function AuthCompletePage() {
  const router = useRouter();
  const [error, setError] = useState(false);

  useEffect(() => {
    const hash = window.location.hash;
    const token = hash.startsWith("#token=") ? hash.slice("#token=".length) : null;

    if (!token) {
      router.push("/");
      return;
    }

    fetch("/auth/complete/set-cookie", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("failed to complete sign-in");
        router.push("/");
        router.refresh();
      })
      .catch(() => setError(true));
  }, [router]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <p className="text-sm text-black/60 dark:text-white/60">
        {error ? "Something went wrong signing you in — try again." : "Signing you in…"}
      </p>
    </div>
  );
}
