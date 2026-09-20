"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createWatchPartyRoom,
  deleteChatMessage,
  getChatConversationMessages,
  getChatMembers,
  getChatWebSocketUrl,
  getChatWsTicket,
  getPreferences,
  getWatchPartyRooms,
  markConversationRead,
  reactToMessage,
  startDirectConversation,
  updatePreferences,
  type ChatConversation,
  type ChatMember,
  type ChatMessage,
  type OwnerPreferences,
  type WatchPartyRoom as WatchPartyRoomInfo,
  type WatchPartyRoomsResponse,
} from "@/lib/api";
import { ConversationList } from "@/components/chat/ConversationList";
import { MessageThread } from "@/components/chat/MessageThread";
import { NewMessageModal } from "@/components/chat/NewMessageModal";
import { NewPartyModal } from "@/components/watchparty/NewPartyModal";
import { WatchPartyBar } from "@/components/watchparty/WatchPartyBar";
import { WatchPartyRoom } from "@/components/watchparty/WatchPartyRoom";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";

const RECONNECT_DELAY_MS = 2000;
const TYPING_CLEAR_MS = 3000;
const PAGE_SIZE = 50;
// A busy league chat left open all day (game day, especially) grew
// messagesByConversation[id] with no ceiling — every live message ever
// received stayed mounted in MessageThread.tsx (no virtualization
// there), each one potentially carrying a full-resolution, still-
// animated GIF that WebKit keeps decoded for as long as it's mounted
// (2026-09 memory audit, following a real iOS reload/crash report).
// Capped at the live-append site only, not loadOlder's prepend below —
// that path is explicit, deliberate user action (clicking "load
// earlier" dozens of times is self-limiting in practice), and capping
// it too would make a "load older" click that crosses this ceiling
// appear to silently do nothing, which is a worse bug than the memory
// growth this fixes.
const MAX_LIVE_MESSAGES_PER_CONVERSATION = 200;

function capMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.length > MAX_LIVE_MESSAGES_PER_CONVERSATION
    ? messages.slice(messages.length - MAX_LIVE_MESSAGES_PER_CONVERSATION)
    : messages;
}

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
  initialConversationId,
}: {
  initialConversations: ChatConversation[];
  myOwnerId: number;
  // Set from ?conversation=<id> on the URL (see (chat)/chat/page.tsx) —
  // real report, 2026-09: every chat push notification opened bare
  // /chat, which always lands on the most-recent conversation
  // regardless of which thread the notification was actually about.
  // Only trusted when it's actually one of this owner's own
  // conversations (a stale/tampered/expired id falls back to the
  // existing default below, same as if no id had been passed at all —
  // never a broken or blank chat screen).
  initialConversationId?: number | null;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  // Opens to the conversation list, like iMessage does, rather than
  // always auto-selecting the first conversation — which (per
  // conversationTypeRank above) is always Commish's Corner, so every
  // single chat visit used to jump straight into it regardless of what
  // the person actually wanted to look at. A ?conversation=<id> deep
  // link (push notification, see initialConversationId's own comment)
  // is the one case that still lands directly on a thread, since that's
  // an explicit destination, not a default.
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    if (
      initialConversationId != null &&
      initialConversations.some((c) => c.id === initialConversationId)
    ) {
      return initialConversationId;
    }
    return null;
  });
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

  // 2026-09: reverted the KEYBOARD-reactive half of the JS that used to
  // live here (three separate attempts today: a computed pixel height
  // from visualViewport math, then a position:fixed panel with JS-
  // published CSS custom properties) — that was fighting the keyboard
  // instead of trusting layout.tsx's interactiveWidget:"resizes-content",
  // which already does the real work natively (confirmed: Free Agents'
  // search box needs zero keyboard-specific JS and just works). This
  // effect is NOT that: it never touches visualViewport and never
  // reacts to the keyboard at all — it measures a genuinely different,
  // boring thing, once, on mount and on a real window resize only
  // (window.resize famously does NOT reliably fire for an iOS keyboard
  // open/close, which is exactly why it's safe here and wasn't enough
  // on its own for the keyboard case above): how tall the real header +
  // ticker chrome above this panel actually is. That number isn't a
  // fixed constant — AppTickerBar renders a second row only when there's
  // current-week league data — so a hardcoded guess (this file's
  // previous version used a flat 3.5rem, header-only, missing the
  // ticker entirely) undercounts it by however tall the ticker turns
  // out to be, which is exactly what pushed this panel's computed
  // height too tall and hid the composer below the visible screen
  // (2026-09-04 report). `--chat-top-offset` feeds the static `100dvh`
  // calc below; 100dvh itself is what actually shrinks natively when
  // the keyboard opens, no further JS involved.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function measure() {
      if (!panelRef.current) return;
      const top = panelRef.current.getBoundingClientRect().top;
      document.documentElement.style.setProperty("--chat-top-offset", `${top}px`);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
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

  const [watchPartyRooms, setWatchPartyRooms] = useState<WatchPartyRoomsResponse | null>(null);
  const [activeWatchPartyRoom, setActiveWatchPartyRoom] = useState<WatchPartyRoomInfo | null>(null);
  const [showNewParty, setShowNewParty] = useState(false);

  useEffect(() => {
    getWatchPartyRooms().then(setWatchPartyRooms).catch(() => {});
  }, []);

  async function createParty(name: string, invitedOwnerIds: number[]) {
    const id = await createWatchPartyRoom(name, invitedOwnerIds);
    const rooms = await getWatchPartyRooms().catch(() => null);
    if (rooms) setWatchPartyRooms(rooms);
    setShowNewParty(false);
    const created = rooms?.private_rooms.find((r) => r.id === id);
    if (created) setActiveWatchPartyRoom(created);
  }

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

  // Whichever conversation ends up selected on first render — the
  // league conversation by default, or a specific one from
  // initialConversationId above — still needs its own messages loaded
  // and read-marked; this is the one legitimate "run once on mount"
  // case. Deferred a tick
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

  // A Watch Party room's chat panel isn't reached through
  // selectConversation (it's not in the `conversations` list at all —
  // see backend's list_conversations_for_owner) so it needs this same
  // "load once, mark read" treatment triggered independently, the
  // moment a room is actually opened.
  useEffect(() => {
    const conversationId = activeWatchPartyRoom?.conversation_id;
    if (conversationId == null) return;
    if (!loadedConversations.current.has(conversationId)) {
      loadConversationMessages(conversationId);
    }
    markConversationRead(conversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWatchPartyRoom?.conversation_id]);

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

      // Reports real document.visibilityState alongside PresenceProvider.tsx's
      // own identical reporting on its separate socket — see that
      // component's comment and app/chat/manager.py's
      // has_visible_connection docstring for the real push-notification
      // bug this fixes (a socket being open at all used to be treated
      // as "actively watching chat," true even fully backgrounded).
      function sendVisibility() {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "visibility", visible: document.visibilityState === "visible" }));
        }
      }
      document.addEventListener("visibilitychange", sendVisibility);

      socket.onopen = () => {
        setConnected(true);
        sendVisibility();
      };
      socket.onclose = (event) => {
        setConnected(false);
        document.removeEventListener("visibilitychange", sendVisibility);
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
          return { ...prev, [message.conversation_id]: capMessages([...existing, message]) };
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
        const { message_id, conversation_id, emoji, owner_id, owner_name, added } = event as {
          message_id: number;
          conversation_id: number;
          emoji: string;
          owner_id: number;
          owner_name: string;
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
                    reactor_names: [...reactions[idx].reactor_names, owner_name].sort(),
                  };
                } else {
                  reactions.push({ emoji, count: 1, reacted_by_me: owner_id === myOwnerId, reactor_names: [owner_name] });
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
                    reactor_names: reactions[idx].reactor_names.filter((n) => n !== owner_name),
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

  // Takes an explicit conversationId (not always `selectedId`) so the
  // Watch Party room's own chat panel — a separate part of this same
  // tree, not the selected Messages thread — can send over this exact
  // socket/connection too, rather than opening a second one. The
  // server-side gate is participant-row membership for whatever
  // conversation_id arrives, not "was this in the conversations list
  // this component happened to fetch" (confirmed in Phase 3 research),
  // so any conversation this owner is really a participant of works.
  function sendMessage(
    conversationId: number,
    body: string,
    mentions: number[],
    replyToId: number | null,
    imageUrl: string | null,
    title?: string
  ) {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(
      JSON.stringify({
        type: "message",
        conversation_id: conversationId,
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

  function sendTyping(conversationId: number) {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify({ type: "typing", conversation_id: conversationId }));
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

  // Settings > Labs > "Try the new look" — Documentation/UX/
  // 00_UX_Audit.md's single biggest Chat finding: a rotating glow ring
  // animating continuously around the app's most dynamic, constantly-
  // updating surface (new messages, typing dots, reactions) was the
  // clearest tonal mismatch found anywhere in the app. Flat under beta.
  // Derived straight from `preferences` (already fetched above for
  // message-preview/mention/read-receipt settings) rather than a
  // threaded prop — briefly false until that fetch resolves, same
  // "default true until loaded" tradeoff those other reads already make.
  const beta = preferences?.beta_layout ?? false;

  return (
    <div
      ref={panelRef}
      className={
        beta
          ? // Labs > "Try the new look" mobile chrome (MobileNavDrawer.tsx)
            // removes the bottom tab bar entirely on mobile — no more
            // 4.5rem to reserve above it, unlike the legacy branch below,
            // which still has a real fixed bottom bar to clear. The
            // fallback before --chat-top-offset (2rem plus the safe-area
            // subtraction has its own fallback wired below) matches
            // PageShell.tsx's `[data-wl-layout="beta"] .wl-page-shell`
            // top-padding override, not this branch's own arbitrary
            // guess — the real value always comes from the effect above
            // measuring the panel's actual rendered position.
            "wl-card relative flex overflow-hidden rounded-none h-[calc(100dvh-var(--chat-top-offset,6rem)-env(safe-area-inset-bottom))] sm:h-[calc(100dvh-6rem)] sm:rounded-xl"
          : "neon-panel relative flex overflow-hidden rounded-none h-[calc(100dvh-var(--chat-top-offset,7rem)-4.5rem-env(safe-area-inset-bottom))] sm:h-[calc(100dvh-6rem)] sm:rounded-xl"
      }
      style={beta ? undefined : panelGlowStyle(SECTION_COLORS.chat)}
    >
      <div className={`h-full w-full sm:flex ${selectedId !== null ? "hidden sm:flex" : "flex"}`}>
        <ConversationList
          conversations={conversations}
          selectedId={selectedId}
          messagePreviewsEnabled={preferences?.message_previews_enabled ?? true}
          onSelect={selectConversation}
          onNewMessage={() => setShowNewMessage(true)}
          topSlot={
            <WatchPartyBar
              rooms={watchPartyRooms}
              onJoin={setActiveWatchPartyRoom}
              onStartParty={() => setShowNewParty(true)}
            />
          }
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
            beta={beta}
            hasMoreOlder={hasMoreByConversation[selectedConversation.id] ?? false}
            onLoadOlder={loadOlder}
            onSend={(body, mentions, replyToId, imageUrl, title) =>
              sendMessage(selectedConversation.id, body, mentions, replyToId, imageUrl, title)
            }
            onReact={react}
            onDelete={remove}
            onTyping={() => sendTyping(selectedConversation.id)}
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

      {showNewParty && <NewPartyModal members={members} onClose={() => setShowNewParty(false)} onCreate={createParty} />}

      {activeWatchPartyRoom && (
        <WatchPartyRoom
          room={activeWatchPartyRoom}
          onClose={() => setActiveWatchPartyRoom(null)}
          messages={messagesByConversation[activeWatchPartyRoom.conversation_id] ?? []}
          members={members}
          myOwnerId={myOwnerId}
          connected={connected}
          typingUsers={typingByConversation[activeWatchPartyRoom.conversation_id] ?? []}
          aiNoticeSeen={preferences?.ai_training_notice_seen ?? false}
          onAiNoticeResolved={resolveAiTrainingNotice}
          onSend={(body, mentions, replyToId, imageUrl) =>
            sendMessage(activeWatchPartyRoom.conversation_id, body, mentions, replyToId, imageUrl)
          }
          onReact={react}
          onDelete={remove}
          onTyping={() => sendTyping(activeWatchPartyRoom.conversation_id)}
        />
      )}
    </div>
  );
}
