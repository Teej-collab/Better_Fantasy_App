"use client";

import { useEffect, useState } from "react";
import { getPreferences, type ChatConversation } from "@/lib/api";

// Extracted from the old ChatNavBadge.tsx so both the desktop primary
// nav and the mobile bottom nav can show the same real unread count
// with their own, quite different markup (a text link vs. an icon+
// label+badge stack) — the fetch/filter logic was never specific to
// either layout. Excludes a conversation type from the count entirely
// if the visitor has muted it (Settings > Notifications > Messages).
export function useUnreadChatCount(): number {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    Promise.all([
      fetch("/chat/conversations").then((res) => (res.ok ? res.json() : null)),
      getPreferences().catch(() => null),
    ]).then(
      ([data, prefs]: [
        { conversations: ChatConversation[] } | null,
        Awaited<ReturnType<typeof getPreferences>> | null,
      ]) => {
        if (!data) return;
        const total = data.conversations.reduce((sum, c) => {
          if (prefs && c.type === "league" && !prefs.notify_league_chat) return sum;
          if (prefs && c.type === "direct" && !prefs.notify_direct_messages) return sum;
          return sum + c.unread_count;
        }, 0);
        setUnread(total);
      }
    );
  }, []);

  return unread;
}
