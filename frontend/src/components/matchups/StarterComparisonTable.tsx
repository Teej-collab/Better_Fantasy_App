"use client";

import { useEffect, useState } from "react";
import type { RosterPlayer } from "@/lib/api";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { usePlayerCard } from "@/components/players/PlayerCardProvider";
import { formatGameTime } from "@/lib/gameTime";
import { BENCH_SLOT_LABEL, slotDisplayLabel, starterSortIndex } from "@/lib/rosterSlots";

// Starters only (bench/IR excluded), in the same QB/RB/RB/WR/WR/TE/
// FLEX/D-ST/K order the roster edit UI already uses (STARTER_SLOT_ORDER
// in lib/rosterSlots.ts) — a real multi-RB/WR league has more than one
// player per slot label, so ties within a slot fall back to name so
// the two sides' Nth-ranked starter in a slot lines up on the same row
// as consistently as possible without this app tracking a "starter 1
// vs starter 2" identity anywhere.
function starters(roster: RosterPlayer[]): RosterPlayer[] {
  return [...roster]
    .filter((p) => p.lineup_slot !== BENCH_SLOT_LABEL && p.lineup_slot !== "IR")
    .sort((a, b) => {
      const ai = starterSortIndex(a.lineup_slot ?? "");
      const bi = starterSortIndex(b.lineup_slot ?? "");
      return ai !== bi ? ai - bi : a.player_name.localeCompare(b.player_name);
    });
}

// Everything for ONE player lives in a single flex column here —
// deliberately not split across separate flex siblings (an earlier
// version put the projected-points number in its own sibling box next
// to a mirrored/flex-row-reverse name block, which on a narrow phone
// let the two siblings' text visually collide — 2026-09, reported).
// Keeping name+points on the same line, in the same box, guarantees
// the browser can never lay them on top of each other.
function PlayerCell({
  player,
  mounted,
  onOpen,
}: {
  player: RosterPlayer | null;
  mounted: boolean;
  onOpen: (sleeperPlayerId: string) => void;
}) {
  if (!player) return <div className="min-w-0 flex-1" />;
  const clickable = typeof player.player_id === "string";
  const inner = (
    <>
      <PlayerHeadshot
        playerId={typeof player.player_id === "number" ? player.player_id : null}
        sleeperPlayerId={typeof player.player_id === "string" ? player.player_id : null}
        proTeam={player.pro_team}
        name={player.player_name}
        size={32}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-baseline gap-1">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{player.player_name}</span>
          <span className="shrink-0 text-xs tabular-nums text-black/50 dark:text-white/50">
            {player.points_projected != null ? player.points_projected.toFixed(1) : "—"}
          </span>
        </span>
        <span className="truncate text-xs text-black/50 dark:text-white/50">
          {player.pro_team ?? "—"}
          {player.next_opponent && ` ${player.next_opponent}`}
          {player.game_time && mounted && ` · ${formatGameTime(player.game_time)}`}
        </span>
        {player.injury_status && player.injury_status !== "ACTIVE" && (
          <span className="mt-0.5 w-fit rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 uppercase dark:text-red-400">
            {player.injury_status}
          </span>
        )}
      </span>
    </>
  );
  const rowClass = "flex min-w-0 flex-1 items-center gap-2";
  return clickable ? (
    <button onClick={() => onOpen(player.player_id as string)} className={`${rowClass} text-left hover:underline`}>
      {inner}
    </button>
  ) : (
    <div className={rowClass}>{inner}</div>
  );
}

/**
 * The two-column starter breakdown — one row per starter slot
 * (QB/RB/RB/WR/WR/TE/FLEX/D-ST/K), home's player on the left, away's
 * on the right, each with their real projected points, next real
 * opponent/game time, and injury tag when they have one. Bench/IR
 * players never appear here. A CSS grid (not nested flex) sizes the
 * slot label column exactly and gives both sides identical, bounded
 * space — the layout that produced the mobile overlap bug this
 * replaces was nested flex with mirrored (flex-row-reverse) sides.
 */
export function StarterComparisonTable({ home, away }: { home: RosterPlayer[]; away: RosterPlayer[] }) {
  const { openPlayerCard } = usePlayerCard();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // setTimeout(0), not a direct setState call in the effect body —
    // same lint-satisfying pattern FreeAgentsList.tsx's identical mount
    // effect uses.
    const id = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(id);
  }, []);

  const homeStarters = starters(home);
  const awayStarters = starters(away);
  const rowCount = Math.max(homeStarters.length, awayStarters.length);

  if (rowCount === 0) {
    return <p className="text-sm text-black/50 dark:text-white/50">No starting lineup set for this week yet.</p>;
  }

  return (
    <div className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
      {Array.from({ length: rowCount }, (_, i) => {
        const h = homeStarters[i] ?? null;
        const a = awayStarters[i] ?? null;
        const slot = slotDisplayLabel((h ?? a)?.lineup_slot ?? "");
        return (
          <div key={i} className="grid grid-cols-[1fr_2.25rem_1fr] items-center gap-1.5 py-2.5">
            <PlayerCell player={h} mounted={mounted} onOpen={openPlayerCard} />
            <span className="text-center text-[11px] font-semibold tracking-wide text-black/40 uppercase dark:text-white/40">
              {slot}
            </span>
            <PlayerCell player={a} mounted={mounted} onOpen={openPlayerCard} />
          </div>
        );
      })}
    </div>
  );
}
