"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BetCard } from "@/components/bets/BetCard";
import { betsInGame, type Bet } from "@/lib/betsApi";

// The Gamecast's Your Bets panel: every bet of yours with a leg in this
// game, graded live from the box score. Renders nothing when bet tracking
// is off or you have no bets on the game. A leg cashing mid-game gets a
// brief highlight.
const LIVE_REFRESH_MS = 15_000;

export function GamecastBets({ gameId, live }: { gameId: string; live: boolean }) {
  const [bets, setBets] = useState<Bet[]>([]);
  const [justHit, setJustHit] = useState<string | null>(null);
  const won = useRef<Set<number> | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await betsInGame(gameId);
        if (cancelled) return;
        const legs = data.bets.flatMap((b) => b.legs.filter((l) => l.espn_event_id === gameId));
        const nowWon = new Set(legs.filter((l) => l.status === "won").map((l) => l.id));
        if (won.current) {
          const fresh = legs.find((l) => nowWon.has(l.id) && !won.current!.has(l.id));
          if (fresh) setJustHit(`${fresh.player_name ?? fresh.description} cashed ✅`);
        }
        won.current = nowWon;
        setBets(data.enabled ? data.bets : []);
      } catch {
        // Signed out or offline — the panel just doesn't show.
      }
    }
    const first = setTimeout(load, 0);
    const id = live ? setInterval(load, LIVE_REFRESH_MS) : undefined;
    return () => {
      cancelled = true;
      clearTimeout(first);
      if (id) clearInterval(id);
    };
  }, [gameId, live]);

  useEffect(() => {
    if (!justHit) return;
    const id = setTimeout(() => setJustHit(null), 6000);
    return () => clearTimeout(id);
  }, [justHit]);

  if (bets.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Your bets</h2>
        <Link href="/bets" className="text-xs text-[var(--wl-accent-dim)] hover:underline">
          My Bets →
        </Link>
      </div>
      {justHit && (
        <p role="status" className="rounded-lg bg-emerald-500/15 px-3 py-2 text-sm font-semibold text-emerald-500">
          {justHit}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {bets.map((bet) => (
          <BetCard key={bet.id} bet={bet} onlyEventId={gameId} />
        ))}
      </div>
    </section>
  );
}
