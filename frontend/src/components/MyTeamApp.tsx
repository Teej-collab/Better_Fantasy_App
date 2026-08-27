"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getMyTeam,
  previewLineupSwap,
  submitLineupSwap,
  type LineupSwapPreview,
  type MyTeam,
  type RosterEntry,
} from "@/lib/api";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { usePlayerCard } from "@/components/players/PlayerCardProvider";
import { nflTeamName } from "@/lib/nfl-teams";
import { BENCH_SLOT_LABEL, canSwapSlots, starterSortIndex } from "@/lib/rosterSlots";

const BENCH_SLOTS = new Set([BENCH_SLOT_LABEL, "IR"]);

function RosterRow({
  entry,
  selectedForSwap,
  swapDisabled,
  onToggleSwapSelect,
  onViewPlayer,
}: {
  entry: RosterEntry;
  selectedForSwap: boolean;
  swapDisabled: boolean;
  onToggleSwapSelect: (entry: RosterEntry) => void;
  onViewPlayer: (sleeperPlayerId: string) => void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-black/5 py-3 last:border-0 dark:border-white/5">
      <div className="flex min-w-0 items-center gap-2.5">
        <PlayerHeadshot sleeperPlayerId={entry.player_id} proTeam={entry.pro_team} name={entry.player_name} size={36} />
        <div className="flex min-w-0 flex-col">
          <button
            onClick={() => onViewPlayer(entry.player_id)}
            className="truncate text-left text-sm font-medium hover:underline"
          >
            {entry.player_name}
          </button>
          <span className="text-xs text-black/50 dark:text-white/50">
            {entry.lineup_slot} · {nflTeamName(entry.pro_team ?? undefined) ?? entry.pro_team ?? "—"}
          </span>
          {entry.injury_status && entry.injury_status !== "ACTIVE" && (
            <span className="mt-0.5 w-fit rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 uppercase dark:text-red-400">
              {entry.injury_status}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-right text-xs tabular-nums text-black/60 dark:text-white/60">
        <button
          onClick={() => onToggleSwapSelect(entry)}
          disabled={swapDisabled}
          title={swapDisabled ? "Doesn't qualify for a swap with the selected player" : undefined}
          className={`rounded-full border px-2 py-1 text-[11px] font-medium disabled:opacity-30 ${
            selectedForSwap
              ? "border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400"
              : "border-black/10 text-black/50 dark:border-white/10 dark:text-white/50"
          }`}
        >
          {selectedForSwap ? "Selected" : "Swap"}
        </button>
      </div>
    </li>
  );
}

export function MyTeamApp() {
  const [team, setTeam] = useState<MyTeam | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [swapPreview, setSwapPreview] = useState<LineupSwapPreview | null>(null);
  // At most one selected at a time — swap is strictly pick-a-player,
  // then pick a qualifying partner, not "select any two."
  const [selected, setSelected] = useState<RosterEntry | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const { openPlayerCard } = usePlayerCard();

  useEffect(() => {
    getMyTeam()
      .then(setTeam)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load your team"));
  }, []);

  function confirmSwap() {
    if (!swapPreview) return;
    setSubmitting(true);
    setSubmitError(null);
    submitLineupSwap(swapPreview.player_a.player_id, swapPreview.player_b.player_id)
      .then((result) => {
        setSubmitted(`Swapped ${swapPreview.player_a.player_name} and ${swapPreview.player_b.player_name}.`);
        setSwapPreview(null);
        setTeam((prev) => (prev ? { ...prev, roster: result.roster } : prev));
      })
      .catch((e) => setSubmitError(e instanceof Error ? e.message : "Swap failed"))
      .finally(() => setSubmitting(false));
  }

  function toggleSwapSelect(entry: RosterEntry) {
    setSwapPreview(null);
    setPreviewError(null);
    setSubmitError(null);
    setSubmitted(null);

    if (selected === null) {
      setSelected(entry);
      return;
    }
    if (selected.player_id === entry.player_id) {
      setSelected(null); // clicking the already-selected player deselects it
      return;
    }
    // Any other row rendered as clickable is already a qualifying
    // partner (see swapDisabled below) — this defensively no-ops if
    // it somehow isn't, rather than firing an invalid preview.
    if (!canSwapSlots(selected.position, selected.lineup_slot, entry.position, entry.lineup_slot)) return;

    setPreviewing(true);
    previewLineupSwap(selected.player_id, entry.player_id)
      .then((result) => {
        setSwapPreview(result);
        setSelected(null);
      })
      .catch((e) => {
        setPreviewError(e instanceof Error ? e.message : "Preview failed");
        setSelected(null);
      })
      .finally(() => setPreviewing(false));
  }

  if (error) {
    return <p className="text-sm text-red-500">{error}</p>;
  }
  if (!team) {
    return <p className="text-sm text-black/50 dark:text-white/50">Loading your team…</p>;
  }

  const starters = team.roster
    .filter((e) => !BENCH_SLOTS.has(e.lineup_slot))
    .sort((a, b) => starterSortIndex(a.lineup_slot) - starterSortIndex(b.lineup_slot));
  const bench = team.roster.filter((e) => BENCH_SLOTS.has(e.lineup_slot));

  // Real state right now, not a hypothetical edge case: the actual
  // draft hasn't happened yet, so current_rosters is genuinely empty
  // for every owner — without this, the page below just renders two
  // empty boxes with no explanation (mobile audit finding, Aug 2026).
  if (team.roster.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">{team.team_name}</h1>
        <section className="neon-panel flex flex-col items-center gap-2 rounded-xl p-6 text-center">
          <p className="text-sm font-medium">Your roster is empty — the draft hasn&apos;t happened yet.</p>
          <p className="max-w-sm text-xs text-black/50 dark:text-white/50">
            Once the commissioner starts the real draft, players you pick will show up here.
          </p>
          <Link
            href="/draft"
            className="mt-1 rounded-full bg-[var(--wl-accent-dim)] px-4 py-1.5 text-xs font-semibold text-white hover:brightness-110"
          >
            Go to Draft
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">{team.team_name}</h1>
      </div>

      {previewing && <p className="text-xs text-black/50 dark:text-white/50">Checking…</p>}
      {previewError && <p className="text-xs text-red-500">{previewError}</p>}
      {submitError && <p className="text-xs text-red-500">{submitError}</p>}
      {submitted && <p className="text-xs text-emerald-600 dark:text-emerald-400">{submitted}</p>}

      {swapPreview && (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/[0.06] p-3 text-sm">
          <p>
            Swap <strong>{swapPreview.player_a.player_name}</strong> ({swapPreview.player_a.lineup_slot})
            with <strong>{swapPreview.player_b.player_name}</strong> ({swapPreview.player_b.lineup_slot})?
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={confirmSwap}
              disabled={submitting}
              className="rounded-full bg-sky-500 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Confirm swap"}
            </button>
            <button
              onClick={() => setSwapPreview(null)}
              disabled={submitting}
              className="rounded-full border border-black/10 px-3 py-1 text-xs font-medium text-black/60 disabled:opacity-50 dark:border-white/10 dark:text-white/60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {selected && (
        <p className="text-xs text-black/50 dark:text-white/50">
          Selected {selected.player_name} for a swap — pick a player who qualifies for their slot (and vice versa).
        </p>
      )}

      <section className="flex flex-col gap-1">
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Starters</h2>
        <ul className="neon-panel rounded-lg bg-black/[0.015] px-4 dark:bg-white/[0.03]">
          {starters.map((e) => (
            <RosterRow
              key={e.player_id}
              entry={e}
              selectedForSwap={selected?.player_id === e.player_id}
              swapDisabled={
                selected !== null &&
                selected.player_id !== e.player_id &&
                !canSwapSlots(selected.position, selected.lineup_slot, e.position, e.lineup_slot)
              }
              onToggleSwapSelect={toggleSwapSelect}
              onViewPlayer={openPlayerCard}
            />
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Bench</h2>
        <ul className="neon-panel rounded-lg bg-black/[0.015] px-4 dark:bg-white/[0.03]">
          {bench.map((e) => (
            <RosterRow
              key={e.player_id}
              entry={e}
              selectedForSwap={selected?.player_id === e.player_id}
              swapDisabled={
                selected !== null &&
                selected.player_id !== e.player_id &&
                !canSwapSlots(selected.position, selected.lineup_slot, e.position, e.lineup_slot)
              }
              onToggleSwapSelect={toggleSwapSelect}
              onViewPlayer={openPlayerCard}
            />
          ))}
        </ul>
      </section>

    </div>
  );
}
