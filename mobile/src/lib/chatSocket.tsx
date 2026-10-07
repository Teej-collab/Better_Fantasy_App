import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { api, chatSocketUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { queryClient } from '@/lib/queries';
import type { ChatConversation, ChatMessage, ChatReaction } from '@/lib/types';

// Same timings as the web chat (frontend/src/components/chat/ChatApp.tsx).
const RECONNECT_DELAY_MS = 2000;
const TYPING_CLEAR_MS = 3000;

type Typist = { owner_id: number; owner_name: string };

type ChatSocketState = {
  connected: boolean;
  typingByConversation: Record<number, Typist[]>;
  send: (event: Record<string, unknown>) => boolean;
  // The conversation on screen: its new messages don't count as
  // unread, and get marked read as they arrive.
  setOpenConversation: (conversationId: number | null) => void;
};

const ChatSocketContext = createContext<ChatSocketState | null>(null);

type SocketEvent =
  | { type: 'message'; message: ChatMessage }
  | { type: 'typing'; conversation_id: number; owner_id: number; owner_name: string }
  | {
      type: 'reaction';
      message_id: number;
      conversation_id: number;
      emoji: string;
      owner_id: number;
      owner_name: string;
      added: boolean;
    }
  | { type: 'deleted'; message_id: number; conversation_id: number }
  // The commissioner just spun the Punishment Wheel: an open wheel screen
  // picks it up and plays the spin (app/punishment-wheel.tsx).
  | { type: 'wheel_spin'; league_id: number; season: number; landed_index: number; items: string[]; text: string }
  | { type: 'read' | 'error'; conversation_id: number };

// Same bookkeeping as ChatApp.tsx's "reaction" handler.
function applyReaction(
  reactions: ChatReaction[],
  e: Extract<SocketEvent, { type: 'reaction' }>,
  myOwnerId: number | null,
): ChatReaction[] {
  const next = [...reactions];
  const idx = next.findIndex((r) => r.emoji === e.emoji);
  const mine = e.owner_id === myOwnerId;
  if (e.added) {
    if (idx >= 0) {
      next[idx] = {
        ...next[idx],
        count: next[idx].count + 1,
        reacted_by_me: next[idx].reacted_by_me || mine,
        reactor_names: [...next[idx].reactor_names, e.owner_name].sort(),
      };
    } else {
      next.push({ emoji: e.emoji, count: 1, reacted_by_me: mine, reactor_names: [e.owner_name] });
    }
  } else if (idx >= 0) {
    const count = next[idx].count - 1;
    if (count <= 0) next.splice(idx, 1);
    else
      next[idx] = {
        ...next[idx],
        count,
        reacted_by_me: mine ? false : next[idx].reacted_by_me,
        reactor_names: next[idx].reactor_names.filter((n) => n !== e.owner_name),
      };
  }
  return next;
}

export function markConversationRead(conversationId: number) {
  queryClient.setQueryData<ChatConversation[]>(['chat-conversations'], (prev) =>
    prev?.map((c) => (c.id === conversationId ? { ...c, unread_count: 0 } : c)),
  );
  api.markChatRead(conversationId).catch(() => {});
}

export function ChatSocketProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const socketRef = useRef<WebSocket | null>(null);
  const openConversationRef = useRef<number | null>(null);
  const typingTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [connected, setConnected] = useState(false);
  const [typingByConversation, setTypingByConversation] = useState<Record<number, Typist[]>>({});
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => sub.remove();
  }, []);

  const handleEvent = useCallback((event: SocketEvent) => {
    const myOwnerId = queryClient.getQueryData<{ owner_id: number | null }>(['me'])?.owner_id ?? null;

    if (event.type === 'message') {
      const message = event.message;
      queryClient.setQueryData<ChatMessage[]>(['chat-messages', message.conversation_id], (prev) =>
        prev && !prev.some((m) => m.id === message.id) ? [...prev, message] : prev,
      );
      const isOpen = message.conversation_id === openConversationRef.current;
      queryClient.setQueryData<ChatConversation[]>(['chat-conversations'], (prev) =>
        prev?.map((c) =>
          c.id === message.conversation_id
            ? {
                ...c,
                last_message: {
                  id: message.id,
                  owner_name: message.owner_name,
                  body: message.body,
                  created_at: message.created_at,
                },
                unread_count: isOpen || message.owner_id === myOwnerId ? c.unread_count : c.unread_count + 1,
              }
            : c,
        ),
      );
      if (isOpen && message.owner_id !== myOwnerId) markConversationRead(message.conversation_id);
    } else if (event.type === 'typing') {
      const key = `${event.conversation_id}:${event.owner_id}`;
      setTypingByConversation((prev) => {
        const existing = prev[event.conversation_id] ?? [];
        if (existing.some((t) => t.owner_id === event.owner_id)) return prev;
        return {
          ...prev,
          [event.conversation_id]: [...existing, { owner_id: event.owner_id, owner_name: event.owner_name }],
        };
      });
      clearTimeout(typingTimeouts.current[key]);
      typingTimeouts.current[key] = setTimeout(() => {
        setTypingByConversation((prev) => ({
          ...prev,
          [event.conversation_id]: (prev[event.conversation_id] ?? []).filter((t) => t.owner_id !== event.owner_id),
        }));
      }, TYPING_CLEAR_MS);
    } else if (event.type === 'reaction') {
      queryClient.setQueryData<ChatMessage[]>(['chat-messages', event.conversation_id], (prev) =>
        prev?.map((m) => (m.id === event.message_id ? { ...m, reactions: applyReaction(m.reactions, event, myOwnerId) } : m)),
      );
    } else if (event.type === 'deleted') {
      queryClient.setQueryData<ChatMessage[]>(['chat-messages', event.conversation_id], (prev) =>
        prev?.filter((m) => m.id !== event.message_id),
      );
    } else if (event.type === 'wheel_spin') {
      void queryClient.invalidateQueries({ queryKey: ['punishment-wheel'] });
    }
  }, []);

  // Connected only while signed in and on screen: iOS suspends a
  // backgrounded app's sockets anyway, and the push notifications cover
  // that time. Coming back refetches, so nothing sent meanwhile is missed.
  useEffect(() => {
    if (!token || !appActive) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    async function connect() {
      let ticket: string;
      try {
        ({ ticket } = await api.chatSocketTicket());
      } catch {
        if (!cancelled) retry = setTimeout(connect, RECONNECT_DELAY_MS);
        return;
      }
      if (cancelled) return;

      const socket = new WebSocket(chatSocketUrl(ticket));
      socketRef.current = socket;
      socket.onopen = () => {
        setConnected(true);
        socket.send(JSON.stringify({ type: 'visibility', visible: true }));
      };
      socket.onmessage = (e) => {
        try {
          handleEvent(JSON.parse(e.data));
        } catch {
          // Ignore anything that isn't JSON.
        }
      };
      socket.onclose = (e) => {
        if (socketRef.current === socket) socketRef.current = null;
        setConnected(false);
        // 4401: not signed in / no owner. Retrying can't fix that.
        if (!cancelled && e.code !== 4401) retry = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    }

    void queryClient.invalidateQueries({ queryKey: ['chat-conversations'] });
    void queryClient.invalidateQueries({ queryKey: ['chat-messages'] });
    void connect();

    return () => {
      cancelled = true;
      clearTimeout(retry);
      socketRef.current?.close();
      socketRef.current = null;
      setConnected(false);
    };
  }, [token, appActive, handleEvent]);

  const send = useCallback((event: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(event));
    return true;
  }, []);

  const setOpenConversation = useCallback((conversationId: number | null) => {
    openConversationRef.current = conversationId;
  }, []);

  const value = useMemo(
    () => ({ connected, typingByConversation, send, setOpenConversation }),
    [connected, typingByConversation, send, setOpenConversation],
  );
  return <ChatSocketContext.Provider value={value}>{children}</ChatSocketContext.Provider>;
}

export function useChatSocket(): ChatSocketState {
  const ctx = useContext(ChatSocketContext);
  if (!ctx) throw new Error('useChatSocket must be used inside ChatSocketProvider');
  return ctx;
}
