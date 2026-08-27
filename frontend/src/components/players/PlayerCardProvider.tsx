"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { PlayerCardModal } from "@/components/players/PlayerCardModal";

type PlayerCardContextValue = {
  openPlayerCard: (sleeperPlayerId: string) => void;
};

const PlayerCardContext = createContext<PlayerCardContextValue | null>(null);

// Mounted once at the app root (app/layout.tsx) so a player's card
// looks and behaves identically no matter which page opened it —
// draft pool, roster, free agents, wherever a name shows up next —
// instead of every page owning its own local modal state and its own
// <PlayerCardModal> instance (the pattern this replaces in DraftRoom.tsx
// and MyTeamApp.tsx).
export function PlayerCardProvider({ children }: { children: React.ReactNode }) {
  const [sleeperPlayerId, setSleeperPlayerId] = useState<string | null>(null);

  const value = useMemo(() => ({ openPlayerCard: setSleeperPlayerId }), []);

  return (
    <PlayerCardContext.Provider value={value}>
      {children}
      {sleeperPlayerId && (
        <PlayerCardModal sleeperPlayerId={sleeperPlayerId} onClose={() => setSleeperPlayerId(null)} />
      )}
    </PlayerCardContext.Provider>
  );
}

export function usePlayerCard(): PlayerCardContextValue {
  const ctx = useContext(PlayerCardContext);
  if (!ctx) {
    throw new Error("usePlayerCard must be used within a PlayerCardProvider");
  }
  return ctx;
}
