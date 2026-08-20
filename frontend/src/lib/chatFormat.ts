// Human-friendly timestamps per the chat brief: "7:42 PM / Yesterday /
// Monday / Aug 18" — never more precision than that.
export function formatMessageTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (date.toDateString() === now.toDateString()) return time;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;

  const daysAgo = (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
  if (daysAgo < 6) return date.toLocaleDateString([], { weekday: "long" });

  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function formatConversationListTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const daysAgo = (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
  if (daysAgo < 6) return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

// Two messages "group" (no repeated sender/timestamp header) when the
// same person sent both within a few minutes of each other.
const GROUP_WINDOW_MS = 5 * 60 * 1000;

export function isGroupedWithPrevious(
  current: { owner_id: number; created_at: string },
  previous: { owner_id: number; created_at: string } | undefined
): boolean {
  if (!previous) return false;
  if (current.owner_id !== previous.owner_id) return false;
  return new Date(current.created_at).getTime() - new Date(previous.created_at).getTime() < GROUP_WINDOW_MS;
}
