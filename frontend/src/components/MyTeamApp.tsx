"use client";

import { useEffect, useState } from "react";
import {
  getMyTeam,
  previewLineupMove,
  previewLineupSwap,
  type LineupMovePreview,
  type LineupSwapPreview,
  type MyTeam,
  type RosterEntry,
} from "@/lib/api";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { nflTeamName } from "@/lib/nfl-teams";

const BENCH_SLOTS = new Set(["BE", "IR"]);

function RosterRow({
  entry,
  onPreviewMove,
  selectedForSwap,
  onToggleSwapSelect,
}: {
  entry: RosterEntry;
  onPreviewMove: (entry: RosterEntry, toSlotLabel: string) => void;
  selectedForSwap: boolean;
  onToggleSwapSelect: (entry: RosterEntry) => void;
}) {
  const otherEligibleSlots = entry.eligible_slots.filter((s) => s.label !== entry.lineup_slot_label);

  return (
    <li className="flex flex-col gap-2 border-b border-black/5 py-3 last:border-0 dark:border-white/5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <PlayerHeadshot playerId={entry.player_id} proTeam={entry.pro_team} name={entry.player_name} size={36} />
          <div className="flex min-w-0 flex-col">
            <span className="flex items-center gap-2 truncate text-sm font-medium">
              {entry.player_name}
              {entry.is_locked && (
                <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase dark:bg-white/10">
                  Locked
                </span>
              )}
              {entry.injury_status && entry.injury_status !== "ACTIVE" && (
                <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 uppercase dark:text-red-400">
                  {entry.injury_status}
                </span>
              )}
            </span>
            <span className="text-xs text-black/50 dark:text-white/50">
              {entry.lineup_slot_label} · {nflTeamName(entry.pro_team) ?? entry.pro_team}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-right text-xs tabular-nums text-black/60 dark:text-white/60">
          <div className="flex flex-col items-end">
            <span className="font-semibold">{entry.points_scored ?? "—"}</span>
            <span className="text-black/40 dark:text-white/40">proj {entry.points_projected ?? "—"}</span>
          </div>
          <button
            onClick={() => onToggleSwapSelect(entry)}
            className={`rounded-full border px-2 py-1 text-[11px] font-medium ${
              selectedForSwap
                ? "border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400"
                : "border-black/10 text-black/50 dark:border-white/10 dark:text-white/50"
            }`}
          >
            {selectedForSwap ? "Selected" : "Swap"}
          </button>
        </div>
      </div>
      {otherEligibleSlots.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {otherEligibleSlots.map((slot) => (
            <button
              key={slot.id}
              onClick={() => onPreviewMove(entry, slot.label)}
              disabled={entry.is_locked}
              className="rounded-full border border-black/10 px-2 py-1 text-[11px] text-black/60 hover:bg-black/5 disabled:opacity-30 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/5"
            >
              Move to {slot.label}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

export function MyTeamApp() {
  const [team, setTeam] = useState<MyTeam | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [movePreview, setMovePreview] = useState<LineupMovePreview | null>(null);
  const [swapPreview, setSwapPreview] = useState<LineupSwapPreview | null>(null);
  const [swapSelection, setSwapSelection] = useState<RosterEntry[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    getMyTeam()
      .then(setTeam)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load your team"));
  }, []);

  async function handlePreviewMove(entry: RosterEntry, toSlotLabel: string) {
    setPreviewing(true);
    setPreviewError(null);
    setSwapPreview(null);
    try {
      const result = await previewLineupMove(entry.player_name, toSlotLabel);
      setMovePreview(result);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : "Preview failed");
      setMovePreview(null);
    } finally {
      setPreviewing(false);
    }
  }

  function toggleSwapSelect(entry: RosterEntry) {
    setMovePreview(null);
    setSwapPreview(null);
    setPreviewError(null);

    const already = swapSelection.find((p) => p.player_id === entry.player_id);
    const next = already
      ? swapSelection.filter((p) => p.player_id !== entry.player_id)
      : [...swapSelection, entry].slice(-2); // only ever the two most recently picked
    setSwapSelection(next);

    if (next.length === 2) {
      setPreviewing(true);
      setPreviewError(null);
      previewLineupSwap(next[0].player_name, next[1].player_name)
        .then((result) => {
          setSwapPreview(result);
          setSwapSelection([]);
        })
        .catch((e) => {
          setPreviewError(e instanceof Error ? e.message : "Preview failed");
          setSwapSelection([]);
        })
        .finally(() => setPreviewing(false));
    }
  }

  if (error) {
    return <p className="text-sm text-red-500">{error}</p>;
  }
  if (!team) {
    return <p className="text-sm text-black/50 dark:text-white/50">Loading your team…</p>;
  }

  const starters = team.roster.filter((e) => !BENCH_SLOTS.has(e.lineup_slot_label));
  const bench = team.roster.filter((e) => BENCH_SLOTS.has(e.lineup_slot_label));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">{team.team_name}</h1>
        <span className="text-xs text-black/40 dark:text-white/40">Live from ESPN</span>
      </div>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3 text-xs text-black/70 dark:text-white/70">
        Moves and swaps below are <strong>previews only</strong> — they show exactly what would happen, but nothing
        is actually submitted to ESPN yet. Make the real change in the ESPN app for now.
      </div>

      {previewing && <p className="text-xs text-black/50 dark:text-white/50">Checking…</p>}
      {previewError && <p className="text-xs text-red-500">{previewError}</p>}

      {movePreview && (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/[0.06] p-3 text-sm">
          <button onClick={() => setMovePreview(null)} className="float-right text-xs text-black/40 dark:text-white/40">
            ✕
          </button>
          <p>
            <strong>{movePreview.player.player_name}</strong> {movePreview.from_slot.label} → {movePreview.to_slot.label}
          </p>
          {movePreview.displaced_player && (
            <p className="text-black/60 dark:text-white/60">
              Would bump <strong>{movePreview.displaced_player.player_name}</strong> to Bench.
            </p>
          )}
        </div>
      )}

      {swapPreview && (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/[0.06] p-3 text-sm">
          <button onClick={() => setSwapPreview(null)} className="float-right text-xs text-black/40 dark:text-white/40">
            ✕
          </button>
          <p>
            Would swap <strong>{swapPreview.player_a.player_name}</strong> ({swapPreview.player_a.lineup_slot_label})
            with <strong>{swapPreview.player_b.player_name}</strong> ({swapPreview.player_b.lineup_slot_label}).
          </p>
        </div>
      )}

      {swapSelection.length === 1 && (
        <p className="text-xs text-black/50 dark:text-white/50">
          Selected {swapSelection[0].player_name} for a swap — pick one more player.
        </p>
      )}

      <section className="flex flex-col gap-1">
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Starters</h2>
        <ul className="rounded-lg border border-black/10 bg-black/[0.015] px-4 dark:border-white/10 dark:bg-white/[0.03]">
          {starters.map((e) => (
            <RosterRow
              key={e.player_id}
              entry={e}
              onPreviewMove={handlePreviewMove}
              selectedForSwap={swapSelection.some((p) => p.player_id === e.player_id)}
              onToggleSwapSelect={toggleSwapSelect}
            />
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Bench</h2>
        <ul className="rounded-lg border border-black/10 bg-black/[0.015] px-4 dark:border-white/10 dark:bg-white/[0.03]">
          {bench.map((e) => (
            <RosterRow
              key={e.player_id}
              entry={e}
              onPreviewMove={handlePreviewMove}
              selectedForSwap={swapSelection.some((p) => p.player_id === e.player_id)}
              onToggleSwapSelect={toggleSwapSelect}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}
