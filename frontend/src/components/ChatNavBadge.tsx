"use client";

import { useEffect, useState } from "react";
import { getPreferences, type ChatConversation } from "@/lib/api";

/**
 * Client-side, same reason AuthStatus is: the nav bar is otherwise a
 * plain server component with no per-visitor data, and fetching chat
 * unread counts there would add a real backend round-trip to every
 * single page load site-wide. This only costs anything on pages that
 * actually render the nav (i.e. not while signed out — /auth/me-gated
 * pages return 401 harmlessly here). Reflects unread state as of when
 * the current page loaded, not a live push — ChatApp.tsx's own
 * WebSocket keeps counts live while /chat itself is open.
 *
 * Goes through the frontend's own /chat/conversations proxy (not the
 * backend directly) for the same reason AuthStatus goes through
 * /auth/me now — a direct browser->backend fetch depends on the
 * browser sending the backend's cross-site cookie, which Safari's ITP
 * blocks on mobile regardless of SameSite=None.
 *
 * Excludes a conversation type from the count entirely if the visitor
 * has muted it (Settings > Notifications > Messages) — the one real,
 * observable-today effect of those preferences, ahead of any actual
 * push delivery existing to gate.
 */
export function ChatNavBadge() {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    Promise.all([
      fetch("/chat/conversations").then((res) => (res.ok ? res.json() : null)),
      getPreferences().catch(() => null),
    ]).then(([data, prefs]: [{ conversations: ChatConversation[] } | null, Awaited<ReturnType<typeof getPreferences>> | null]) => {
      if (!data) return;
      const total = data.conversations.reduce((sum, c) => {
        if (prefs && c.type === "league" && !prefs.notify_league_chat) return sum;
        if (prefs && c.type === "direct" && !prefs.notify_direct_messages) return sum;
        return sum + c.unread_count;
      }, 0);
      setUnread(total);
    });
  }, []);

  return (
    <a href="/chat" className="shrink-0 text-black/70 hover:text-black dark:text-white/70 dark:hover:text-white">
      Chat{unread > 0 && <span className="ml-1 text-[var(--wl-accent-dim)]">· {unread}</span>}
    </a>
  );
}
