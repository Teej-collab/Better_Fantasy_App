import { useEffect, useState } from 'react';

import { api, watchPartySocketUrl } from '@/lib/api';
import { queryClient } from '@/lib/queries';
import type { FantasyDigest } from '@/lib/types';

const RECONNECT_DELAY_MS = 3000;

export type RoomTv = { gameId: string | null; delaySeconds: number; setByOwnerId: number | null };

// A Watch Party room's socket — the same one as the web's FantasyTicker.
// It brings the league's close/live matchups (fantasy_digest) and the
// room's TV: which game is on and how far behind the live data it runs
// ("tv", sent on connect and whenever the sharer changes it). Being
// connected is also what shows you in the room for everyone else.
export function useWatchPartySocket(roomId: number, initialTv?: Partial<RoomTv>) {
  const [digest, setDigest] = useState<FantasyDigest | null>(null);
  const [connected, setConnected] = useState(false);
  const [tv, setTv] = useState<RoomTv>({
    gameId: initialTv?.gameId ?? null,
    delaySeconds: initialTv?.delaySeconds ?? 45,
    setByOwnerId: initialTv?.setByOwnerId ?? null,
  });

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

    async function connect() {
      let ticket: string;
      try {
        ({ ticket } = await api.watchPartySocketTicket());
      } catch {
        if (!cancelled) retry = setTimeout(connect, RECONNECT_DELAY_MS);
        return;
      }
      if (cancelled) return;
      socket = new WebSocket(watchPartySocketUrl(ticket, roomId));
      socket.onopen = () => {
        setConnected(true);
        void queryClient.invalidateQueries({ queryKey: ['watch-party-rooms'] });
      };
      socket.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'fantasy_digest') setDigest(data);
          if (data.type === 'tv') {
            setTv({ gameId: data.tv_game_id ?? null, delaySeconds: data.tv_delay_seconds ?? 45, setByOwnerId: data.set_by_owner_id ?? null });
          }
        } catch {
          // ignore malformed frames
        }
      };
      socket.onclose = (e) => {
        setConnected(false);
        // 4401: not signed in. 4404: no such room (or not invited). 4409: no league.
        if (!cancelled && ![4401, 4404, 4409].includes(e.code)) retry = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    }

    void connect();
    return () => {
      cancelled = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, [roomId]);

  return { digest, connected, tv, setTv };
}
