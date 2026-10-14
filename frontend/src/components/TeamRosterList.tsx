"use client";

import { useEffect, useState } from "react";
import type { RosterPlayer } from "@/lib/api";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { usePlayerCard } from "@/components/players/PlayerCardProvider";
import { formatGameTime } from "@/lib/gameTime";
import { positionColor } from "@/lib/positionColors";
import { slotDisplayLabel } from "@/lib/rosterSlots";

// Any team's roster rows on its team page (2026-10, like ESPN's team
// sheet): slot, headshot, name, that week's opponent and kickoff (or
// bye), projection and score. A client component so kickoff times
// render in the viewer's own timezone, after mount, the same way the
// matchup table does.
export function TeamRosterList({ title, players }: { title: string; players: RosterPlayer[] }) {
  const { openPlayerCard } = usePlayerCard();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(id);
  }, []);

  if (players.length === 0) return null;
  return (
    <section>
      <div className="mb-1 flex items-baseline justify-between px-1">
        <h2 className="text-sm font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">{title}</h2>
        <div className="flex gap-3 text-xs font-semibold text-black/50 dark:text-white/50">
          <span className="w-12 text-right">Proj</span>
          <span className="w-12 text-right">Score</span>
        </div>
      </div>
      <ul className="wl-card flex flex-col divide-y divide-black/5 overflow-hidden rounded-lg dark:divide-white/5">
        {players.map((p, i) => {
          const position = p.position ?? "";
          const sleeperId = typeof p.player_id === "string" ? p.player_id : null;
          const opponent = p.on_bye
            ? "Bye week"
            : p.next_opponent
              ? `${p.next_opponent}${p.game_time && mounted ? ` ${formatGameTime(p.game_time)}` : ""}`
              : null;
          return (
            <li key={`${p.player_id ?? p.player_name}-${i}`}>
              <button
                type="button"
                disabled={!sleeperId}
                onClick={() => sleeperId && openPlayerCard(sleeperId)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-black/[0.03] disabled:cursor-default dark:hover:bg-white/[0.04]"
              >
                <span className="h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: positionColor(position) }} aria-hidden />
                <span className="w-10 shrink-0 text-xs font-semibold text-black/50 dark:text-white/50">
                  {slotDisplayLabel(p.lineup_slot ?? "")}
                </span>
                <PlayerHeadshot
                  playerId={typeof p.player_id === "number" ? p.player_id : null}
                  sleeperPlayerId={sleeperId}
                  proTeam={p.pro_team}
                  name={p.player_name}
                  size={36}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-semibold">{p.player_name}</span>
                    {p.is_boom && <span title="Boom performance" aria-hidden>{"\u{1F525}"}</span>}
                    {p.is_bust && <span title="Bust performance" aria-hidden>{"\u{1F976}"}</span>}
                    {p.injury_status && (
                      <span className="shrink-0 text-[11px] font-bold text-red-500 dark:text-red-400">{p.injury_status}</span>
                    )}
                  </span>
                  <span className="truncate text-xs text-black/50 dark:text-white/50">
                    {position === "DEF" ? "D/ST" : position}
                    {p.pro_team ? ` · ${p.pro_team}` : ""}
                    {opponent ? `  ·  ${opponent}` : ""}
                  </span>
                </span>
                <span className="w-12 shrink-0 text-right tabular-nums text-black/50 dark:text-white/50">
                  {p.on_bye && p.points_scored === null
                    ? "Bye"
                    : p.points_projected !== null
                      ? Number(p.points_projected).toFixed(1)
                      : "—"}
                </span>
                <span className="w-12 shrink-0 text-right font-semibold tabular-nums">
                  {p.points_scored !== null ? Number(p.points_scored).toFixed(1) : "—"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
