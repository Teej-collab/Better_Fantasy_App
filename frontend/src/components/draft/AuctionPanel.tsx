"use client";

import { useEffect, useState } from "react";
import { placeBid, type AuctionState } from "@/lib/draftApi";
import { PositionBadge } from "@/components/draft/PositionBadge";

// The live auction (auction drafts, 2026-10): the player up for bid,
// the high bid and a countdown, quick-bid buttons, and every team's
// money. Nominating happens from the player pool (its Draft buttons
// become Nominate in an auction — see DraftRoom.tsx).
export function AuctionPanel({
  auction,
  myOwnerId,
  teamName,
  onError,
}: {
  auction: AuctionState;
  myOwnerId: number | null;
  teamName: (ownerId: number) => string;
  onError: (message: string | null) => void;
}) {
  const [seconds, setSeconds] = useState(0);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const tick = () =>
      setSeconds(auction.deadline ? Math.max(0, Math.round((new Date(auction.deadline).getTime() - Date.now()) / 1000)) : 0);
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [auction.deadline]);

  const me = auction.teams.find((t) => t.owner_id === myOwnerId) ?? null;
  const high = auction.high_bid ?? 0;
  const iLead = auction.high_bidder_owner_id === myOwnerId;
  const canBid = !!auction.nominee && !!me && me.open_spots > 0 && !iLead;

  async function bid(amount: number) {
    setBusy(true);
    onError(null);
    try {
      await placeBid(amount);
      setCustom("");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Bid failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="neon-panel flex flex-col gap-3 rounded-xl p-4">
      {auction.nominee ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <span className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Up for bid</span>
            <span className="flex items-center gap-2 text-xl font-bold">
              {auction.nominee.full_name ?? auction.nominee.sleeper_player_id}
              {auction.nominee.position && <PositionBadge position={auction.nominee.position} />}
            </span>
            <span className="text-sm text-black/60 dark:text-white/60">
              High bid <b className="font-mono text-base">${high}</b>
              {auction.high_bidder_owner_id !== null && ` · ${iLead ? "you" : teamName(auction.high_bidder_owner_id)}`}
            </span>
          </div>
          <div className={`font-mono text-4xl font-bold tabular-nums ${seconds <= 5 ? "text-red-500" : ""}`}>{seconds}s</div>
        </div>
      ) : (
        <p className="text-sm">
          {auction.nominator_owner_id === myOwnerId ? (
            <b>Your turn to nominate — pick a player below.</b>
          ) : auction.nominator_owner_id !== null ? (
            <>
              <b>{teamName(auction.nominator_owner_id)}</b> is nominating ({seconds}s).
            </>
          ) : (
            "Waiting for the auction."
          )}
        </p>
      )}

      {canBid && (
        <div className="flex flex-wrap items-center gap-2">
          {[1, 5].map((step) =>
            high + step <= me!.max_bid ? (
              <button
                key={step}
                disabled={busy}
                onClick={() => bid(high + step)}
                className="rounded-full bg-[var(--wl-accent)] px-4 py-2 text-sm font-bold text-black disabled:opacity-40"
              >
                ${high + step}
              </button>
            ) : null,
          )}
          <input
            type="number"
            min={high + 1}
            max={me!.max_bid}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={`$${high + 1}–${me!.max_bid}`}
            className="w-28 rounded-full border border-black/10 bg-transparent px-3 py-2 text-sm tabular-nums dark:border-white/10"
          />
          <button
            disabled={busy || !custom || Number(custom) <= high}
            onClick={() => bid(Math.floor(Number(custom)))}
            className="rounded-full border border-[var(--wl-accent)] px-4 py-2 text-sm font-bold text-[color:var(--wl-accent)] disabled:opacity-40"
          >
            Bid
          </button>
        </div>
      )}
      {iLead && <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">You have the high bid.</p>}

      {me && (
        <p className="text-xs text-black/60 dark:text-white/60">
          You: ${me.remaining} left · {me.open_spots} spots open · max bid ${me.max_bid}
        </p>
      )}

      <details>
        <summary className="cursor-pointer text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
          Every team&apos;s budget
        </summary>
        <ul className="mt-2 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
          {auction.teams.map((t) => (
            <li key={t.owner_id} className="flex justify-between gap-2">
              <span className="truncate">{teamName(t.owner_id)}</span>
              <span className="font-mono tabular-nums text-black/60 dark:text-white/60">
                ${t.remaining} · {t.open_spots} open
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
