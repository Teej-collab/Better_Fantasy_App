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
  onReact,
  onDelete,
}: {
  messages: ChatMessage[];
  myOwnerId: number;
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
    <div className="flex-1 overflow-y-auto overscroll-y-contain px-4 py-3">
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
