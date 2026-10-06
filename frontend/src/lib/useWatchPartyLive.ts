"use client";

import { useEffect, useState } from "react";
import { getWatchPartyRooms } from "@/lib/api";

export type LoungeStatus = { live: boolean; watching: number; rooms: number };

/** Is anyone in the Lounge right now — the League Lounge or any open
 *  watch party — and how many are watching. Refreshed every minute so
 *  the nav's LIVE mark turns on without a reload. Signed out: the fetch
 *  401s and this stays at "nobody". */
export function useLoungeStatus(): LoungeStatus {
  const [status, setStatus] = useState<LoungeStatus>({ live: false, watching: 0, rooms: 0 });
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getWatchPartyRooms()
        .then((r) => {
          if (cancelled) return;
          const all = [r.open_room, ...(r.party_rooms ?? [])];
          const liveRooms = all.filter((x) => x.is_live);
          setStatus({
            live: liveRooms.length > 0,
            watching: liveRooms.reduce((n, x) => n + (x.watchers?.length ?? 0), 0),
            rooms: liveRooms.length,
          });
        })
        .catch(() => {});
    void load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  return status;
}

/** Kept for existing callers: just "is anyone in the Lounge". */
export function useWatchPartyLive(): boolean {
  return useLoungeStatus().live;
}
