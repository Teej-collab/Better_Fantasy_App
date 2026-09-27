"use client";

import { useSyncExternalStore } from "react";
import { formatGameTime } from "@/lib/gameTime";

const noSubscription = () => () => {};

/**
 * Kickoff in the viewer's own timezone ("Sun 1:00 PM"). The server
 * renders ESPN's own status string instead, since the server's clock
 * (UTC on Railway/Vercel) would otherwise print the wrong local time
 * and mismatch the client on hydration.
 */
export function KickoffTime({ iso, fallback }: { iso: string | null; fallback: string }) {
  const onClient = useSyncExternalStore(noSubscription, () => true, () => false);
  return <>{onClient && iso ? formatGameTime(iso) : fallback}</>;
}
