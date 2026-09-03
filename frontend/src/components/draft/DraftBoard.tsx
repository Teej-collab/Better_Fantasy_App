"use client";

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
 */
export function DraftBoard({
  config,
  picks,
  teamNameByOwner,
  currentPickNumber,
}: {
  config: DraftConfig;
  picks: DraftPick[];
  teamNameByOwner: Map<number, string>;
  currentPickNumber: number;
}) {
  const { openPlayerCard } = usePlayerCard();

  const totalRounds = Object.values(config.roster_slots).reduce((a, b) => a + b, 0);
  const rounds = Array.from({ length: totalRounds }, (_, i) => i + 1);
  const columns = config.draft_order;

  const byRoundAndOwner = new Map<string, DraftPick>();
  for (const p of picks) byRoundAndOwner.set(`${p.round}:${p.owner_id}`, p);

  if (columns.length === 0 || totalRounds === 0) return null;

  return (
    <div className="neon-panel overflow-x-auto rounded-xl p-3">
      <table className="w-full border-separate border-spacing-1 text-xs">
        <thead>
          <tr>
            <th className="w-8" />
            {columns.map((ownerId) => (
              <th
                key={ownerId}
                className="min-w-28 truncate px-1 pb-1 text-left font-semibold text-black/60 dark:text-white/60"
              >
                {teamNameByOwner.get(ownerId) ?? `Team ${ownerId}`}
              </th>
            ))}
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
