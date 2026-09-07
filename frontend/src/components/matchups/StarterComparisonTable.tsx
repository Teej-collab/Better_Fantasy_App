"use client";

import { useEffect, useState } from "react";
import type { RosterPlayer } from "@/lib/api";
import { usePlayerCard } from "@/components/players/PlayerCardProvider";
import { formatGameTime } from "@/lib/gameTime";
import { teamLogoUrl } from "@/lib/nfl-teams";
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

// "QUESTIONABLE" -> "Q" — the reference layout (real ESPN matchup
// screen, 2026-09) shows a single-letter flag right next to the name
// instead of a separate pill on its own line, which is a big part of
// why it reads as spacious instead of cluttered at the same
// information density. Falls back to the first letter for a status
// this map doesn't know about, rather than silently dropping it.
const INJURY_SHORT_CODE: Record<string, string> = {
  QUESTIONABLE: "Q",
  DOUBTFUL: "D",
  OUT: "O",
  IR: "IR",
  PUP: "PUP",
  SUSPENDED: "S",
};

function injuryShortCode(status: string): string {
  return INJURY_SHORT_CODE[status] ?? status.slice(0, 1);
}

// Everything for ONE player lives in a single flex column here —
// deliberately not split across separate flex siblings (an earlier
// version put the projected-points number in its own sibling box next
// to a mirrored/flex-row-reverse name block, which on a narrow phone
// let the two siblings' text visually collide — 2026-09, reported).
// Keeping name+points on the same line, in the same box, guarantees
// the browser can never lay them on top of each other.
//
// Uses the real NFL team's badge (small, 24px) instead of a player
// headshot photo — matched to the reference screenshot's own choice,
// which is most of why it reads as roomy at a glance: no headshot
// means more width for the name to run at a bigger size before
// truncating, and no headshot column means less to visually parse
// per row. My Team's own roster view keeps real headshots — this is
// specific to the matchup screen's side-by-side density.
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
  const logo = teamLogoUrl(player.pro_team);
  const showInjury = player.injury_status && player.injury_status !== "ACTIVE";
  const inner = (
    <>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- ESPN's CDN, not a static asset next/image can optimize.
        <img src={logo} alt="" width={24} height={24} className="h-6 w-6 shrink-0 object-contain" />
      ) : (
        <span className="h-6 w-6 shrink-0" aria-hidden />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-1.5">
          <span className="min-w-0 flex-1 truncate text-base font-semibold">
            {player.player_name}
            {showInjury && (
              <span
                className="ml-1.5 text-xs font-bold text-red-500 dark:text-red-400"
                title={player.injury_status ?? undefined}
              >
                {injuryShortCode(player.injury_status as string)}
              </span>
            )}
          </span>
          <span className="shrink-0 text-sm tabular-nums text-black/50 dark:text-white/50">
            {player.points_projected != null ? player.points_projected.toFixed(1) : "—"}
          </span>
        </span>
        <span className="truncate text-xs text-black/50 dark:text-white/50">
          {player.pro_team ?? "—"}
          {player.next_opponent && ` ${player.next_opponent}`}
          {player.game_time && mounted && ` · ${formatGameTime(player.game_time)}`}
        </span>
      </span>
    </>
  );
  const rowClass = "flex min-w-0 flex-1 items-center gap-2.5";
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
 * opponent/game time, and an inline injury flag when they have one.
 * Bench/IR players never appear here. A CSS grid (not nested flex)
 * sizes the slot label column exactly and gives both sides identical,
 * bounded space.
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
          <div key={i} className="grid grid-cols-[1fr_2.5rem_1fr] items-center gap-2 py-4">
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
