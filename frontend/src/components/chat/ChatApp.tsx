"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  deleteChatMessage,
  getChatConversationMessages,
  getChatMembers,
  getChatWebSocketUrl,
  getChatWsTicket,
  getPreferences,
  markConversationRead,
  reactToMessage,
  startDirectConversation,
  updatePreferences,
  type ChatConversation,
  type ChatMember,
  type ChatMessage,
  type OwnerPreferences,
} from "@/lib/api";
import { ConversationList } from "@/components/chat/ConversationList";
import { MessageThread } from "@/components/chat/MessageThread";
import { NewMessageModal } from "@/components/chat/NewMessageModal";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";

const RECONNECT_DELAY_MS = 2000;
const TYPING_CLEAR_MS = 3000;
const PAGE_SIZE = 50;

type TypingUser = { owner_id: number; owner_name: string };

// Mirrors the backend's own pin order (app/queries/chat.py's
// list_conversations_for_owner: commish_corner, then league, then
// everything else — announcements pinned above ordinary chat) — kept
// in sync here only for the case of a live message reordering the list
// client-side; the initial server-rendered order already comes
// pre-sorted this way.
function conversationTypeRank(type: ChatConversation["type"]): number {
  if (type === "commish_corner") return 0;
  if (type === "league") return 1;
  return 2;
}

export function ChatApp({
  initialConversations,
  myOwnerId,
}: {
  initialConversations: ChatConversation[];
  myOwnerId: number;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedId, setSelectedId] = useState<number | null>(
    initialConversations.length > 0 ? initialConversations[0].id : null
  );
  const [messagesByConversation, setMessagesByConversation] = useState<Record<number, ChatMessage[]>>({});
  const [hasMoreByConversation, setHasMoreByConversation] = useState<Record<number, boolean>>({});
  const [typingByConversation, setTypingByConversation] = useState<Record<number, TypingUser[]>>({});
  // Client-observed moment a live "read" WebSocket event landed for a
  // conversation — the backend only tracks last_read_message_id, not
  // when that happened, so this is an approximation (real enough for
  // "Read {time}" to feel right) rather than the recipient's actual
  // read timestamp. A conversation opened already-read (the initial
  // server-rendered other_last_read_message_id, no live event yet in
  // this session) has no entry here, so its receipt shows a bare "Read".
  const [readAtByConversation, setReadAtByConversation] = useState<Record<number, number>>({});
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [connected, setConnected] = useState(false);
  const [showNewMessage, setShowNewMessage] = useState(false);
  // Settings > Chat — message-preview and mention-highlighting default
  // to on (matching the backend's own defaults) until the real values
  // load, so there's no flash of "off" before the fetch resolves.
  const [preferences, setPreferences] = useState<OwnerPreferences | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  // Mobile has no room to spare, so the panel's height has to be exact:
  // `100dvh` minus whatever chrome actually rendered above it (NavBar's
  // header, plus AppTickerBar's ticker strip(s) — one when there's no
  // current-week league data, two when there is) minus the fixed
  // BottomNav below it. Neither the ticker's nor BottomNav's height is a
  // fixed constant we can bake into a Tailwind class the way the
  // header's is — BottomNav in particular grows a third row on its
  // Gamecast tab whenever a game is live (see BottomNav.tsx's LiveMark),
  // so a hardcoded guess at its height goes stale the moment that row
  // appears. Instead of guessing either side, this measures the panel's
  // real distance from the top of the viewport AND BottomNav's real
  // rendered height (id="app-bottom-nav", watched with a ResizeObserver
  // so this stays correct even if that bar's height changes after mount,
  // not just on a window resize) and lets both stand in for "however
  // tall things actually turned out to be." Getting this wrong doesn't
  // just look off — the leftover height renders the composer underneath
  // the fixed BottomNav, which no amount of scrolling can ever reveal
  // since a fixed element covers the same screen-space band regardless
  // of scroll position (this happened for real once BottomNav grew its
  // live-game row — see this component's git history). `null` here means
  // "not measured yet (or we're at sm: and up, where there's no fixed
  // BottomNav and the desktop `sm:h-[...]` class already handles it)" —
  // the JSX below falls back to the old fixed-header-only estimate for
  // that brief pre-hydration window.
  const [mobileHeight, setMobileHeight] = useState<string | null>(null);

  useLayoutEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 640px)");
    let bottomNavHeight = 72; // 4.5rem-equivalent fallback, in case the element isn't found yet

    function measure() {
      if (desktopQuery.matches || !panelRef.current) {
        setMobileHeight(null);
        return;
      }
      const top = panelRef.current.getBoundingClientRect().top;
      const viewport = window.visualViewport;
      if (viewport) {
        // Pixel math against the real visual viewport, not a `100dvh`
        // CSS calc string — `dvh` and `fixed bottom-0` both assume the
        // browser actually honors layout.tsx's interactiveWidget:
        // "resizes-content" viewport meta, which isn't reliable on
        // every real device (confirmed live: BottomNav's own position
        // ended up floating disconnected from both this panel and the
        // keyboard on an actual phone). BottomNav.tsx's own
        // useKeyboardInset applies the identical
        // visualViewport-vs-window.innerHeight gap as a translateY, so
        // this mirrors that exact math rather than a separate guess,
        // keeping the panel's bottom edge and the nav bar's repositioned
        // top edge landing in the same place.
        const availableBottom = viewport.height + viewport.offsetTop;
        setMobileHeight(`${Math.max(0, availableBottom - top - bottomNavHeight)}px`);
      } else {
        setMobileHeight(`calc(100dvh - ${top}px - ${bottomNavHeight}px - env(safe-area-inset-bottom))`);
      }
    }

    const bottomNavEl = document.getElementById("app-bottom-nav");
    let resizeObserver: ResizeObserver | null = null;
    if (bottomNavEl) {
      bottomNavHeight = bottomNavEl.getBoundingClientRect().height || bottomNavHeight;
      resizeObserver = new ResizeObserver((entries) => {
        const height = entries[0]?.contentRect.height;
        if (height) {
          bottomNavHeight = height;
          measure();
        }
      });
      resizeObserver.observe(bottomNavEl);
    }

    // requestAnimationFrame, not a bare call — iOS Safari can fire
    // visualViewport's own events a frame before the WebKit layout
    // engine has actually finished resettling the page after the
    // keyboard opens/closes, so measuring synchronously inside the
    // event handler sometimes captures a still-transitioning `top`.
    function scheduleMeasure() {
      requestAnimationFrame(measure);
    }

    measure();
    window.addEventListener("resize", scheduleMeasure);
    desktopQuery.addEventListener("change", scheduleMeasure);
    // The real fix for the stuck-bottom-nav-after-keyboard-close bug:
    // plain `window.resize` doesn't reliably fire (or fires with stale
    // geometry) when iOS Safari's on-screen keyboard opens/closes —
    // `visualViewport` is the API actually built for tracking exactly
    // this, and its own `resize` AND `scroll` events both matter here
    // (iOS also scrolls the page to keep the focused composer visible
    // above the keyboard, which moves panelRef's measured `top` without
    // necessarily firing a `resize` at all).
    window.visualViewport?.addEventListener("resize", scheduleMeasure);
    window.visualViewport?.addEventListener("scroll", scheduleMeasure);
    return () => {
      window.removeEventListener("resize", scheduleMeasure);
      desktopQuery.removeEventListener("change", scheduleMeasure);
      window.visualViewport?.removeEventListener("resize", scheduleMeasure);
      window.visualViewport?.removeEventListener("scroll", scheduleMeasure);
      resizeObserver?.disconnect();
    };
  }, []);

  // Locks the actual page/document scroll position at 0 for as long as
  // Chat is open (2026-09) — every height calculation above, and
  // BottomNav's own useKeyboardInset, assumes the PAGE itself never
  // scrolls, only this panel's own internal message list does. That
  // held for ordinary touch scrolling once PullToRefresh.tsx stopped
  // hijacking nested-scrollable gestures, but tapping the composer to
  // open the on-screen keyboard is a separate path: mobile Safari's own
  // "keep the focused input visible" behavior scrolls the DOCUMENT
  // (not just the visual viewport) to bring the composer above the
  // keyboard, which — since nothing here was pinning document scroll —
  // dragged the whole page up with it, including the NavBar/ticker
  // above this panel, exactly the "chat is broken" symptom reported
  // live (2026-09-04 recording: the header and ticker scroll off-
  // screen the moment the keyboard opens). Restores the previous
  // inline styles (not a hardcoded reset) on unmount so leaving Chat
  // never clobbers some other page's own scroll behavior.
  useEffect(() => {
    const { body } = document;
    const previous = { overflow: body.style.overflow, position: body.style.position, width: body.style.width, top: body.style.top };
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.width = "100%";
    body.style.top = "0";
    return () => {
      body.style.overflow = previous.overflow;
      body.style.position = previous.position;
      body.style.width = previous.width;
      body.style.top = previous.top;
    };
  }, []);

  const socketRef = useRef<WebSocket | null>(null);
  const typingTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const loadedConversations = useRef(new Set<number>());
  // Mirrors `selectedId` for the WebSocket handler below, which is set up
  // once (empty dep array) and would otherwise only ever see the
  // conversation that was selected at connect time — refs are the
  // correct way to hand a closure created once "the latest value" of
  // something that changes, so this is updated in an effect (a ref
  // mutation during render itself isn't allowed) rather than read
  // directly from the closure.
  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    getChatMembers().then(setMembers);
  }, []);

  useEffect(() => {
    getPreferences().then(setPreferences).catch(() => {});
  }, []);

  const loadConversationMessages = useCallback(async (conversationId: number) => {
    const page = await getChatConversationMessages(conversationId);
    setMessagesByConversation((prev) => ({ ...prev, [conversationId]: page }));
    setHasMoreByConversation((prev) => ({ ...prev, [conversationId]: page.length >= PAGE_SIZE }));
    loadedConversations.current.add(conversationId);
  }, []);

  // Marking a conversation read is triggered from two real events, never
  // from a plain effect watching state: selecting it (selectConversation
  // below) and a live message arriving for the one already open (inside
  // the WebSocket's onmessage handler further down) — both are genuine
  // callbacks, not synchronous setState calls sitting in an effect body.
  function selectConversation(id: number) {
    setSelectedId(id);
    if (!loadedConversations.current.has(id)) {
      loadConversationMessages(id);
    }
    markConversationRead(id);
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unread_count: 0 } : c)));
  }

  // The conversation selected by default on first render (the league
  // conversation) still needs its own messages loaded and read-marked —
  // this is the one legitimate "run once on mount" case. Deferred a tick
  // (queueMicrotask) rather than calling the loader functions directly in
  // the effect body — both are locally-defined async functions whose
  // eventual setState calls happen after their own internal `await`, but
  // the lint rule can't see through that, only through an explicit defer.
  useEffect(() => {
    if (selectedId !== null) {
      queueMicrotask(() => {
        loadConversationMessages(selectedId);
        markConversationRead(selectedId);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- WebSocket lifecycle -------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket;
    const timeouts = typingTimeouts.current;

    async function connect() {
      if (cancelled) return;
      const ticket = await getChatWsTicket();
      if (cancelled) return;
      if (!ticket) {
        // Not actually signed in (or the mint call failed) — nothing
        // to reconnect toward, so don't loop retrying forever.
        return;
      }
      socket = new WebSocket(getChatWebSocketUrl(ticket));
      socketRef.current = socket;

      socket.onopen = () => setConnected(true);
      socket.onclose = (event) => {
        setConnected(false);
        if (!cancelled && event.code !== 4401) {
          setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };
      socket.onmessage = (event) => handleSocketEvent(JSON.parse(event.data));
    }

    function handleSocketEvent(event: Record<string, unknown>) {
      if (event.type === "message") {
        const message = event.message as ChatMessage;
        setMessagesByConversation((prev) => {
          const existing = prev[message.conversation_id] ?? [];
          if (existing.some((m) => m.id === message.id)) return prev;
          return { ...prev, [message.conversation_id]: [...existing, message] };
        });
        setConversations((prev) => {
          const isOpen = message.conversation_id === selectedIdRef.current;
          return prev
            .map((c) =>
              c.id === message.conversation_id
                ? {
                    ...c,
                    last_message: { id: message.id, owner_name: message.owner_name, body: message.body, created_at: message.created_at },
                    unread_count: isOpen || message.owner_id === myOwnerId ? c.unread_count : c.unread_count + 1,
                  }
                : c
            )
            .sort((a, b) => conversationTypeRank(a.type) - conversationTypeRank(b.type));
        });
        if (message.conversation_id === selectedIdRef.current) {
          markConversationRead(message.conversation_id);
        }
      } else if (event.type === "typing") {
        const conversationId = event.conversation_id as number;
        const ownerId = event.owner_id as number;
        const ownerName = event.owner_name as string;
        const key = `${conversationId}:${ownerId}`;

        setTypingByConversation((prev) => {
          const existing = prev[conversationId] ?? [];
          if (existing.some((u) => u.owner_id === ownerId)) return prev;
          return { ...prev, [conversationId]: [...existing, { owner_id: ownerId, owner_name: ownerName }] };
        });

        clearTimeout(typingTimeouts.current[key]);
        typingTimeouts.current[key] = setTimeout(() => {
          setTypingByConversation((prev) => ({
            ...prev,
            [conversationId]: (prev[conversationId] ?? []).filter((u) => u.owner_id !== ownerId),
          }));
        }, TYPING_CLEAR_MS);
      } else if (event.type === "reaction") {
        const { message_id, conversation_id, emoji, owner_id, added } = event as {
          message_id: number;
          conversation_id: number;
          emoji: string;
          owner_id: number;
          added: boolean;
        };
        setMessagesByConversation((prev) => {
          const existing = prev[conversation_id];
          if (!existing) return prev;
          return {
            ...prev,
            [conversation_id]: existing.map((m) => {
              if (m.id !== message_id) return m;
              const reactions = [...m.reactions];
              const idx = reactions.findIndex((r) => r.emoji === emoji);
              if (added) {
                if (idx >= 0) {
                  reactions[idx] = {
                    ...reactions[idx],
                    count: reactions[idx].count + 1,
                    reacted_by_me: reactions[idx].reacted_by_me || owner_id === myOwnerId,
                  };
                } else {
                  reactions.push({ emoji, count: 1, reacted_by_me: owner_id === myOwnerId });
                }
              } else if (idx >= 0) {
                const nextCount = reactions[idx].count - 1;
                if (nextCount <= 0) {
                  reactions.splice(idx, 1);
                } else {
                  reactions[idx] = {
                    ...reactions[idx],
                    count: nextCount,
                    reacted_by_me: owner_id === myOwnerId ? false : reactions[idx].reacted_by_me,
                  };
                }
              }
              return { ...m, reactions };
            }),
          };
        });
      } else if (event.type === "read") {
        // Only meaningful for a direct conversation (see other_last_
        // read_message_id's own docstring in lib/api.ts) — a "read"
        // event for the league/commish_corner conversation still
        // arrives (Read Receipts is a per-owner preference, not per-
        // conversation-type), it's just never rendered for those.
        const { conversation_id, owner_id, last_read_message_id } = event as {
          conversation_id: number;
          owner_id: number;
          last_read_message_id: number;
        };
        if (owner_id !== myOwnerId) {
          setConversations((prev) =>
            prev.map((c) => (c.id === conversation_id ? { ...c, other_last_read_message_id: last_read_message_id } : c))
          );
          setReadAtByConversation((prev) => ({ ...prev, [conversation_id]: Date.now() }));
        }
      } else if (event.type === "deleted") {
        // Removed outright, not marked deleted-in-place — a deleted
        // message shouldn't keep showing up in the thread at all
        // (backend's list_messages already excludes it the same way
        // on the next real fetch; this is what makes an ALREADY-open
        // thread match that immediately instead of only after reload).
        const { message_id, conversation_id } = event as { message_id: number; conversation_id: number };
        setMessagesByConversation((prev) => {
          const existing = prev[conversation_id];
          if (!existing) return prev;
          return {
            ...prev,
            [conversation_id]: existing.filter((m) => m.id !== message_id),
          };
        });
      }
    }

    connect();
    return () => {
      cancelled = true;
      socketRef.current?.close();
      Object.values(timeouts).forEach(clearTimeout);
    };
  }, [myOwnerId]);

  // ---- actions --------------------------------------------------------------

  function sendMessage(
    body: string,
    mentions: number[],
    replyToId: number | null,
    imageUrl: string | null,
    title?: string
  ) {
    if (selectedId === null || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(
      JSON.stringify({
        type: "message",
        conversation_id: selectedId,
        body,
        mentions,
        reply_to_id: replyToId,
        image_url: imageUrl,
        // Only ever meaningful for a Commish's Corner announcement
        // (app/routers/chat.py's WS handler requires it there, ignores
        // it everywhere else) — omitted, not sent as null, for a plain
        // chat message.
        ...(title ? { title } : {}),
      })
    );
  }

  function sendTyping() {
    if (selectedId === null || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify({ type: "typing", conversation_id: selectedId }));
  }

  async function react(messageId: number, emoji: string) {
    await reactToMessage(messageId, emoji);
  }

  async function remove(messageId: number) {
    await deleteChatMessage(messageId);
  }

  // Resolves MessageComposer's one-time AI-training consent warning —
  // persists both the choice and that it's been shown, so it never
  // shows again for this owner (Settings > Chat carries the same
  // toggle afterward for changing their mind).
  async function resolveAiTrainingNotice(optOut: boolean) {
    const updated = await updatePreferences({ ai_training_notice_seen: true, ai_training_opt_out: optOut });
    setPreferences(updated);
  }

  async function loadOlder() {
    if (selectedId === null) return;
    const current = messagesByConversation[selectedId] ?? [];
    if (current.length === 0) return;
    const page = await getChatConversationMessages(selectedId, { before: current[0].id });
    setMessagesByConversation((prev) => ({ ...prev, [selectedId]: [...page, ...current] }));
    setHasMoreByConversation((prev) => ({ ...prev, [selectedId]: page.length >= PAGE_SIZE }));
  }

  async function startNewConversation(ownerId: number) {
    const conversationId = await startDirectConversation(ownerId);
    setShowNewMessage(false);
    if (!conversations.some((c) => c.id === conversationId)) {
      const member = members.find((m) => m.owner_id === ownerId);
      setConversations((prev) => [
        ...prev,
        {
          id: conversationId,
          type: "direct",
          member_count: 2,
          other_owner_id: ownerId,
          other_owner_name: member?.display_name ?? "Direct Message",
          other_owner_chat_color: null,
          other_owner_logo_url: null,
          other_last_read_message_id: null,
          avatar_group: null,
          unread_count: 0,
          last_message: null,
          can_post: true,
        },
      ]);
    }
    selectConversation(conversationId);
  }

  const selectedConversation = conversations.find((c) => c.id === selectedId) ?? null;

  return (
    <div
      ref={panelRef}
      className={`neon-panel relative flex overflow-hidden rounded-none sm:h-[calc(100dvh-6rem)] sm:rounded-xl ${
        mobileHeight ? "" : "h-[calc(100dvh-3.5rem-4.5rem-env(safe-area-inset-bottom))]"
      }`}
      style={{ ...panelGlowStyle(SECTION_COLORS.chat), ...(mobileHeight ? { height: mobileHeight } : {}) }}
    >
      <div className={`h-full w-full sm:flex ${selectedId !== null ? "hidden sm:flex" : "flex"}`}>
        <ConversationList
          conversations={conversations}
          selectedId={selectedId}
          messagePreviewsEnabled={preferences?.message_previews_enabled ?? true}
          onSelect={selectConversation}
          onNewMessage={() => setShowNewMessage(true)}
        />
      </div>

      {selectedConversation ? (
        <div className={`h-full w-full sm:flex ${selectedId !== null ? "flex" : "hidden sm:flex"}`}>
          <MessageThread
            conversation={selectedConversation}
            messages={messagesByConversation[selectedConversation.id] ?? []}
            members={members}
            myOwnerId={myOwnerId}
            mentionHighlightingEnabled={preferences?.mention_highlighting_enabled ?? true}
            readReceiptsEnabled={preferences?.read_receipts_enabled ?? true}
            readAt={readAtByConversation[selectedConversation.id] ?? null}
            aiNoticeSeen={preferences?.ai_training_notice_seen ?? false}
            onAiNoticeResolved={resolveAiTrainingNotice}
            typingUsers={typingByConversation[selectedConversation.id] ?? []}
            connected={connected}
            hasMoreOlder={hasMoreByConversation[selectedConversation.id] ?? false}
            onLoadOlder={loadOlder}
            onSend={sendMessage}
            onReact={react}
            onDelete={remove}
            onTyping={sendTyping}
            onBack={() => setSelectedId(null)}
          />
        </div>
      ) : (
        <div className="hidden flex-1 items-center justify-center text-sm text-black/50 sm:flex dark:text-white/50">
          Select a conversation
        </div>
      )}

      {showNewMessage && (
        <NewMessageModal members={members} onClose={() => setShowNewMessage(false)} onSelect={startNewConversation} />
      )}
    </div>
  );
}
