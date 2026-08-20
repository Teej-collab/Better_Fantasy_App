"use client";

import { useEffect, useRef, useState } from "react";
import { getChatWebSocketUrl, type ChatMessage } from "@/lib/api";

const RECONNECT_DELAY_MS = 2000;

export function ChatRoom({ initialMessages, myOwnerId }: { initialMessages: ChatMessage[]; myOwnerId: number }) {
  const [messages, setMessages] = useState(initialMessages);
  const [connected, setConnected] = useState(false);
  const [draft, setDraft] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seenIds = useRef(new Set(initialMessages.map((m) => m.id)));

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket;

    function connect() {
      if (cancelled) return;
      socket = new WebSocket(getChatWebSocketUrl());
      socketRef.current = socket;

      socket.onopen = () => setConnected(true);
      socket.onclose = (event) => {
        setConnected(false);
        // The backend closes with 4401 if the session cookie was missing/
        // expired — retrying that forever would just spin, so don't.
        if (!cancelled && event.code !== 4401) {
          setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };
      socket.onmessage = (event) => {
        const msg: ChatMessage = JSON.parse(event.data);
        if (seenIds.current.has(msg.id)) return; // e.g. our own message echoed back
        seenIds.current.add(msg.id);
        setMessages((prev) => [...prev, msg]);
      };
    }

    connect();
    return () => {
      cancelled = true;
      socketRef.current?.close();
    };
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  function send() {
    const body = draft.trim();
    if (!body || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify({ body }));
    setDraft("");
  }

  return (
    <div className="flex h-[70vh] flex-col rounded-lg border border-black/10 bg-black/[0.015] shadow-sm dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none">
      <div className="flex items-center gap-2 border-b border-black/10 px-4 py-2 dark:border-white/10">
        <span className={connected ? "live-dot" : "live-dot live-dot--idle"} aria-hidden />
        <span className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
          {connected ? "Connected" : "Reconnecting…"}
        </span>
      </div>

      <div ref={listRef} className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <p className="m-auto text-sm text-black/50 dark:text-white/50">No messages yet — say something.</p>
        ) : (
          messages.map((m) => {
            const mine = m.owner_id === myOwnerId;
            return (
              <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                <span className="text-xs text-black/40 dark:text-white/40">
                  {mine ? "You" : m.owner_name} · {new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </span>
                <span
                  className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm break-words ${
                    mine
                      ? "bg-sky-500 text-white"
                      : "bg-black/5 text-black dark:bg-white/10 dark:text-white"
                  }`}
                >
                  {m.body}
                </span>
              </div>
            );
          })
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex gap-2 border-t border-black/10 p-3 dark:border-white/10"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the league…"
          maxLength={2000}
          className="min-w-0 flex-1 rounded-full border border-black/10 bg-transparent px-4 py-2 text-sm outline-none focus:border-black/30 dark:border-white/10 dark:focus:border-white/30"
        />
        <button
          type="submit"
          disabled={!draft.trim() || !connected}
          className="shrink-0 rounded-full bg-sky-500 px-4 py-2 text-sm font-medium text-white transition-transform active:scale-95 disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
