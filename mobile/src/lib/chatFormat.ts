import type { ChatConversation } from '@/lib/types';

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
