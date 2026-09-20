"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatConversation, ChatMember, ChatMessage } from "@/lib/api";
import { AnnouncementFeed } from "@/components/chat/AnnouncementFeed";
import { GroupInfoModal } from "@/components/chat/GroupInfoModal";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { MessageComposer } from "@/components/chat/MessageComposer";
import { PostAnnouncementForm } from "@/components/chat/PostAnnouncementForm";
import { formatMessageTimestamp, isGroupedWithNext, isGroupedWithPrevious } from "@/lib/chatFormat";
import { usePresence } from "@/components/PresenceProvider";

const AT_BOTTOM_THRESHOLD_PX = 80;

export function MessageThread({
  conversation,
  messages,
  members,
  myOwnerId,
  mentionHighlightingEnabled,
  readReceiptsEnabled,
  readAt,
  aiNoticeSeen,
  onAiNoticeResolved,
  typingUsers,
  connected,
  hasMoreOlder,
  onLoadOlder,
  onSend,
  onReact,
  onDelete,
  onTyping,
  onBack,
  beta = false,
}: {
  conversation: ChatConversation;
  messages: ChatMessage[];
  members: ChatMember[];
  myOwnerId: number;
  // Settings > Labs > "Try the new look" — see ChatApp.tsx / AnnouncementCard.tsx.
  beta?: boolean;
  mentionHighlightingEnabled: boolean;
  // My own Settings > Chat > Read Receipts preference — a receipt line
  // only ever renders when BOTH this and the conversation's own
  // other_last_read_message_id (already gated server-side on the OTHER
  // owner's own preference) allow it.
  readReceiptsEnabled: boolean;
  aiNoticeSeen: boolean;
  onAiNoticeResolved: (optOut: boolean) => void;
  // Client-observed ms timestamp of the last live "read" event for this
  // conversation, or null if none has landed yet this session (an
  // already-read conversation opened fresh shows a bare "Read" instead
  // of "Read {time}" — see ChatApp.tsx's readAtByConversation).
  readAt: number | null;
  typingUsers: { owner_id: number; owner_name: string }[];
  connected: boolean;
  hasMoreOlder: boolean;
  onLoadOlder: () => void;
  onSend: (body: string, mentions: number[], replyToId: number | null, imageUrl: string | null, title?: string) => void;
  onReact: (messageId: number, emoji: string) => void;
  onDelete: (messageId: number) => void;
  onTyping: () => void;
  onBack: () => void;
}) {
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [newMessageWaiting, setNewMessageWaiting] = useState(false);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const isGroupConversation = conversation.type === "league" || conversation.type === "commish_corner";
  // Commish's Corner reads as a feed of tap-to-expand announcement
  // cards (matching History's own card list), not a chat bubble
  // stream — a commissioner's post is closer to a short article than
  // a quick message. See AnnouncementFeed.tsx/AnnouncementCard.tsx.
  const isAnnouncementFeed = conversation.type === "commish_corner";
  const listRef = useRef<HTMLDivElement>(null);
  const prevMessageCount = useRef(messages.length);
  // -1 never matches a real conversation id, unlike initializing this
  // to conversation.id itself (the previous version) — that made the
  // very first render's "did the conversation change?" check below
  // trivially false (it's being compared against itself), so the
  // scroll-to-bottom effect only ever ran on a SUBSEQUENT conversation
  // switch, never for whichever conversation is already selected on
  // Chat's initial page load. A real messaging app always opens
  // scrolled to the latest message, including the very first time.
  const prevConversationId = useRef(-1);

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

  const title =
    conversation.type === "league"
      ? "Weekend League"
      : conversation.type === "commish_corner"
        ? "Commish's Corner"
        : conversation.other_owner_name ?? "Direct Message";
  // -1 never matches a real owner_id — a harmless always-false fallback
  // for the league conversation, where there's no single "other" person
  // to show presence for. Hooks always run either way (rules of hooks).
  const otherOnline = usePresence(conversation.other_owner_id ?? -1, false);
  const subtitle =
    conversation.type === "league" || conversation.type === "commish_corner"
      ? `${conversation.member_count} managers`
      : otherOnline
        ? "Online now"
        : connected
          ? "Connected"
          : "Reconnecting…";

  // "Delivered"/"Read {time}" under my own last bubble — direct
  // conversations only (a group thread has no single "read by whom" to
  // report, the same reason iMessage itself never shows this in a group
  // chat), and only when I've kept my own Read Receipts preference on
  // (the OTHER side's own preference already gates other_last_read_
  // message_id itself, server-side — see lib/api.ts's docstring on it).
  let readReceipt: string | null = null;
  if (conversation.type === "direct" && readReceiptsEnabled) {
    const myLastMessage = [...messages].reverse().find((m) => m.owner_id === myOwnerId && !m.deleted);
    if (myLastMessage) {
      const wasRead =
        conversation.other_last_read_message_id !== null && conversation.other_last_read_message_id >= myLastMessage.id;
      readReceipt = wasRead ? (readAt ? `Read ${formatMessageTimestamp(new Date(readAt).toISOString())}` : "Read") : "Delivered";
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div
        className="flex items-center gap-2 border-b-2 px-4 py-3"
        style={{ borderColor: "color-mix(in srgb, var(--wl-accent) 55%, transparent)" }}
      >
        <button
          onClick={onBack}
          className="mr-1 text-xl sm:hidden"
          style={{ color: "var(--wl-accent)" }}
          aria-label="Back to Messages"
        >
          ‹
        </button>
        {isGroupConversation ? (
          <button
            onClick={() => setShowGroupInfo(true)}
            className="flex min-w-0 flex-col text-left"
            aria-label={`${title} info — see who's in this chat`}
          >
            <span className="flex items-center gap-1.5 truncate font-display font-bold" style={{ color: "var(--wl-text)" }}>
              {conversation.type === "commish_corner" && <span aria-hidden>📢</span>}
              {title}
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--wl-accent)" }} aria-hidden />
            </span>
            <span className="truncate text-xs" style={{ color: "var(--wl-text-secondary)" }}>
              {subtitle}
            </span>
          </button>
        ) : (
          <div className="flex min-w-0 flex-col">
            <span className="flex items-center gap-1.5 truncate font-display font-bold" style={{ color: "var(--wl-text)" }}>
              {title}
              {otherOnline && (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: "var(--wl-accent)" }}
                  role="img"
                  aria-label="Online now"
                  title="Online now"
                />
              )}
            </span>
            <span className="truncate text-xs" style={{ color: "var(--wl-text-secondary)" }}>{subtitle}</span>
          </div>
        )}
      </div>

      {showGroupInfo && <GroupInfoModal conversation={conversation} onClose={() => setShowGroupInfo(false)} />}

      {isAnnouncementFeed ? (
        <AnnouncementFeed messages={messages} myOwnerId={myOwnerId} beta={beta} onReact={onReact} onDelete={onDelete} />
      ) : (
        <div
          ref={listRef}
          onScroll={handleScroll}
          // min-h-0 is load-bearing — see AnnouncementFeed.tsx's own
          // comment on its identical class for the full reasoning (a
          // flex item's default auto min-height is its own content
          // size, not 0, so without this a long real thread can't
          // shrink to fit the panel's fixed height and pushes the
          // composer below it instead of scrolling internally).
          //
          // overflow-x-hidden is a real fix, not defensive boilerplate
          // (real report, 2026-09-20: the whole thread panned left-right
          // on mobile instead of scrolling like iMessage). Setting only
          // overflow-y here made the browser compute overflow-x to
          // `auto` too (a genuine CSS rule: an element with one axis set
          // to auto/scroll and the other left at its visible default
          // gets that other axis promoted to auto as well) — so any
          // child that refused to shrink below its content width (a
          // long reply-preview snippet, fixed by min-w-0 in
          // MessageBubble.tsx) turned this into a real horizontal
          // scroll/pan area instead of being clipped.
          className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-4 py-3"
        >
          {hasMoreOlder && (
            <div className="mb-3 flex justify-center">
              <button
                onClick={onLoadOlder}
                className="rounded-full border px-3 py-1 text-xs transition-colors"
                style={{ borderColor: "var(--wl-border)", color: "var(--wl-text-secondary)" }}
              >
                Load earlier messages
              </button>
            </div>
          )}

          {messages.length === 0 ? (
            <p className="mt-8 text-center text-sm" style={{ color: "var(--wl-text-secondary)" }}>No messages yet — say something.</p>
          ) : (
            messages.map((m, i) => (
              <MessageBubble
                key={m.id}
                message={m}
                mine={m.owner_id === myOwnerId}
                grouped={isGroupedWithPrevious(m, messages[i - 1])}
                groupedWithNext={isGroupedWithNext(m, messages[i + 1])}
                highlightMention={mentionHighlightingEnabled && m.mentions.includes(myOwnerId)}
                memberNames={memberNames}
                onReply={setReplyTo}
                onReact={onReact}
                onDelete={onDelete}
                onScrollToMessage={scrollToMessage}
              />
            ))
          )}
          {readReceipt && (
            <p className="mt-1 px-1 text-right text-[11px] text-black/35 dark:text-white/35">{readReceipt}</p>
          )}
        </div>
      )}

      <div className="relative">
        {!isAnnouncementFeed && newMessageWaiting && (
          <button
            onClick={() => scrollToBottom("smooth")}
            className="absolute -top-10 left-1/2 -translate-x-1/2 rounded-full bg-[var(--wl-accent-dim)] px-3 py-1 text-xs font-medium text-white shadow-lg"
          >
            ↓ New message
          </button>
        )}
        {!isAnnouncementFeed && typingUsers.length > 0 && (
          <div className="absolute -top-7 left-4 flex items-center gap-1 text-xs text-black/50 dark:text-white/50">
            <TypingDots />
            {typingUsers.length === 1
              ? `${typingUsers[0].owner_name} is typing…`
              : typingUsers.length === 2
                ? `${typingUsers[0].owner_name} and ${typingUsers[1].owner_name} are typing…`
                : `${typingUsers.length} people are typing…`}
          </div>
        )}

        {isAnnouncementFeed ? (
          conversation.can_post ? (
            <PostAnnouncementForm
              onPost={(postTitle, body) => onSend(body, [], null, null, postTitle)}
              aiNoticeSeen={aiNoticeSeen}
              onAiNoticeResolved={onAiNoticeResolved}
            />
          ) : (
            <div className="flex items-center justify-center gap-2 border-t border-black/10 px-4 py-3 text-sm text-black/50 dark:border-white/10 dark:text-white/50">
              <span aria-hidden>🔒</span>
              Only your commissioner can post here
            </div>
          )
        ) : conversation.can_post ? (
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
        ) : (
          <div className="flex items-center justify-center gap-2 border-t border-black/10 px-4 py-3 text-sm text-black/50 dark:border-white/10 dark:text-white/50">
            <span aria-hidden>🔒</span>
            Only your commissioner can post here
          </div>
        )}
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
