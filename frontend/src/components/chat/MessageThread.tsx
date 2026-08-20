"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatConversation, ChatMember, ChatMessage } from "@/lib/api";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { MessageComposer } from "@/components/chat/MessageComposer";
import { isGroupedWithPrevious } from "@/lib/chatFormat";

const AT_BOTTOM_THRESHOLD_PX = 80;

export function MessageThread({
  conversation,
  messages,
  members,
  myOwnerId,
  typingUsers,
  connected,
  hasMoreOlder,
  onLoadOlder,
  onSend,
  onReact,
  onDelete,
  onTyping,
  onBack,
}: {
  conversation: ChatConversation;
  messages: ChatMessage[];
  members: ChatMember[];
  myOwnerId: number;
  typingUsers: { owner_id: number; owner_name: string }[];
  connected: boolean;
  hasMoreOlder: boolean;
  onLoadOlder: () => void;
  onSend: (body: string, mentions: number[], replyToId: number | null) => void;
  onReact: (messageId: number, emoji: string) => void;
  onDelete: (messageId: number) => void;
  onTyping: () => void;
  onBack: () => void;
}) {
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [newMessageWaiting, setNewMessageWaiting] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const prevMessageCount = useRef(messages.length);
  const prevConversationId = useRef(conversation.id);

  const memberNames: Record<number, string> = {};
  for (const m of members) memberNames[m.owner_id] = m.display_name;
  memberNames[myOwnerId] = "You";

  function scrollToBottom(behavior: ScrollBehavior = "auto") {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior });
    setNewMessageWaiting(false);
  }

  // Conversation switched — always land at the newest message.
  useEffect(() => {
    if (prevConversationId.current !== conversation.id) {
      prevConversationId.current = conversation.id;
      prevMessageCount.current = messages.length;
      requestAnimationFrame(() => scrollToBottom());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  // New message arrived: auto-scroll only if already at the bottom —
  // otherwise show the "new message" indicator instead of yanking the
  // reader away from what they were reading (section 28).
  useEffect(() => {
    if (messages.length > prevMessageCount.current) {
      if (atBottom) {
        requestAnimationFrame(() => scrollToBottom("smooth"));
      } else {
        requestAnimationFrame(() => setNewMessageWaiting(true));
      }
    }
    prevMessageCount.current = messages.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  function handleScroll() {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAtBottom(distanceFromBottom < AT_BOTTOM_THRESHOLD_PX);
    if (distanceFromBottom < AT_BOTTOM_THRESHOLD_PX) setNewMessageWaiting(false);
  }

  function scrollToMessage(messageId: number) {
    document.getElementById(`chat-message-${messageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const title = conversation.type === "league" ? "Weekend League" : conversation.other_owner_name ?? "Direct Message";
  const subtitle =
    conversation.type === "league" ? `${conversation.member_count} managers` : connected ? "Connected" : "Reconnecting…";

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-black/10 px-4 py-3 dark:border-white/10">
        <button onClick={onBack} className="mr-1 text-lg text-black/60 sm:hidden dark:text-white/60" aria-label="Back to Messages">
          ‹
        </button>
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-semibold">{title}</span>
          <span className="truncate text-xs text-black/50 dark:text-white/50">{subtitle}</span>
        </div>
      </div>

      <div ref={listRef} onScroll={handleScroll} className="relative flex-1 overflow-y-auto px-4 py-3">
        {hasMoreOlder && (
          <div className="mb-3 flex justify-center">
            <button
              onClick={onLoadOlder}
              className="rounded-full border border-black/10 px-3 py-1 text-xs text-black/60 hover:bg-black/5 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10"
            >
              Load earlier messages
            </button>
          </div>
        )}

        {messages.length === 0 ? (
          <p className="mt-8 text-center text-sm text-black/40 dark:text-white/40">No messages yet — say something.</p>
        ) : (
          messages.map((m, i) => (
            <MessageBubble
              key={m.id}
              message={m}
              mine={m.owner_id === myOwnerId}
              grouped={isGroupedWithPrevious(m, messages[i - 1])}
              memberNames={memberNames}
              onReply={setReplyTo}
              onReact={onReact}
              onDelete={onDelete}
              onScrollToMessage={scrollToMessage}
            />
          ))
        )}
      </div>

      <div className="relative">
        {newMessageWaiting && (
          <button
            onClick={() => scrollToBottom("smooth")}
            className="absolute -top-10 left-1/2 -translate-x-1/2 rounded-full bg-[var(--wl-accent-dim)] px-3 py-1 text-xs font-medium text-white shadow-lg"
          >
            ↓ New message
          </button>
        )}
        {typingUsers.length > 0 && (
          <div className="absolute -top-7 left-4 flex items-center gap-1 text-xs text-black/50 dark:text-white/50">
            <TypingDots />
            {typingUsers.length === 1
              ? `${typingUsers[0].owner_name} is typing…`
              : typingUsers.length === 2
                ? `${typingUsers[0].owner_name} and ${typingUsers[1].owner_name} are typing…`
                : `${typingUsers.length} people are typing…`}
          </div>
        )}

        <MessageComposer
          members={members}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSend={(body, mentions) => {
            onSend(body, mentions, replyTo?.id ?? null);
            setReplyTo(null);
          }}
          onTyping={onTyping}
        />
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="flex gap-0.5">
      <span className="chat-typing-dot" />
      <span className="chat-typing-dot" style={{ animationDelay: "0.15s" }} />
      <span className="chat-typing-dot" style={{ animationDelay: "0.3s" }} />
    </span>
  );
}
