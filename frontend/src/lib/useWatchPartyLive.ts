"use client";

import { useEffect, useState } from "react";
import { getWatchPartyRooms } from "@/lib/api";

// Same "fetch once on mount" shape as useUnreadChatCount.ts (this
// app's own precedent for a nav badge that's good-enough-fresh rather
// than truly live-updating) — Phase 4's "someone's in League Lounge"
// signal for the nav's Chat item. A signed-out visitor's fetch just
// 401s and this settles on false, same as that hook's own catch-all.
export function useWatchPartyLive(): boolean {
  const [live, setLive] = useState(false);

  useEffect(() => {
    getWatchPartyRooms()
      .then((rooms) => setLive(rooms.open_room.is_live))
      .catch(() => {});
  }, []);

  return live;
}
