"use client";

import type { TrendingPlayers } from "@/lib/api";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { usePlayerCard } from "@/components/players/PlayerCardProvider";
import { hasInjuryBadge, injuryShortCode } from "@/lib/injuryStatus";

// Rows for /free-agents/trending. Client-side only for the player card
// opener; the list itself is fetched by the page.
export function TrendingPlayersList({ data }: { data: TrendingPlayers }) {
  const { openPlayerCard } = usePlayerCard();
  const verb = data.kind === "add" ? "Added" : "Dropped";
  const fromApp = data.source === "app";

  if (data.players.length === 0) {
    return (
      <p className="neon-panel rounded-lg bg-black/[0.015] px-4 py-6 text-center text-sm text-black/50 dark:bg-white/[0.03] dark:text-white/50">
        {fromApp ? `No one ${verb.toLowerCase()} in this window yet.` : "Sleeper's feed is empty right now."}
      </p>
    );
  }

  return (
    <div className="neon-panel flex flex-col rounded-lg bg-black/[0.015] dark:bg-white/[0.03]">
      <div className="flex items-center justify-between gap-2 border-b border-black/5 px-3 py-2 text-[11px] font-semibold tracking-wide text-black/50 uppercase sm:px-4 dark:border-white/5 dark:text-white/50">
        <span>Player</span>
        <span className="flex shrink-0 items-center gap-3 sm:gap-4">
          {fromApp && <span className="hidden w-16 text-right sm:block">Rostered</span>}
          <span className="w-14 text-right">{verb}</span>
        </span>
      </div>
      <ol className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
        {data.players.map((p, i) => (
          <li key={p.sleeper_player_id} className="flex items-center justify-between gap-2 px-3 py-2 sm:px-4">
            <span className="flex min-w-0 items-center gap-2">
              <span className="w-5 shrink-0 text-right text-xs tabular-nums text-black/40 dark:text-white/40">{i + 1}</span>
              <PlayerHeadshot sleeperPlayerId={p.sleeper_player_id} proTeam={p.pro_team} name={p.full_name} size={28} />
              <span className="flex min-w-0 flex-col">
                <button
                  type="button"
                  onClick={() => openPlayerCard(p.sleeper_player_id)}
                  className="truncate text-left text-sm font-medium hover:underline"
                >
                  {p.full_name}
                  {hasInjuryBadge(p.injury_status) && (
                    <span className="ml-1.5 text-[10px] font-bold text-red-500">{injuryShortCode(p.injury_status)}</span>
                  )}
                </button>
                <span className="text-[11px] text-black/50 dark:text-white/50">
                  {p.position === "DEF" ? "D/ST" : p.position} · {p.pro_team ?? "FA"}
                  {p.available ? (
                    <span className="ml-1.5 font-semibold text-emerald-600 dark:text-emerald-400">Available</span>
                  ) : (
                    <span className="ml-1.5">· Rostered in your league</span>
                  )}
                </span>
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-3 sm:gap-4">
              {fromApp && (
                <span className="hidden w-16 text-right text-xs tabular-nums text-black/50 sm:block dark:text-white/50">
                  {p.rostered_leagues}/{data.leagues_tracked}
                </span>
              )}
              <span className="flex w-14 flex-col items-end">
                <span className="text-sm font-semibold tabular-nums">{p.count.toLocaleString()}</span>
                {fromApp && p.leagues !== null && (
                  <span className="text-[10px] text-black/40 dark:text-white/40">
                    {p.leagues} {p.leagues === 1 ? "league" : "leagues"}
                  </span>
                )}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
