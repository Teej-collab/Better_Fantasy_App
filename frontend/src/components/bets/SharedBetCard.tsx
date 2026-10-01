"use client";

import { useEffect, useState } from "react";
import { BetCard } from "@/components/bets/BetCard";
import { sharedBet, type Bet } from "@/lib/betsApi";

// A bet shared to league chat (messages.bet_id), loaded live so its legs
// keep moving with the games. Once the bettor makes it private again —
// or deletes it — the card says so instead.
const LIVE_REFRESH_MS = 30_000;

export function SharedBetCard({ betId, mine }: { betId: number; mine: boolean }) {
  const [bet, setBet] = useState<Bet | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const b = await sharedBet(betId);
        if (!cancelled) {
          setBet(b);
          setGone(false);
        }
      } catch {
        if (!cancelled) setGone(true);
      }
    }
    const first = setTimeout(load, 0);
    const id = setInterval(load, LIVE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [betId]);

  if (gone) {
    return (
      <div className="rounded-xl border border-dashed border-black/15 px-3 py-2 text-xs text-black/50 dark:border-white/15 dark:text-white/50">
        🎟️ This bet isn&apos;t shared anymore.
      </div>
    );
  }
  if (!bet) {
    return <div className="h-24 w-72 animate-pulse rounded-xl bg-black/5 dark:bg-white/5" aria-label="Loading bet" />;
  }
  return (
    <div className="w-80 max-w-full">
      <BetCard bet={bet} shared={!mine} />
    </div>
  );
}
