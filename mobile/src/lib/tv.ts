import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import type { TvCommand } from '@/lib/types';

// Phone to TV (2026-11-14, The Weekend TV). Whether you have a TV is asked
// once per app run: "Watch on TV" buttons only show up if you do.

let hasTvCache: boolean | null = null;

export function useHasTv(): boolean {
  const [has, setHas] = useState(hasTvCache ?? false);
  useEffect(() => {
    if (hasTvCache !== null) return;
    api
      .listTvs()
      .then((tvs) => {
        hasTvCache = tvs.length > 0;
        setHas(hasTvCache);
      })
      .catch(() => {});
  }, []);
  return has;
}

/** Pairing a TV (connect-tv) changes the answer. */
export function resetHasTv(): void {
  hasTvCache = null;
}

/** Sends one command; resolves to a message when no TV took it, else null. */
export async function sendToTv(cmd: TvCommand): Promise<string | null> {
  try {
    const { delivered } = await api.sendToTv(cmd);
    if (delivered === 0) {
      haptics.warning();
      return 'Your TV isn’t listening. Turn it on and open The Weekend.';
    }
    return null;
  } catch (e) {
    haptics.error();
    return e instanceof Error ? e.message : 'Couldn’t reach your TV.';
  }
}
