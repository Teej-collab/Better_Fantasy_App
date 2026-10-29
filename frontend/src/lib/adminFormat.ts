// Small formatting helpers shared across the admin dashboard's pages —
// nothing here is admin-specific in principle, just not needed
// anywhere else in the app yet.

import type { AdminInbox, AdminInboxItem } from "@/lib/api";

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffSeconds = Math.round((Date.now() - then) / 1000);
  if (diffSeconds < 60) return "just now";
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// The inbox items still open and not someone else's: the Command
// Center's "Needs a person" (shared by the server page and the client panel).
export function needsMe(inbox: AdminInbox): AdminInboxItem[] {
  return inbox.items.filter((i) => !i.done && (!i.claimed_by || i.claimed_by.user_id === inbox.me));
}
