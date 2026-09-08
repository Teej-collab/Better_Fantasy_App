"use client";

import { useEffect, useState } from "react";
import { cancelWaiverClaim, listMyWaiverClaims, type WaiverClaim } from "@/lib/api";

const STATUS_STYLE: Record<WaiverClaim["status"], string> = {
  pending: "bg-black/10 text-black/60 dark:bg-white/10 dark:text-white/60",
  successful: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  failed: "bg-red-500/15 text-red-600 dark:text-red-400",
  cancelled: "bg-black/5 text-black/40 dark:bg-white/5 dark:text-white/40",
};

/**
 * This team's own waiver claims, most recent first — self-fetching
 * client widget so FreeAgentsList's own optimistic claim-submit flow
 * doesn't have to thread state all the way up to the server-rendered
 * page just to keep this list in sync. Refetches after a successful
 * cancel; not live-updated when the scheduler resolves a claim in the
 * background (a manual page refresh picks that up) — the same
 * "no in-app notification center" gap the competitive audit already
 * names, not something this widget alone should try to solve.
 */
export function MyWaiverClaims() {
  const [claims, setClaims] = useState<WaiverClaim[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  useEffect(() => {
    listMyWaiverClaims()
      .then(setClaims)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load your waiver claims"));
  }, []);

  async function cancel(claimId: number) {
    setCancellingId(claimId);
    try {
      await cancelWaiverClaim(claimId);
      setClaims(await listMyWaiverClaims());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setCancellingId(null);
    }
  }

  if (error) return <p className="text-xs text-red-500">{error}</p>;
  if (claims === null) return <p className="text-xs text-black/50 dark:text-white/50">Loading your claims…</p>;
  if (claims.length === 0) return null;

  return (
    <div className="neon-panel flex flex-col rounded-lg bg-black/[0.015] dark:bg-white/[0.03]">
      <div className="border-b border-black/5 px-4 py-2 text-[11px] font-semibold tracking-wide text-black/40 uppercase dark:border-white/5 dark:text-white/40">
        Your Waiver Claims
      </div>
      <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
        {claims.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <span className="flex min-w-0 flex-col">
              <span className="truncate">
                {c.add_player_name}
                {c.drop_player_name && (
                  <span className="text-black/50 dark:text-white/50"> (drop {c.drop_player_name})</span>
                )}
              </span>
              {c.failure_reason && (
                <span className="text-xs text-black/50 dark:text-white/50">{c.failure_reason}</span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLE[c.status]}`}>
                {c.status}
              </span>
              {c.status === "pending" && (
                <button
                  onClick={() => cancel(c.id)}
                  disabled={cancellingId === c.id}
                  className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium text-black/60 hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10"
                >
                  {cancellingId === c.id ? "Cancelling…" : "Cancel"}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
