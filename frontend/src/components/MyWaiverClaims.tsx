"use client";

import { useEffect, useState } from "react";
import { cancelWaiverClaim, listMyWaiverClaims, reorderWaiverClaims, type WaiverClaim } from "@/lib/api";

const STATUS_STYLE: Record<WaiverClaim["status"], string> = {
  pending: "bg-black/10 text-black/60 dark:bg-white/10 dark:text-white/60",
  successful: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  failed: "bg-red-500/15 text-red-600 dark:text-red-400",
  cancelled: "bg-black/5 text-black/40 dark:bg-white/5 dark:text-white/40",
};

// "Processes Wed, Oct 14 at 3:00 AM", in the viewer's own time zone.
function processesAt(iso: string): string {
  const when = new Date(iso);
  const day = when.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `Processes ${day} at ${time}`;
}

/**
 * This team's own waiver claims — pending ones first, in the order the
 * team ranked them (the arrows, like ESPN's Waiver Claims > Edit), then
 * the rest most recent first — self-fetching
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
  // Collapsible (2026-10: some owners' lists got long) — starts closed
  // once there are more than a few claims; the header always shows the
  // count and how many are still pending.
  const [open, setOpen] = useState<boolean | null>(null);

  useEffect(() => {
    listMyWaiverClaims()
      .then(setClaims)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load your waiver claims"));
  }, []);

  async function move(claimId: number, by: -1 | 1) {
    if (!claims) return;
    const pendingIds = claims.filter((c) => c.status === "pending").map((c) => c.id);
    const from = pendingIds.indexOf(claimId);
    const to = from + by;
    if (from < 0 || to < 0 || to >= pendingIds.length) return;
    [pendingIds[from], pendingIds[to]] = [pendingIds[to], pendingIds[from]];
    const byId = new Map(claims.map((c) => [c.id, c]));
    const previous = claims;
    setClaims([...pendingIds.map((id) => byId.get(id)!), ...claims.filter((c) => c.status !== "pending")]);
    try {
      await reorderWaiverClaims(pendingIds);
    } catch (e) {
      setClaims(previous);
      setError(e instanceof Error ? e.message : "Couldn't save your claim order");
    }
  }

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

  const pendingIds = claims.filter((c) => c.status === "pending").map((c) => c.id);
  const pending = pendingIds.length;
  const isOpen = open ?? claims.length <= 3;
  return (
    <div className="neon-panel flex flex-col rounded-lg bg-black/[0.015] dark:bg-white/[0.03]">
      <button
        type="button"
        onClick={() => setOpen(!isOpen)}
        aria-expanded={isOpen}
        className={`flex min-h-11 items-center justify-between gap-3 px-4 py-2 text-left text-[11px] font-semibold tracking-wide text-black/50 uppercase dark:text-white/50 ${isOpen ? "border-b border-black/5 dark:border-white/5" : ""}`}
      >
        <span>
          Your Waiver Claims · {claims.length}
          {pending > 0 && <span className="ml-2 normal-case text-sky-600 dark:text-sky-400">{pending} pending</span>}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`transition-transform ${isOpen ? "rotate-180" : ""}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {isOpen && pending > 1 && (
        <p className="px-4 pt-2 text-xs text-black/50 dark:text-white/50">
          Use the arrows to rank your pending claims. When several clear at once, your top claim goes first on your turn.
        </p>
      )}
      {isOpen && (
      <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
        {claims.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            {c.status === "pending" && pending > 1 && (
              <span className="flex shrink-0 flex-col items-center">
                <button
                  type="button"
                  onClick={() => move(c.id, -1)}
                  disabled={pendingIds.indexOf(c.id) === 0}
                  aria-label={`Move ${c.add_player_name} up`}
                  className="flex h-6 w-8 items-center justify-center rounded text-black/60 hover:bg-black/5 disabled:opacity-25 dark:text-white/60 dark:hover:bg-white/10"
                >
                  ▲
                </button>
                <span className="text-[10px] font-semibold tabular-nums text-black/40 dark:text-white/40">
                  {pendingIds.indexOf(c.id) + 1}
                </span>
                <button
                  type="button"
                  onClick={() => move(c.id, 1)}
                  disabled={pendingIds.indexOf(c.id) === pending - 1}
                  aria-label={`Move ${c.add_player_name} down`}
                  className="flex h-6 w-8 items-center justify-center rounded text-black/60 hover:bg-black/5 disabled:opacity-25 dark:text-white/60 dark:hover:bg-white/10"
                >
                  ▼
                </button>
              </span>
            )}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="wrap-break-word">
                {c.add_player_name}
                {c.drop_player_name && (
                  <span className="text-black/50 dark:text-white/50"> (drop {c.drop_player_name})</span>
                )}
              </span>
              {c.status === "pending" && c.clears_at && (
                <span className="text-xs text-black/50 dark:text-white/50">{processesAt(c.clears_at)}</span>
              )}
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
      )}
    </div>
  );
}
