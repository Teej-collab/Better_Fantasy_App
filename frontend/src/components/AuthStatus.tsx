"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE_URL } from "@/lib/api";

type Me = {
  owner_id: number;
  display_name: string | null;
  is_commissioner: boolean;
};

/**
 * Client component, not a server component like the rest of this app —
 * "am I logged in" depends on a per-visitor cookie, which a server
 * component (rendered once on the Node process, not per-browser) has
 * no way to read reactively here. Hits the frontend's own /auth/me
 * route (same-origin) rather than the backend directly — a direct
 * browser->backend fetch depends on the browser actually sending the
 * backend's cross-site cookie, which Safari's Intelligent Tracking
 * Prevention (mobile Safari and iOS Chrome) blocks by default even
 * with SameSite=None, silently reading as "signed out" for a visitor
 * who very much is signed in. See app/auth/me/route.ts.
 */
export function AuthStatus() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);

  async function logout() {
    // Two cookies to clear — the backend's own (what the chat WebSocket
    // and other direct browser->backend calls use) and the frontend's
    // first-party copy (what every server-rendered page, and this
    // component's own /auth/me check, actually reads — see
    // app/auth/logout/route.ts). Missing either one leaves the visitor
    // looking signed-in somewhere.
    await Promise.all([
      fetch(`${API_BASE_URL}/auth/logout`, { method: "POST", credentials: "include" }),
      fetch("/auth/logout", { method: "POST" }),
    ]);
    setMe(null);
    // The homepage's signed-out gate (OpeningExperience.tsx) is decided
    // server-side from the session cookie on every request — router.push
    // alone could still serve a cached RSC payload for "/" from before
    // logout, so refresh() forces page.tsx to actually re-run server-side
    // against the now-deleted cookie.
    router.push("/");
    router.refresh();
  }

  if (loading) return null;

  if (!me) {
    return (
      <a
        href={`${API_BASE_URL}/auth/discord/login`}
        className="shrink-0 text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white"
      >
        Sign in with Discord
      </a>
    );
  }

  return (
    <span className="flex shrink-0 items-center gap-3">
      <a href="/settings" className="text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white">
        {me.display_name}
      </a>
      <button
        onClick={logout}
        className="text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white"
      >
        Sign out
      </button>
    </span>
  );
}
