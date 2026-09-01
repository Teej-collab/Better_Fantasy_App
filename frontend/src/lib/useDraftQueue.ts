"use client";

import { useCallback, useEffect, useState } from "react";

// A personal, on-this-device draft queue/watchlist — click-to-queue was
// the single most-named gap in the 2026-08-31 competitive UX audit's
// Draft review (Sleeper's own queue is one of its most-loved
// features). Deliberately client-only/localStorage-backed rather than
// a new backend table: this is a personal "who am I eyeing" scratchpad
// for one draft night, not shared state another owner or device needs
// to see — same precedent as wl_intro_seen (lib/useWeekendIntro.ts),
// the one other place this app already reaches for localStorage over a
// real backend write. Scoped per season so an old queue from a
// previous draft never bleeds into a new one.
function storageKey(season: number): string {
  return `wl_draft_queue_${season}`;
}

function readQueue(season: number): string[] {
  try {
    const raw = localStorage.getItem(storageKey(season));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeQueue(season: number, queue: string[]) {
  try {
    localStorage.setItem(storageKey(season), JSON.stringify(queue));
  } catch {
    // Private-browsing/storage-restricted contexts — queueing just
    // won't persist across a reload this time, same tradeoff
    // useWeekendIntro's skip() already accepts.
  }
}

export function useDraftQueue(season: number | undefined) {
  const [queue, setQueue] = useState<string[]>([]);

  useEffect(() => {
    if (!season) return;
    // setTimeout(0) rather than calling setQueue directly — still
    // counts as a callback to the lint rule below (unlike a synchronous
    // setState call in the effect body), while running effectively
    // immediately (same pattern as app/(app)/leagues/page.tsx's refresh
    // effect).
    const id = setTimeout(() => setQueue(readQueue(season)), 0);
    return () => clearTimeout(id);
  }, [season]);

  const persist = useCallback(
    (next: string[]) => {
      setQueue(next);
      if (season) writeQueue(season, next);
    },
    [season]
  );

  const toggle = useCallback(
    (sleeperPlayerId: string) => {
      persist(
        queue.includes(sleeperPlayerId)
          ? queue.filter((id) => id !== sleeperPlayerId)
          : [...queue, sleeperPlayerId]
      );
    },
    [queue, persist]
  );

  const remove = useCallback((sleeperPlayerId: string) => persist(queue.filter((id) => id !== sleeperPlayerId)), [
    queue,
    persist,
  ]);

  const move = useCallback(
    (sleeperPlayerId: string, direction: -1 | 1) => {
      const i = queue.indexOf(sleeperPlayerId);
      const j = i + direction;
      if (i === -1 || j < 0 || j >= queue.length) return;
      const next = [...queue];
      [next[i], next[j]] = [next[j], next[i]];
      persist(next);
    },
    [queue, persist]
  );

  return { queue, toggle, remove, move, isQueued: (id: string) => queue.includes(id) };
}
