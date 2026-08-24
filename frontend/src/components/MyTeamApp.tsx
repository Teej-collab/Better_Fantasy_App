"use client";

import { useEffect, useState } from "react";
import { getMyTeam, previewLineupSwap, type LineupSwapPreview, type MyTeam, type RosterEntry } from "@/lib/api";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { nflTeamName } from "@/lib/nfl-teams";

const BENCH_SLOTS = new Set(["BE", "IR"]);

// ESPN's own starter display order — QB, RB, RB, WR, WR, TE, FLEX,
// D/ST, K. This league's flex slot is stored as "RB/WR/TE" (its
// actual eligibility), not "FLEX" — same real slot label the backend
// already sorts by for historical box scores (app/queries/league.py's
// _SLOT_ORDER). Anything not in this list (bench/IR) sorts last, but
// starters is already filtered to exclude those before this runs.
const STARTER_SLOT_ORDER = ["QB", "RB", "WR", "TE", "RB/WR/TE", "D/ST", "K"];

function starterSortIndex(slotLabel: string): number {
  const i = STARTER_SLOT_ORDER.indexOf(slotLabel);
  return i === -1 ? STARTER_SLOT_ORDER.length : i;
}

// Two players can trade places iff each is actually eligible for the
// slot the other currently occupies — the real rule a swap has to
// satisfy, and exactly what "QB=QB, RB=RB/FLEX, WR=WR/FLEX,
// TE=TE/FLEX, D/ST=D/ST, K=K" amounts to once you account for the
// real flex slot: an RB's own eligible_slots already include both the
// RB slot and the flex slot (same for WR/TE), while QB/D-ST/K are
// only ever eligible for their own single slot. Driven by each
// player's real eligible_slots (straight from ESPN, already fetched
// for the "Move to" preview this replaced) rather than a hardcoded
// position table, so it stays correct for any eligibility quirk ESPN
// itself has, not just the common case.
function canSwap(a: RosterEntry, b: RosterEntry): boolean {
  const aFitsBsSlot = a.eligible_slots.some((s) => s.id === b.lineup_slot_id);
  const bFitsAsSlot = b.eligible_slots.some((s) => s.id === a.lineup_slot_id);
  return aFitsBsSlot && bFitsAsSlot;
}

function RosterRow({
  entry,
  selectedForSwap,
  swapDisabled,
  onToggleSwapSelect,
}: {
  entry: RosterEntry;
  selectedForSwap: boolean;
  swapDisabled: boolean;
  onToggleSwapSelect: (entry: RosterEntry) => void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-black/5 py-3 last:border-0 dark:border-white/5">
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

  useEffect(() => {
    getMyTeam()
      .then(setTeam)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load your team"));
  }, []);

  function toggleSwapSelect(entry: RosterEntry) {
    setSwapPreview(null);
    setPreviewError(null);

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
    if (!canSwap(selected, entry)) return;

    setPreviewing(true);
    previewLineupSwap(selected.player_name, entry.player_name)
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
    .filter((e) => !BENCH_SLOTS.has(e.lineup_slot_label))
    .sort((a, b) => starterSortIndex(a.lineup_slot_label) - starterSortIndex(b.lineup_slot_label));
  const bench = team.roster.filter((e) => BENCH_SLOTS.has(e.lineup_slot_label));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">{team.team_name}</h1>
        <span className="text-xs text-black/40 dark:text-white/40">Live from ESPN</span>
      </div>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3 text-xs text-black/70 dark:text-white/70">
        Swaps below are <strong>previews only</strong> — they show exactly what would happen, but nothing is
        actually submitted to ESPN yet. Make the real change in the ESPN app for now.
      </div>

      {previewing && <p className="text-xs text-black/50 dark:text-white/50">Checking…</p>}
      {previewError && <p className="text-xs text-red-500">{previewError}</p>}

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
              swapDisabled={e.is_locked || (selected !== null && selected.player_id !== e.player_id && !canSwap(selected, e))}
              onToggleSwapSelect={toggleSwapSelect}
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
              swapDisabled={e.is_locked || (selected !== null && selected.player_id !== e.player_id && !canSwap(selected, e))}
              onToggleSwapSelect={toggleSwapSelect}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}
