"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMember, ChatMessage } from "@/lib/api";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { MessageComposer } from "@/components/chat/MessageComposer";
import { isGroupedWithNext, isGroupedWithPrevious } from "@/lib/chatFormat";

// A Watch Party room's text chat — deliberately its own small panel
// rather than MessageThread.tsx reused wholesale: MessageThread owns a
// lot of Messages-tab-specific chrome (a mobile back button between
// list/thread, a "Load earlier messages" pager, the group-info modal,
// read-receipt lines) that doesn't apply to a chat panel slid over a
// live video call. What IS reused is the real per-message rendering —
// MessageBubble and MessageComposer, the same components (and same
// backend conversation) the main Chat tab uses — so a message sent
// here is a completely ordinary chat message, not a parallel system.
export function WatchPartyChat({
  open,
  onClose,
  messages,
  members,
  myOwnerId,
  typingUsers,
  connected,
  aiNoticeSeen,
  onAiNoticeResolved,
  onSend,
  onReact,
  onDelete,
  onTyping,
}: {
  open: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  members: ChatMember[];
  myOwnerId: number;
  typingUsers: { owner_id: number; owner_name: string }[];
  connected: boolean;
  aiNoticeSeen: boolean;
  onAiNoticeResolved: (optOut: boolean) => void;
  onSend: (body: string, mentions: number[], replyToId: number | null, imageUrl: string | null) => void;
  onReact: (messageId: number, emoji: string) => void;
  onDelete: (messageId: number) => void;
  onTyping: () => void;
}) {
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const memberNames: Record<number, string> = {};
  for (const m of members) memberNames[m.owner_id] = m.display_name;
  memberNames[myOwnerId] = "You";

  useEffect(() => {
    if (open) requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
  }, [open, messages.length]);

  function scrollToMessage(messageId: number) {
    document.getElementById(`watch-party-message-${messageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  if (!open) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 flex max-h-[65%] flex-col rounded-t-2xl bg-[var(--background)] shadow-2xl">
      <div className="flex items-center justify-between border-b border-black/10 px-4 py-3 dark:border-white/10">
        <span className="text-sm font-bold" style={{ color: "var(--wl-text)" }}>
          Room Chat {!connected && <span className="font-normal text-black/40 dark:text-white/40">· Reconnecting…</span>}
        </span>
        <button
          onClick={onClose}
          aria-label="Close chat"
          className="rounded-full p-1 text-black/50 hover:bg-black/5 dark:text-white/50 dark:hover:bg-white/10"
        >
          ✕
        </button>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <p className="mt-8 text-center text-sm text-black/50 dark:text-white/50">No messages yet — say something.</p>
        ) : (
          messages.map((m, i) => (
            <div key={m.id} id={`watch-party-message-${m.id}`}>
              <MessageBubble
                message={m}
                mine={m.owner_id === myOwnerId}
                grouped={isGroupedWithPrevious(m, messages[i - 1])}
                groupedWithNext={isGroupedWithNext(m, messages[i + 1])}
                highlightMention={false}
                memberNames={memberNames}
                onReply={setReplyTo}
                onReact={onReact}
                onDelete={onDelete}
                onScrollToMessage={scrollToMessage}
              />
            </div>
          ))
        )}
      </div>

      {typingUsers.length > 0 && (
        <div className="px-4 pb-1 text-xs text-black/50 dark:text-white/50">
          {typingUsers.length === 1
            ? `${typingUsers[0].owner_name} is typing…`
            : `${typingUsers.length} people are typing…`}
        </div>
      )}

      <MessageComposer
        members={members}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onSend={(body, mentions, imageUrl) => {
          onSend(body, mentions, replyTo?.id ?? null, imageUrl);
          setReplyTo(null);
        }}
        onTyping={onTyping}
        aiNoticeSeen={aiNoticeSeen}
        onAiNoticeResolved={onAiNoticeResolved}
      />
    </div>
  );
}
