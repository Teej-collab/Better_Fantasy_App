"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getChatWebSocketUrl, getChatWsTicket } from "@/lib/api";

const RECONNECT_DELAY_MS = 2000;

// Live overrides only — NOT the full "who's online" list. Every
// consumer (NewMessageModal, the chat header, ...) already fetches its
// own member list with an `online` snapshot included (GET /chat/members,
// computed server-side from the same connection registry this socket
// updates) — this context just relays presence changes that happen
// AFTER that snapshot was taken, while the app stays open. Keeping the
// provider this dumb means it never needs to know who the league's
// members even are.
const PresenceContext = createContext<Map<number, boolean>>(new Map());

// `fallback` is the snapshot value from wherever the caller already
// fetched it (e.g. ChatMember.online) — this only overrides it once a
// live event for that owner has actually arrived.
export function usePresence(ownerId: number, fallback: boolean): boolean {
  const overrides = useContext(PresenceContext);
  return overrides.has(ownerId) ? (overrides.get(ownerId) as boolean) : fallback;
}

// Mounted once, app-wide (app/layout.tsx) — deliberately reuses the
// exact same WebSocket endpoint/ticket flow ChatApp.tsx's own
// connection does (see that component for the fuller reconnect-lifecycle
// reasoning this mirrors), just kept open regardless of which page is
// open rather than only while /chat is mounted. That's the one real
// difference from before this existed: "online" used to only ever mean
// "has the Chat tab open right now" (backend/app/chat/manager.py's own
// registry, keyed off whichever socket happens to be connected) — this
// makes it mean "has the app open at all," matching what a presence dot
// should actually represent. Every incoming frame that isn't a
// `presence` event is ignored here on purpose — ChatApp.tsx's own,
// separate socket (only open while /chat is mounted) still owns real
// message/typing handling; this connection exists for presence only.
export function PresenceProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<Map<number, boolean>>(new Map());
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    async function connect() {
      if (cancelled) return;
      const ticket = await getChatWsTicket();
      if (cancelled || !ticket) return; // not signed in — nothing to track

      const socket = new WebSocket(getChatWebSocketUrl(ticket));
      socketRef.current = socket;

      socket.onmessage = (event) => {
        let data: { type?: string; owner_id?: number; online?: boolean };
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        if (data.type === "presence" && typeof data.owner_id === "number" && typeof data.online === "boolean") {
          setOverrides((prev) => new Map(prev).set(data.owner_id as number, data.online as boolean));
        }
      };
      socket.onclose = (event) => {
        if (!cancelled && event.code !== 4401) {
          timeouts.push(setTimeout(connect, RECONNECT_DELAY_MS));
        }
      };
    }

    connect();
    return () => {
      cancelled = true;
      socketRef.current?.close();
      timeouts.forEach(clearTimeout);
    };
  }, []);

  return <PresenceContext.Provider value={overrides}>{children}</PresenceContext.Provider>;
}
