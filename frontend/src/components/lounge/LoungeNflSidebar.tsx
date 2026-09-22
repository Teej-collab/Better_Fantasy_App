"use client";

import { useEffect, useState } from "react";
import { getNflScoreboard, type NflGame } from "@/lib/api";
import { nflTeamColor } from "@/lib/nfl-teams";

function statusLabel(game: NflGame): string {
  if (game.state === "post") return game.status_detail?.toUpperCase().includes("OT") ? "FINAL/OT" : "FINAL";
  if (game.state === "in") return game.status_detail ?? "LIVE";
  return game.status_detail ?? "UPCOMING";
}

/**
 * Full scrollable scoreboard for the Lounge's side panel — distinct
 * from the app-wide horizontal LiveTicker (AppTickerBar.tsx), which
 * doesn't fit this room's vertical sidebar layout. Same public,
 * no-auth getNflScoreboard() call every other ticker already uses.
 */
export function LoungeNflSidebar() {
  const [games, setGames] = useState<NflGame[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getNflScoreboard()
      .then((g) => {
        if (!cancelled) setGames(g);
      })
      .catch(() => {
        if (!cancelled) setGames([]);
      });
    const interval = setInterval(() => {
      getNflScoreboard()
        .then((g) => {
          if (!cancelled) setGames(g);
        })
        .catch(() => {});
    }, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 px-3 py-2.5 text-xs font-bold tracking-wide text-white/70 uppercase">NFL Scores</div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {games === null && <p className="px-2 text-xs text-white/40">Loading…</p>}
        {games?.length === 0 && <p className="px-2 text-xs text-white/40">No games right now.</p>}
        {games
          ?.filter((g) => g.home_team && g.away_team)
          .map((g) => (
            <div key={g.id} className="mb-2 rounded-lg bg-white/5 px-3 py-2">
              <div className="mb-1 text-[10px] font-semibold tracking-wide text-white/40 uppercase">
                {statusLabel(g)}
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium" style={{ color: nflTeamColor(g.away_team!) ?? undefined }}>
                  {g.away_team}
                </span>
                <span className="font-mono text-white/90">{g.away_score ?? "-"}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium" style={{ color: nflTeamColor(g.home_team!) ?? undefined }}>
                  {g.home_team}
                </span>
                <span className="font-mono text-white/90">{g.home_score ?? "-"}</span>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
