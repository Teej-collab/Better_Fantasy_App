"use client";

import { useEffect, useState } from "react";
import { API_BASE_URL } from "@/lib/api";
import { AccountMenu, type Me } from "@/components/AccountMenu";

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
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);

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

  return <AccountMenu me={me} />;
}
