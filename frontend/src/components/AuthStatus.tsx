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
 * "am I logged in" depends on a session cookie the browser holds for the
 * backend's origin, which a Next.js server component (fetching from the
 * Node process, not the browser) has no access to. This is the one piece
 * of the app that talks to the backend directly from the browser.
 */
export function AuthStatus() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE_URL}/auth/me`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);

  async function logout() {
    await fetch(`${API_BASE_URL}/auth/logout`, { method: "POST", credentials: "include" });
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
