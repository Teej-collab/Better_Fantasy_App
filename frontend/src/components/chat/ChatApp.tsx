"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  type ChatConversation,
  type ChatMember,
  type ChatMessage,
  type OwnerPreferences,
} from "@/lib/api";
import { ConversationList } from "@/components/chat/ConversationList";
import { MessageThread } from "@/components/chat/MessageThread";
import { NewMessageModal } from "@/components/chat/NewMessageModal";

const RECONNECT_DELAY_MS = 2000;
const TYPING_CLEAR_MS = 3000;
const PAGE_SIZE = 50;

type TypingUser = { owner_id: number; owner_name: string };

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
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [connected, setConnected] = useState(false);
  const [showNewMessage, setShowNewMessage] = useState(false);
  // Settings > Chat — message-preview and mention-highlighting default
  // to on (matching the backend's own defaults) until the real values
  // load, so there's no flash of "off" before the fetch resolves.
  const [preferences, setPreferences] = useState<OwnerPreferences | null>(null);

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
            .sort((a, b) => Number(b.type === "league") - Number(a.type === "league"));
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
      } else if (event.type === "deleted") {
        const { message_id, conversation_id } = event as { message_id: number; conversation_id: number };
        setMessagesByConversation((prev) => {
          const existing = prev[conversation_id];
          if (!existing) return prev;
          return {
            ...prev,
            [conversation_id]: existing.map((m) => (m.id === message_id ? { ...m, deleted: true, body: "This message was deleted." } : m)),
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

  function sendMessage(body: string, mentions: number[], replyToId: number | null, imageUrl: string | null) {
    if (selectedId === null || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(
      JSON.stringify({
        type: "message",
        conversation_id: selectedId,
        body,
        mentions,
        reply_to_id: replyToId,
        image_url: imageUrl,
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
          unread_count: 0,
          last_message: null,
        },
      ]);
    }
    selectConversation(conversationId);
  }

  const selectedConversation = conversations.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="neon-panel relative flex h-[calc(100dvh-3.5rem-4.5rem-env(safe-area-inset-bottom))] overflow-hidden rounded-none sm:h-[calc(100dvh-6rem)] sm:rounded-xl">
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
        <div className="hidden flex-1 items-center justify-center text-sm text-black/40 sm:flex dark:text-white/40">
          Select a conversation
        </div>
      )}

      {showNewMessage && (
        <NewMessageModal members={members} onClose={() => setShowNewMessage(false)} onSelect={startNewConversation} />
      )}
    </div>
  );
}
