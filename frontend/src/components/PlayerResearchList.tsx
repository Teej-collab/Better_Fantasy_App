"use client";

import { type PlayerListEntry } from "@/lib/playerCardApi";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { usePlayerCard } from "@/components/players/PlayerCardProvider";
import { nflTeamName } from "@/lib/nfl-teams";

/**
 * Read-only research list — every real NFL player matching the current
 * position/search filter, sorted by fantasy relevance. Same row shape
 * as FreeAgentsList.tsx (headshot, name -> PlayerCardModal, position/
 * team, injury badge) minus the Add action (this isn't scoped to "can
 * I add this player," rostered players are included on purpose — see
 * app/(app)/player-research/page.tsx), plus a rostered badge so a
 * researcher can tell at a glance who's already spoken for.
 */
export function PlayerResearchList({ players }: { players: PlayerListEntry[] }) {
  const { openPlayerCard } = usePlayerCard();

  if (players.length === 0) {
    return <p className="text-sm text-black/50 dark:text-white/50">No players found.</p>;
  }

  return (
    <ol className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]">
      {players.map((p, i) => (
        <li key={p.sleeper_player_id}>
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <span className="flex min-w-0 items-center gap-3">
              <span className="w-5 shrink-0 text-black/40 tabular-nums dark:text-white/40">{i + 1}</span>
              <PlayerHeadshot sleeperPlayerId={p.sleeper_player_id} proTeam={p.pro_team} name={p.full_name} size={36} />
              <span className="flex min-w-0 flex-col">
                <button
                  onClick={() => openPlayerCard(p.sleeper_player_id)}
                  className="truncate text-left font-medium hover:underline"
                >
                  {p.full_name}
                </button>
                <span className="text-xs text-black/50 dark:text-white/50">
                  {p.position} · {nflTeamName(p.pro_team ?? undefined) ?? p.pro_team ?? "—"}
                </span>
                {p.injury_status && p.injury_status !== "ACTIVE" && (
                  <span className="mt-0.5 w-fit rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 uppercase dark:text-red-400">
                    {p.injury_status}
                  </span>
                )}
              </span>
            </span>
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase ${
                p.is_rostered
                  ? "bg-black/10 text-black/50 dark:bg-white/10 dark:text-white/50"
                  : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {p.is_rostered ? "Rostered" : "Available"}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
