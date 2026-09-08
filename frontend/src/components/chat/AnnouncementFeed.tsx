"use client";

import { useState } from "react";
import type { ChatMessage } from "@/lib/api";
import { AnnouncementCard } from "@/components/chat/AnnouncementCard";

// Newest-first, like a feed/announcements list rather than a live
// chat's chronological scroll-to-bottom — you're checking in on what
// the commissioner posted, not reading a conversation in order.
export function AnnouncementFeed({
  messages,
  myOwnerId,
  beta = false,
  onReact,
  onDelete,
}: {
  messages: ChatMessage[];
  myOwnerId: number;
  beta?: boolean;
  onReact: (messageId: number, emoji: string) => void;
  onDelete: (messageId: number) => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  function toggle(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const newestFirst = [...messages].reverse();

  return (
    // min-h-0 is load-bearing (2026-09 fix): a flex item's default
    // auto min-height is its own content size, not 0 — without this, a
    // real feed of announcement cards taller than the space left for
    // it (MessageThread.tsx's own panel has a fixed, JS-measured
    // total height, not one that grows with content) refuses to
    // shrink to fit, and PostAnnouncementForm below it gets pushed
    // past the panel's own overflow-hidden boundary instead of this
    // list scrolling internally like it's supposed to — the real bug
    // behind "the composer's submit button is cut off right above the
    // bottom nav" in Commish's Corner specifically (its 2-field
    // composer plus a feed of substantial cards is exactly the
    // combination that exposes this; a short DM thread rarely does).
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-3">
      {newestFirst.length === 0 ? (
        <p className="mt-8 text-center text-sm text-black/50 dark:text-white/50">
          No announcements yet.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {newestFirst.map((m) => (
            <AnnouncementCard
              key={m.id}
              message={m}
              mine={m.owner_id === myOwnerId}
              expanded={expandedIds.has(m.id)}
              beta={beta}
              onToggle={() => toggle(m.id)}
              onReact={onReact}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
