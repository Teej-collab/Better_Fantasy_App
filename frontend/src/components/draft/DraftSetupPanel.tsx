"use client";

import { useState } from "react";
import { pauseDraft, resetDraft, resumeDraft, setupDraft, startDraft, undoLastPick, type DraftConfig } from "@/lib/draftApi";
import type { Team } from "@/lib/api";

// This league's real ESPN roster shape (confirmed from the
// commissioner's own league settings — see the project plan): 1 QB, 2
// RB, 2 WR, 1 TE, 1 FLEX, 1 D/ST, 1 K, 7 bench. IR isn't included —
// this league's IR spot is never filled by the initial draft, only
// later via waivers.
const DEFAULT_ROSTER_SLOTS = { QB: 1, RB: 2, WR: 2, TE: 1, "RB/WR/TE": 1, "D/ST": 1, K: 1, BE: 7 };
const DEFAULT_PICK_SECONDS = 90; // matches this league's real ESPN draft setting

export function DraftSetupPanel({
  teams,
  config,
  onDraftCreated,
}: {
  teams: Team[];
  config?: DraftConfig;
  onDraftCreated: () => void;
}) {
  const [order, setOrder] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleOwner(ownerId: number) {
    setOrder((prev) => (prev.includes(ownerId) ? prev.filter((id) => id !== ownerId) : [...prev, ownerId]));
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onDraftCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  function confirmReset() {
    const message =
      config?.status === "complete" || config?.status === "in_progress"
        ? "This wipes every pick and roster this draft has made — for real, not just a mock. Reset anyway?"
        : "This deletes the current draft order and setup. Reset?";
    if (window.confirm(message)) run(resetDraft);
  }

  if (!config) {
    return (
      <section className="neon-panel flex flex-col gap-3 rounded-xl p-4">
        <h2 className="text-sm font-semibold">Commissioner: set up the draft</h2>
        <p className="text-xs text-black/50 dark:text-white/50">
          Click teams below in the order they should pick (round 1 order — later rounds snake automatically).
        </p>
        <div className="flex flex-wrap gap-2">
          {teams.map((t) => {
            const position = order.indexOf(t.owner_id);
            return (
              <button
                key={t.owner_id}
                onClick={() => toggleOwner(t.owner_id)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  position >= 0
                    ? "border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400"
                    : "border-black/10 text-black/60 dark:border-white/10 dark:text-white/60"
                }`}
              >
                {position >= 0 && `${position + 1}. `}
                {t.team_name}
              </button>
            );
          })}
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <button
          onClick={() => run(() => setupDraft(order, DEFAULT_ROSTER_SLOTS, DEFAULT_PICK_SECONDS))}
          disabled={busy || order.length !== teams.length}
          className="w-fit rounded-full bg-sky-500 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          {order.length !== teams.length
            ? `Select all ${teams.length} teams (${order.length}/${teams.length})`
            : "Create draft"}
        </button>
      </section>
    );
  }

  const teamNameByOwner = new Map(teams.map((t) => [t.owner_id, t.team_name]));

  return (
    <section className="neon-panel flex flex-wrap items-center gap-2 rounded-xl p-4">
      {error && <p className="w-full text-xs text-red-500">{error}</p>}
      <p className="w-full text-xs text-black/50 dark:text-white/50">
        Draft order: {config.draft_order.map((id, i) => `${i + 1}. ${teamNameByOwner.get(id) ?? id}`).join(" · ")}
      </p>
      {config.status === "not_started" && (
        <button
          onClick={() => run(startDraft)}
          disabled={busy}
          className="rounded-full bg-sky-500 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          Start draft
        </button>
      )}
      {config.status === "in_progress" && (
        <>
          <button
            onClick={() => run(pauseDraft)}
            disabled={busy}
            className="rounded-full border border-black/10 px-3 py-1 text-xs font-medium dark:border-white/10"
          >
            Pause
          </button>
          <button
            onClick={() => run(undoLastPick)}
            disabled={busy}
            className="rounded-full border border-black/10 px-3 py-1 text-xs font-medium dark:border-white/10"
          >
            Undo last pick
          </button>
        </>
      )}
      {config.status === "paused" && (
        <button
          onClick={() => run(resumeDraft)}
          disabled={busy}
          className="rounded-full bg-sky-500 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
        >
          Resume
        </button>
      )}
      {config.status === "complete" && <span className="text-xs text-black/50 dark:text-white/50">Draft complete.</span>}
      <button
        onClick={confirmReset}
        disabled={busy}
        className="rounded-full border border-red-500/30 px-3 py-1 text-xs font-medium text-red-500 disabled:opacity-40"
      >
        Reset draft
      </button>
    </section>
  );
}
