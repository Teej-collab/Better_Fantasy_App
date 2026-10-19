"use client";

import { useEffect, useRef, useState } from "react";
import {
  getGamecastWebSocketUrl,
  getGamecastWsTicket,
  type LiveGame,
} from "@/lib/gamecastApi";
import { GameHeader } from "@/components/gamecast/GameHeader";
import { FieldVisualization } from "@/components/gamecast/FieldVisualization";
import { LastPlay } from "@/components/gamecast/LastPlay";
import { CurrentDrive } from "@/components/gamecast/CurrentDrive";
import { PlayByPlay } from "@/components/gamecast/PlayByPlay";
import { ScoringSummary } from "@/components/gamecast/ScoringSummary";
import { FantasyImpact } from "@/components/gamecast/FantasyImpact";
import { GamecastBets } from "@/components/bets/GamecastBets";
import { startVisibleInterval } from "@/lib/visibleInterval";

const RECONNECT_DELAY_MS = 2000;
const CLOCK_TICK_MS = 1000;
// Signed-out visitors (no WebSocket ticket) poll instead.
const POLL_FALLBACK_MS = 10_000;

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
  beta = false,
}: {
  gameId: string;
  initialGame: LiveGame;
  isSignedIn: boolean;
  // Settings > Labs > "Try the new look" — threaded into each child
  // instead of forking this component, since it owns the live
  // WebSocket connection/reconnect lifecycle (see this file's own
  // comment) and that logic must never have two copies to drift apart.
  // Only card treatment changes under this flag — Documentation/UX/
  // 00_UX_Audit.md's Gamecast finding was up to 5 independently-colored
  // glow rings on screen at once; FieldVisualization becomes the one
  // live-tier card, everything else goes flat.
  beta?: boolean;
}) {
  const [game, setGame] = useState(initialGame);
  const [connected, setConnected] = useState(false);
  const [updatedSecondsAgo, setUpdatedSecondsAgo] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);

  const isLiveStatus = game.status === "in_progress" || game.status === "halftime" || game.status === "scheduled";

  useEffect(() => {
    if (!isLiveStatus) return;
    let cancelled = false;
    // While the tab is hidden the socket stays open but only the newest
    // frame is kept, instead of re-rendering the whole Gamecast for every
    // play nobody's watching; it's shown the moment the tab is back.
    let pending: LiveGame | null = null;
    let stopPolling: (() => void) | null = null;
    function showPending() {
      if (document.visibilityState === "visible" && pending) {
        setGame(pending);
        pending = null;
      }
    }
    document.addEventListener("visibilitychange", showPending);
    let socket: WebSocket;

    async function connect() {
      if (cancelled) return;
      const ticket = await getGamecastWsTicket();
      if (cancelled) return;
      if (!ticket) {
        // Not signed in (or the mint failed) — Gamecast is read-only
        // and doesn't require auth server-side, but the WS ticket path
        // does today for consistency with chat's. Fall back to polling
        // the same game state over REST (through the same-origin
        // proxy) while the tab is visible, instead of freezing on
        // "Reconnecting…" as it used to.
        const poll = () => {
          fetch(`/api/backend/nfl/games/${encodeURIComponent(gameId)}`, { cache: "no-store" })
            .then((res) => (res.ok ? (res.json() as Promise<LiveGame>) : Promise.reject(new Error(String(res.status)))))
            .then((next) => {
              if (cancelled) return;
              setGame(next);
              setConnected(true);
            })
            .catch(() => {
              if (!cancelled) setConnected(false);
            });
        };
        if (stopPolling) return;
        poll();
        stopPolling = startVisibleInterval(poll, POLL_FALLBACK_MS);
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
            if (document.visibilityState === "visible") setGame(data.game as LiveGame);
            else pending = data.game as LiveGame;
          }
        } catch {
          // Malformed frame — ignore rather than crash the connection.
        }
      };
    }

    connect();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", showPending);
      stopPolling?.();
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
      <GameHeader game={game} connected={connected || !isLiveStatus} updatedSecondsAgo={updatedSecondsAgo} beta={beta} />

      <div className="flex flex-col gap-4 sm:grid sm:grid-cols-2 sm:items-start">
        {/* Last Play sits directly under the field graphic, in the same
            column on desktop too, so the two read as one unit. */}
        <div className="flex flex-col gap-4">
          <FieldVisualization game={game} beta={beta} />
          <LastPlay game={game} beta={beta} />
        </div>
        <CurrentDrive game={game} beta={beta} />
      </div>

      <div className="flex flex-col gap-4 sm:grid sm:grid-cols-2">
        <ScoringSummary game={game} beta={beta} />
        <FantasyImpact game={game} isSignedIn={isSignedIn} beta={beta} />
      </div>
      {isSignedIn && <GamecastBets gameId={gameId} live={game.status === "in_progress" || game.status === "halftime"} />}

      <PlayByPlay game={game} beta={beta} />
    </div>
  );
}
