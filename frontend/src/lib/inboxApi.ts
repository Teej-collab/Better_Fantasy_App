// The notification inbox (2026-11-08): app/routers/notifications.py,
// through the /api/backend proxy so the browser's session cookie rides
// along. Same shape as the app's InboxNotification (mobile/src/lib/types.ts).

export type InboxNotification = {
  id: number;
  type: string;
  title: string;
  body: string;
  url: string;
  data: { type?: string; url?: string; category?: string; trade_id?: number; entry_id?: number; user_id?: number; [key: string]: unknown };
  created_at: string;
  read: boolean;
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/backend${path}`, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      // Not JSON; keep the status message.
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

// Settings > Notifications > Your leagues: everything, just your team,
// or muted (still in the inbox).
export type LeagueNotificationLevel = { league_id: number; name: string; level: "all" | "mine" | "off" };

export const inboxApi = {
  leagues: () => call<{ leagues: LeagueNotificationLevel[] }>("/notifications/leagues"),
  setLeague: (leagueId: number, level: LeagueNotificationLevel["level"]) =>
    call<{ leagues: LeagueNotificationLevel[] }>(`/notifications/leagues/${leagueId}`, { method: "PUT", body: JSON.stringify({ level }) }),
  list: () => call<{ notifications: InboxNotification[]; unread: number }>("/notifications"),
  unread: () => call<{ unread: number }>("/notifications/unread"),
  markRead: (ids?: number[]) => call<{ unread: number }>("/notifications/read", { method: "POST", body: JSON.stringify(ids ? { ids } : {}) }),
  // The buttons a push carries, here as buttons on the row.
  declineTrade: (tradeId: number) => call<unknown>(`/trades/${tradeId}/reject`, { method: "POST", body: "{}" }),
  bestPick: (entryId: number) => call<{ teams: string[]; week: number }>(`/survivor/entries/${entryId}/best-pick`, { method: "POST" }),
  acceptFriend: (userId: number) => call<unknown>(`/friends/requests/${userId}/accept`, { method: "POST" }),
};

// The bell's count, shared between it and the inbox page.
export const INBOX_CHANGED = "wl:inbox-changed";
export function announceUnread(unread: number) {
  window.dispatchEvent(new CustomEvent(INBOX_CHANGED, { detail: unread }));
}
