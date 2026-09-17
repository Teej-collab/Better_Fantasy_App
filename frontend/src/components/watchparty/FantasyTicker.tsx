"use client";

import { useEffect, useRef, useState } from "react";
import { getWatchPartyWebSocketUrl, getWatchPartyWsTicket, type FantasyDigest } from "@/lib/api";

const RECONNECT_DELAY_MS = 3000;

// Live "fantasy digest" overlay for a Watch Party room — the league's
// currently close/live matchups, pushed by the backend's own poll job
// (app/scheduler.py's _run_watch_party_poll_job) over a receive-only
// WebSocket. Same ticket-mint-then-connect shape as Gamecast's own
// socket (frontend/src/lib/gamecastApi.ts), just for a different route.
export function FantasyTicker({ roomId }: { roomId: number }) {
  const [digest, setDigest] = useState<FantasyDigest | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      const ticket = await getWatchPartyWsTicket();
      if (cancelled || !ticket) return;
      const socket = new WebSocket(getWatchPartyWebSocketUrl(ticket, roomId));
      socketRef.current = socket;

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "fantasy_digest") setDigest(data);
        } catch {
          // ignore malformed frames
        }
      };
      socket.onclose = () => {
        if (!cancelled) reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    }

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current?.close();
    };
  }, [roomId]);

  if (!digest || digest.matchups.length === 0) return null;

  return (
    <div className="pointer-events-none absolute top-16 left-1/2 z-10 w-full max-w-sm -translate-x-1/2 px-3">
      <div className="pointer-events-auto flex flex-col gap-1.5 rounded-2xl bg-black/70 p-2.5 backdrop-blur-md">
        <span className="px-1 text-[10px] font-semibold tracking-wide text-white/50 uppercase">
          Sweating it out — Week {digest.week}
        </span>
        {digest.matchups.slice(0, 3).map((m) => (
          <div key={m.matchup_id} className="flex items-center gap-2 rounded-xl bg-white/5 px-2.5 py-1.5">
            <div className="flex min-w-0 flex-1 flex-col text-xs text-white">
              <span className="truncate">
                {m.home.owner_name} {m.home.score?.toFixed(1) ?? "—"} · {m.away.owner_name} {m.away.score?.toFixed(1) ?? "—"}
              </span>
              {m.sweat.label && <span className="truncate text-[11px] font-semibold text-red-400">{m.sweat.label}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
