"use client";

import { useEffect, useRef, useState } from "react";
import { postChatVideo, type ChatConversation, type ChatMember, type ChatMessage } from "@/lib/api";
import { AnnouncementFeed } from "@/components/chat/AnnouncementFeed";
import { GroupInfoModal } from "@/components/chat/GroupInfoModal";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { MessageComposer } from "@/components/chat/MessageComposer";
import { PostAnnouncementForm } from "@/components/chat/PostAnnouncementForm";
import { conversationTitle, formatMessageTimestamp, isGroupedWithNext, isGroupedWithPrevious } from "@/lib/chatFormat";
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
  onConversationChanged,
  onConversationDeleted,
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
  onConversationChanged?: () => void;
  onConversationDeleted?: () => void;
}) {
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [newMessageWaiting, setNewMessageWaiting] = useState(false);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  // Your videos on their way up, shown at the bottom of the thread right
  // away like iMessage; each disappears once the backend has sent the
  // real message (it arrives over the chat socket).
  const [outgoing, setOutgoing] = useState<OutgoingVideo[]>([]);
  const isGroupConversation =
    conversation.type === "league" || conversation.type === "commish_corner" || conversation.type === "group";
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

  async function uploadVideo(item: OutgoingVideo) {
    const update = (patch: Partial<OutgoingVideo>) =>
      setOutgoing((list) => list.map((o) => (o.key === item.key ? { ...o, ...patch } : o)));
    update({ status: "sending", progress: 0, error: undefined });
    try {
      await postChatVideo(conversation.id, item.file, item.body, item.replyToId, (progress) => update({ progress }));
      URL.revokeObjectURL(item.previewUrl);
      setOutgoing((list) => list.filter((o) => o.key !== item.key));
    } catch (e) {
      update({ status: "failed", error: e instanceof Error ? e.message : "Couldn't send that video." });
    }
  }

  function sendVideo(file: File, body: string) {
    const item: OutgoingVideo = {
      key: `${Date.now()}`,
      file,
      previewUrl: URL.createObjectURL(file),
      body,
      replyToId: replyTo?.id ?? null,
      status: "sending",
      progress: 0,
    };
    setReplyTo(null);
    setOutgoing((list) => [...list, item]);
    requestAnimationFrame(() => scrollToBottom("smooth"));
    void uploadVideo(item);
  }

  function discardVideo(item: OutgoingVideo) {
    URL.revokeObjectURL(item.previewUrl);
    setOutgoing((list) => list.filter((o) => o.key !== item.key));
  }

  function scrollToMessage(messageId: number) {
    document.getElementById(`chat-message-${messageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const title = conversationTitle(conversation);
  // -1 never matches a real owner_id — a harmless always-false fallback
  // for the league conversation, where there's no single "other" person
  // to show presence for. Hooks always run either way (rules of hooks).
  const otherOnline = usePresence(conversation.other_owner_id ?? -1, false);
  const subtitle =
    conversation.type === "group"
      ? `${conversation.member_count} people`
      : conversation.type === "league" || conversation.type === "commish_corner"
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
            <span className="flex items-center gap-1.5 min-w-0 wrap-break-word font-display font-bold" style={{ color: "var(--wl-text)" }}>
              {conversation.type === "commish_corner" && <span aria-hidden>📢</span>}
              {title}
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--wl-accent)" }} aria-hidden />
            </span>
            <span className="min-w-0 wrap-break-word text-xs" style={{ color: "var(--wl-text-secondary)" }}>
              {subtitle}
            </span>
          </button>
        ) : (
          <button
            onClick={() => setShowGroupInfo(true)}
            className="flex min-w-0 flex-col text-left"
            aria-label={`${title} info`}
          >
            <span className="flex items-center gap-1.5 min-w-0 wrap-break-word font-display font-bold" style={{ color: "var(--wl-text)" }}>
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
            <span className="min-w-0 wrap-break-word text-xs" style={{ color: "var(--wl-text-secondary)" }}>{subtitle}</span>
          </button>
        )}
      </div>

      {showGroupInfo && (
        <GroupInfoModal
          conversation={conversation}
          leagueMembers={members}
          onClose={() => setShowGroupInfo(false)}
          onChanged={onConversationChanged}
          onDeleted={() => {
            setShowGroupInfo(false);
            onConversationDeleted?.();
          }}
        />
      )}

      {isAnnouncementFeed ? (
        <AnnouncementFeed
          messages={messages}
          myOwnerId={myOwnerId}
          beta={beta}
          canSeeReceipts={conversation.can_post}
          onReact={onReact} onDelete={onDelete} />
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
          {outgoing.map((o) => (
            <OutgoingVideoBubble key={o.key} item={o} onRetry={() => void uploadVideo(o)} onDiscard={() => discardVideo(o)} />
          ))}
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
            conversationId={conversation.type === "commish_corner" ? undefined : conversation.id}
            onSendVideo={sendVideo}
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

type OutgoingVideo = {
  key: string;
  file: File;
  previewUrl: string;
  body: string;
  replyToId: number | null;
  status: "sending" | "failed";
  progress: number;
  error?: string;
};

// Your video on its way up: the local file plays as a preview with a
// progress ring, then the real message replaces it.
function OutgoingVideoBubble({ item, onRetry, onDiscard }: { item: OutgoingVideo; onRetry: () => void; onDiscard: () => void }) {
  const failed = item.status === "failed";
  const pct = Math.round(item.progress * 100);
  return (
    <div className="mt-2 flex flex-col items-end gap-1">
      <div className="relative w-fit max-w-full overflow-hidden rounded-xl bg-black">
        <video src={item.previewUrl} muted playsInline preload="metadata" className="max-h-80 w-[240px] max-w-full object-cover opacity-80" />
        <div className="absolute inset-0 flex items-center justify-center">
          {failed ? (
            <span className="rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white">Not delivered</span>
          ) : (
            <div
              className="flex h-12 w-12 items-center justify-center rounded-full text-[11px] font-semibold text-white"
              style={{ background: `conic-gradient(rgba(255,255,255,0.9) ${pct * 3.6}deg, rgba(0,0,0,0.55) 0deg)` }}
              role="progressbar"
              aria-valuenow={pct}
              aria-label="Sending video"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60">{pct < 100 ? `${pct}%` : "…"}</span>
            </div>
          )}
        </div>
      </div>
      {item.body && <div className="chat-bubble max-w-[80%] rounded-2xl bg-[var(--wl-accent-dim)] px-3 py-2 text-sm text-white opacity-80">{item.body}</div>}
      {failed ? (
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-red-500">{item.error}</span>
          <button onClick={onRetry} className="font-semibold text-[var(--wl-accent-dim)] hover:underline">
            Retry
          </button>
          <button onClick={onDiscard} className="text-black/50 hover:underline dark:text-white/50">
            Delete
          </button>
        </div>
      ) : (
        <span className="text-[11px] text-black/40 dark:text-white/40">{pct < 100 ? "Sending…" : "Almost there…"}</span>
      )}
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
