"use client";

import { useEffect, useState } from "react";
import { getConversationMembers, type ChatAvatar, type ChatConversation } from "@/lib/api";
import { initialsFor, readableTextColor } from "@/components/chat/MessageBubble";

// The iMessage-style "who's in this chat" screen — a group conversation
// (league/commish_corner) only ever showed a small overlapping avatar
// cluster in the list, with no way to actually see who those people
// were. Fetches the real full roster (not the 3-avatar preview cluster
// ChatConversation.avatar_group already carries) the moment it opens.
export function GroupInfoModal({ conversation, onClose }: { conversation: ChatConversation; onClose: () => void }) {
  const [members, setMembers] = useState<ChatAvatar[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getConversationMembers(conversation.id).then((result) => {
      if (!cancelled) setMembers(result);
    });
    return () => {
      cancelled = true;
    };
  }, [conversation.id]);

  const title = conversation.type === "commish_corner" ? "Commish's Corner" : "Weekend League";

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 px-4 pt-20" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-3 rounded-2xl border border-black/10 bg-[var(--background)] p-4 shadow-xl dark:border-white/10"
      >
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <h2 className="text-lg font-semibold">{title}</h2>
            <span className="text-xs text-black/50 dark:text-white/50">
              {members ? `${members.length} ${members.length === 1 ? "manager" : "managers"}` : "Loading…"}
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-full text-black/50 hover:bg-black/5 hover:text-black/70 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white/70"
          >
            ✕
          </button>
        </div>

        <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {members === null ? (
            <p className="py-4 text-center text-sm text-black/50 dark:text-white/50">Loading…</p>
          ) : (
            members.map((m) => (
              <div key={m.owner_id} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
                {m.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a user-uploaded Blob URL, not a static/known-at-build-time asset next/image can optimize
                  <img src={m.logo_url} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                ) : (
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                    style={{
                      backgroundColor: m.chat_color ?? "#6b7280",
                      color: readableTextColor(m.chat_color ?? "#6b7280"),
                    }}
                  >
                    {initialsFor(m.display_name)}
                  </span>
                )}
                <span className="text-sm font-medium">{m.display_name}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
