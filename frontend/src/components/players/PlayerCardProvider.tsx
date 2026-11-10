"use client";

import { useSearchParams } from "next/navigation";
import { createContext, Suspense, useContext, useEffect, useMemo, useState } from "react";
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
      <Suspense fallback={null}>
        <CardFromUrl open={setSleeperPlayerId} />
      </Suspense>
      {sleeperPlayerId && (
        <PlayerCardModal sleeperPlayerId={sleeperPlayerId} onClose={() => setSleeperPlayerId(null)} />
      )}
    </PlayerCardContext.Provider>
  );
}

// ?card=<sleeper id> on any page opens that player's card over it — how
// an injury or news push opens the player (2026-11-10). The param comes
// off the address once it's open, so a refresh doesn't reopen it.
function CardFromUrl({ open }: { open: (sleeperPlayerId: string) => void }) {
  const card = useSearchParams().get("card");
  useEffect(() => {
    if (!card) return;
    open(card);
    const url = new URL(window.location.href);
    url.searchParams.delete("card");
    window.history.replaceState(window.history.state, "", url);
  }, [card, open]);
  return null;
}

export function usePlayerCard(): PlayerCardContextValue {
  const ctx = useContext(PlayerCardContext);
  if (!ctx) {
    throw new Error("usePlayerCard must be used within a PlayerCardProvider");
  }
  return ctx;
}
