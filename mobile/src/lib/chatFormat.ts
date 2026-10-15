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
  return c.other_owner_name ?? 'Direct message';
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

export function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
