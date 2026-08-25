"use client";

import { useEffect, useRef, useState } from "react";
import {
  getGamecastWebSocketUrl,
  getGamecastWsTicket,
  type LiveGame,
} from "@/lib/gamecastApi";
import { GameHeader } from "@/components/gamecast/GameHeader";
import { FieldVisualization } from "@/components/gamecast/FieldVisualization";
import { CurrentDrive } from "@/components/gamecast/CurrentDrive";
import { PlayByPlay } from "@/components/gamecast/PlayByPlay";
import { ScoringSummary } from "@/components/gamecast/ScoringSummary";
import { FantasyImpact } from "@/components/gamecast/FantasyImpact";

const RECONNECT_DELAY_MS = 2000;
const CLOCK_TICK_MS = 1000;

/**
 * Owns the Gamecast WebSocket connection — same connect/reconnect
 * shape as ChatApp.tsx's WS lifecycle (ticket mint → WS open → onclose
 * schedules a retry unless this unmounted or the server closed with an
 * auth-failure code). SSR hands this an initial snapshot (`initialGame`)
 * so the page has real content on first paint; the socket takes over
 * from there. A finished game (status "final"/"postponed"/"canceled")
 * never opens a socket at all — nothing left to stream.
 */
export function GamecastShell({
  gameId,
  initialGame,
  isSignedIn,
}: {
  gameId: string;
  initialGame: LiveGame;
  isSignedIn: boolean;
}) {
  const [game, setGame] = useState(initialGame);
  const [connected, setConnected] = useState(false);
  const [updatedSecondsAgo, setUpdatedSecondsAgo] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);

  const isLiveStatus = game.status === "in_progress" || game.status === "halftime" || game.status === "scheduled";

  useEffect(() => {
    if (!isLiveStatus) return;
    let cancelled = false;
    let socket: WebSocket;

    async function connect() {
      if (cancelled) return;
      const ticket = await getGamecastWsTicket();
      if (cancelled) return;
      if (!ticket) {
        // Not signed in (or the mint failed) — Gamecast is read-only
        // and doesn't strictly require auth server-side, but the WS
        // ticket path does today for consistency with chat's. Fall
        // back to periodic REST polling instead of giving up entirely.
        return;
      }
      socket = new WebSocket(getGamecastWebSocketUrl(ticket, gameId));
      socketRef.current = socket;

      socket.onopen = () => setConnected(true);
      socket.onclose = (event) => {
        setConnected(false);
        if (!cancelled && event.code !== 4401) {
          setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "game_state" && data.game) {
            setGame(data.game as LiveGame);
          }
        } catch {
          // Malformed frame — ignore rather than crash the connection.
        }
      };
    }

    connect();
    return () => {
      cancelled = true;
      socketRef.current?.close();
    };
  }, [gameId, isLiveStatus]);

  // Honest staleness clock — recomputed every second from last_updated,
  // never just left frozen at whatever it said when a message arrived.
  useEffect(() => {
    const tick = () => {
      const seconds = Math.max(0, Math.round((Date.now() - new Date(game.last_updated).getTime()) / 1000));
      setUpdatedSecondsAgo(seconds);
    };
    tick();
    const id = setInterval(tick, CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, [game.last_updated]);

  return (
    <div className="flex flex-col gap-4">
      <GameHeader game={game} connected={connected || !isLiveStatus} updatedSecondsAgo={updatedSecondsAgo} />

      <div className="flex flex-col gap-4 sm:grid sm:grid-cols-2">
        <FieldVisualization game={game} />
        <CurrentDrive game={game} />
      </div>

      <div className="flex flex-col gap-4 sm:grid sm:grid-cols-2">
        <ScoringSummary game={game} />
        <FantasyImpact game={game} isSignedIn={isSignedIn} />
      </div>

      <PlayByPlay game={game} />
    </div>
  );
}
