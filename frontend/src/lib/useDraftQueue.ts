"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { addToDraftQueue, getDraftQueue, removeFromDraftQueue, reorderDraftQueue } from "@/lib/draftApi";

// A team's personal ranked draft queue (2026-09) — server-authoritative
// (backend/app/queries/draft_queue.py), replacing the old localStorage-
// only version this hook used to be (see git history: click-to-queue
// landed 2026-08-31 as a client-only scratchpad, on the explicit
// reasoning that it was "a personal 'who am I eyeing' scratchpad ... not
// shared state another owner or device needs to see"). That reasoning
// held right up until autodraft needed to read it (2026-09's queue-
// priority feature) and until "survives a refresh/new device" turned
// out to matter after all — a real backend table is required either
// way now, not just nice-to-have.
//
// Optimistic-update shape: every mutation updates local state
// immediately (so the UI feels instant — dragging/reordering can't wait
// on a round trip) and fires the real request in the background;
// refresh() re-syncs from the server and is what DraftRoom.tsx calls
// alongside its own refreshState()/refreshPool() on every WS event, so
// a player someone else just drafted (and the server already removed
// from every queue — see draft_engine.py's make_pick) disappears here
// too without this hook needing its own WebSocket listener.
export function useDraftQueue(season: number | undefined) {
  const [queue, setQueue] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Avoids a refresh() that's still in flight from clobbering a newer
  // optimistic update with stale server data (e.g. a slow GET landing
  // after the user already reordered twice) — only the LATEST refresh
  // call's result is ever applied.
  const refreshSeq = useRef(0);

  const refresh = useCallback(async () => {
    if (!season) return;
    const seq = ++refreshSeq.current;
    try {
      const { queue: serverQueue } = await getDraftQueue();
      if (seq === refreshSeq.current) {
        setQueue(serverQueue);
        setLoaded(true);
      }
    } catch {
      // Non-fatal — the queue is a convenience layer; a failed refresh
      // just means the next successful one (or WS-triggered refresh)
      // catches up. Local state stays whatever it was.
    }
  }, [season]);

  useEffect(() => {
    // setTimeout(0), not a direct setState call in the effect body —
    // same lint-satisfying pattern this hook's own load effect always
    // used (see git history).
    const id = setTimeout(() => {
      refresh();
    }, 0);
    return () => clearTimeout(id);
  }, [refresh]);

  const toggle = useCallback(
    (sleeperPlayerId: string) => {
      const wasQueued = queue.includes(sleeperPlayerId);
      setQueue(wasQueued ? queue.filter((id) => id !== sleeperPlayerId) : [...queue, sleeperPlayerId]);
      const request = wasQueued ? removeFromDraftQueue(sleeperPlayerId) : addToDraftQueue(sleeperPlayerId);
      request.then(({ queue: serverQueue }) => setQueue(serverQueue)).catch(() => refresh());
    },
    [queue, refresh]
  );

  const remove = useCallback(
    (sleeperPlayerId: string) => {
      setQueue(queue.filter((id) => id !== sleeperPlayerId));
      removeFromDraftQueue(sleeperPlayerId)
        .then(({ queue: serverQueue }) => setQueue(serverQueue))
        .catch(() => refresh());
    },
    [queue, refresh]
  );

  const reorder = useCallback(
    (next: string[]) => {
      setQueue(next);
      reorderDraftQueue(next)
        .then(({ queue: serverQueue }) => setQueue(serverQueue))
        .catch(() => refresh());
    },
    [refresh]
  );

  const move = useCallback(
    (sleeperPlayerId: string, direction: -1 | 1) => {
      const i = queue.indexOf(sleeperPlayerId);
      const j = i + direction;
      if (i === -1 || j < 0 || j >= queue.length) return;
      const next = [...queue];
      [next[i], next[j]] = [next[j], next[i]];
      reorder(next);
    },
    [queue, reorder]
  );

  const moveToTop = useCallback(
    (sleeperPlayerId: string) => {
      if (!queue.includes(sleeperPlayerId)) return;
      reorder([sleeperPlayerId, ...queue.filter((id) => id !== sleeperPlayerId)]);
    },
    [queue, reorder]
  );

  const moveToBottom = useCallback(
    (sleeperPlayerId: string) => {
      if (!queue.includes(sleeperPlayerId)) return;
      reorder([...queue.filter((id) => id !== sleeperPlayerId), sleeperPlayerId]);
    },
    [queue, reorder]
  );

  return {
    queue,
    loaded,
    toggle,
    remove,
    move,
    moveToTop,
    moveToBottom,
    reorder,
    refresh,
    isQueued: (id: string) => queue.includes(id),
  };
}
