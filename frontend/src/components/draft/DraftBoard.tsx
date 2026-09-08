"use client";

import { useState } from "react";
import type { DraftConfig, DraftPick } from "@/lib/draftApi";
import { usePlayerCard } from "@/components/players/PlayerCardProvider";
import { positionColor } from "@/lib/positionColors";

/**
 * The real team x round grid — the single most-used artifact in every
 * competitor's draft room (ESPN/Yahoo/Sleeper all ship one; this app
 * previously only had a linear "recent picks" feed, the biggest named
 * gap in the 2026-08-31 competitive UX audit's Draft review). Built
 * entirely from data DraftRoom.tsx already fetches (config.draft_order
 * for a stable column order, picks for cell contents) — no new backend
 * endpoint. Columns are fixed at each team's ROUND-1 slot regardless of
 * snake direction, since every cell is independently keyed by
 * (round, owner_id) rather than by column-implies-turn-order — a
 * team's picks always line up in the same column round over round,
 * which is the whole point of a draft board.
 *
 * Settings > Labs > "Try the new look" — Documentation/UX/
 * 00_UX_Audit.md's confirmed mobile finding: the full grid below is a
 * literal <table> in overflow-x-auto, genuinely horizontal-scrolling
 * on a phone for any real league size/round count. `beta` swaps to a
 * one-round-at-a-time row list instead (Documentation/UX/
 * 01_Design_System.md section 13's "no <table> on mobile" rule) — same
 * underlying data, just one round's worth of cells at a time, with no
 * dependency on team count or round count for layout width. The
 * legacy grid (desktop-appropriate, per Documentation/UX/
 * 05_Desktop_Strategy.md) is unchanged.
 */
export function DraftBoard({
  config,
  picks,
  teamNameByOwner,
  currentPickNumber,
  gradesByOwner,
  onOpenGrade,
  beta = false,
}: {
  config: DraftConfig;
  picks: DraftPick[];
  teamNameByOwner: Map<number, string>;
  currentPickNumber: number;
  // Only ever populated once the draft is complete and grades have been
  // computed (app/scheduler.py's draft-grades job) — undefined during
  // a live draft, so this never shows anything mid-pick. Full write-up
  // text lives elsewhere (too long for this dense grid); clicking the
  // badge just tells the parent which owner to show it for.
  gradesByOwner?: Map<number, { letter_grade: string; percentile: number }>;
  onOpenGrade?: (ownerId: number) => void;
  beta?: boolean;
}) {
  const { openPlayerCard } = usePlayerCard();

  const totalRounds = Object.values(config.roster_slots).reduce((a, b) => a + b, 0);
  const rounds = Array.from({ length: totalRounds }, (_, i) => i + 1);
  const columns = config.draft_order;

  const byRoundAndOwner = new Map<string, DraftPick>();
  for (const p of picks) byRoundAndOwner.set(`${p.round}:${p.owner_id}`, p);

  // Opens on whichever round the current pick actually belongs to
  // (read off the real pick record, not assumed from a numbering
  // formula) rather than always round 1 — a user opening the board
  // mid-draft lands somewhere relevant. Initializer-only: doesn't
  // auto-follow every subsequent pick, same as a real board a visitor
  // can browse freely once open.
  const [selectedRound, setSelectedRound] = useState(
    () => picks.find((p) => p.pick_number === currentPickNumber)?.round ?? 1
  );

  if (columns.length === 0 || totalRounds === 0) return null;

  if (beta) {
    const clampedRound = Math.min(Math.max(selectedRound, 1), totalRounds);
    return (
      <div className="wl-card flex flex-col gap-2 rounded-xl p-3">
        <div className="flex items-center justify-between px-1">
          <button
            type="button"
            onClick={() => setSelectedRound((r) => Math.max(1, r - 1))}
            disabled={clampedRound <= 1}
            aria-label="Previous round"
            className="flex h-8 w-8 items-center justify-center rounded-full text-black/50 disabled:opacity-30 dark:text-white/50"
          >
            ‹
          </button>
          <span className="text-sm font-semibold">
            Round {clampedRound} <span className="text-black/40 dark:text-white/40">of {totalRounds}</span>
          </span>
          <button
            type="button"
            onClick={() => setSelectedRound((r) => Math.min(totalRounds, r + 1))}
            disabled={clampedRound >= totalRounds}
            aria-label="Next round"
            className="flex h-8 w-8 items-center justify-center rounded-full text-black/50 disabled:opacity-30 dark:text-white/50"
          >
            ›
          </button>
        </div>
        <div className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
          {columns.map((ownerId) => {
            const pick = byRoundAndOwner.get(`${clampedRound}:${ownerId}`);
            const isCurrent = pick?.pick_number === currentPickNumber;
            const filled = Boolean(pick?.sleeper_player_id);
            const color = filled ? positionColor(pick?.player_position) : null;
            const grade = gradesByOwner?.get(ownerId);
            return (
              <div key={ownerId} className="flex items-stretch gap-3 py-2.5">
                <span
                  className="w-1 shrink-0 self-stretch rounded-full"
                  style={{ backgroundColor: color ?? (isCurrent ? "var(--wl-accent)" : "transparent") }}
                  aria-hidden
                />
                <button
                  type="button"
                  disabled={!filled}
                  onClick={() => filled && openPlayerCard(pick!.sleeper_player_id!)}
                  className="flex min-w-0 flex-1 flex-col text-left disabled:cursor-default"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-semibold text-black/60 dark:text-white/60">
                      {teamNameByOwner.get(ownerId) ?? `Team ${ownerId}`}
                    </span>
                    {grade && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenGrade?.(ownerId);
                        }}
                        className="inline-flex items-center rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums hover:bg-black/20 dark:bg-white/10 dark:hover:bg-white/20"
                        title={`Draft grade: ${grade.letter_grade} (${Math.round(grade.percentile)}th percentile)`}
                      >
                        {grade.letter_grade}
                      </button>
                    )}
                  </span>
                  {pick?.sleeper_player_id ? (
                    <span className="flex items-center gap-1.5 text-sm">
                      <span className="truncate font-medium">{pick.player_name}</span>
                      <span className="shrink-0 text-[10px]" style={{ color: color ?? undefined }}>
                        {pick.player_position}
                      </span>
                      {pick.is_autopick && <span className="shrink-0 text-[10px] text-amber-500">AUTO</span>}
                      {pick.is_keeper && <span className="shrink-0 text-[10px] text-emerald-500">KEEP</span>}
                    </span>
                  ) : (
                    <span className="text-sm text-black/25 dark:text-white/25">
                      {isCurrent ? "On the clock" : "—"}
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="neon-panel overflow-x-auto rounded-xl p-3">
      <table className="w-full border-separate border-spacing-1 text-xs">
        <thead>
          <tr>
            <th className="w-8" />
            {columns.map((ownerId) => {
              const grade = gradesByOwner?.get(ownerId);
              return (
                <th
                  key={ownerId}
                  className="min-w-28 truncate px-1 pb-1 text-left font-semibold text-black/60 dark:text-white/60"
                >
                  {teamNameByOwner.get(ownerId) ?? `Team ${ownerId}`}
                  {grade && (
                    <button
                      onClick={() => onOpenGrade?.(ownerId)}
                      className="ml-1.5 inline-flex items-center rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums hover:bg-black/20 dark:bg-white/10 dark:hover:bg-white/20"
                      title={`Draft grade: ${grade.letter_grade} (${Math.round(grade.percentile)}th percentile)`}
                    >
                      {grade.letter_grade}
                    </button>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rounds.map((round) => (
            <tr key={round}>
              <td className="pr-1 text-right align-middle text-black/50 tabular-nums dark:text-white/50">
                {round}
              </td>
              {columns.map((ownerId) => {
                const pick = byRoundAndOwner.get(`${round}:${ownerId}`);
                const isCurrent = pick?.pick_number === currentPickNumber;
                const filled = Boolean(pick?.sleeper_player_id);
                const color = filled ? positionColor(pick?.player_position) : null;
                return (
                  <td key={ownerId} className="align-top">
                    <button
                      disabled={!filled}
                      onClick={() => filled && openPlayerCard(pick!.sleeper_player_id!)}
                      className={`flex w-full flex-col rounded-md px-1.5 py-1 text-left ${
                        isCurrent
                          ? "border border-[var(--wl-accent)] bg-[color-mix(in_srgb,var(--wl-accent)_14%,transparent)]"
                          : filled
                            ? "hover:brightness-125"
                            : "bg-black/[0.02] dark:bg-white/[0.02]"
                      }`}
                      style={
                        filled && !isCurrent
                          ? {
                              borderLeft: `3px solid ${color}`,
                              backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
                            }
                          : undefined
                      }
                    >
                      {pick?.sleeper_player_id ? (
                        <>
                          <span className="truncate font-medium">{pick.player_name}</span>
                          <span className="flex items-center gap-1 text-[10px]" style={{ color: color ?? undefined }}>
                            {pick.player_position}
                            {pick.is_autopick && <span className="text-amber-500">AUTO</span>}
                            {pick.is_keeper && <span className="text-emerald-500">KEEP</span>}
                          </span>
                        </>
                      ) : (
                        <span className="text-black/25 dark:text-white/25">{isCurrent ? "On the clock" : "—"}</span>
                      )}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
