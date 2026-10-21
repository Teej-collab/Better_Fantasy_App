import type { ChatConversation } from '@/lib/types';

// Commish Corner pinned on top, then everything else newest message
// first, like Messages. Same order the server sends; this keeps it as
// live messages come in.
export function compareConversations(a: ChatConversation, b: ChatConversation): number {
  const pin = (c: ChatConversation) => (c.type === 'commish_corner' ? 0 : 1);
  if (pin(a) !== pin(b)) return pin(a) - pin(b);
  const at = a.last_message ? Date.parse(a.last_message.created_at) : 0;
  const bt = b.last_message ? Date.parse(b.last_message.created_at) : 0;
  return bt - at || b.id - a.id;
}

export function conversationTitle(c: ChatConversation): string {
  if (c.type === 'league') return 'League Chat';
  if (c.type === 'commish_corner') return 'Commish Corner';
  if (c.type === 'group') return c.name || groupMemberNames(c.member_names ?? []);
  return c.other_owner_name ?? 'Direct message';
}

// "Ian, Niko & Clay", or "Ian, Niko & 3 others" for a big group.
export function groupMemberNames(names: string[]): string {
  const first = names.map((n) => n.split(' ')[0]);
  if (first.length === 0) return 'Group chat';
  if (first.length <= 3) return first.length === 1 ? first[0] : `${first.slice(0, -1).join(', ')} & ${first.at(-1)}`;
  return `${first.slice(0, 2).join(', ')} & ${first.length - 2} others`;
}

// "3:42 PM" today, "Tue" this week, else "Sep 12".
export function formatWhen(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  if (now.getTime() - date.getTime() < 6 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString(undefined, { weekday: 'short' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// A message's own stamp, always with the time: "5:57 PM" today,
// "Yesterday 5:57 PM", "Tuesday 5:57 PM" this week, else "Oct 6, 5:57 PM"
// (with the year once it's not this year). Same rule as the web's
// formatMessageTimestamp.
export function formatMessageTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  if (now.getTime() - date.getTime() < 6 * 24 * 60 * 60 * 1000) {
    return `${date.toLocaleDateString(undefined, { weekday: 'long' })} ${time}`;
  }
  const day = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
  });
  return `${day}, ${time}`;
}
