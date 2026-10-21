"use client";

import { useEffect, useState } from "react";
import { usePlayerCard } from "@/components/players/PlayerCardProvider";
import { getBoxScore, getFantasyImpact, type GamecastBoxScore, type LiveGame } from "@/lib/gamecastApi";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";
import { useOnAppRefresh } from "@/lib/usePullToRefresh";

const MINE = "#22c55e";
const OPPONENT = "#60a5fa";

/**
 * The full box score, like ESPN's — the app's components/gamecast/
 * BoxScore.tsx on the web (2026-10). Pick a team, then every category's
 * table, every column ESPN gives (the app trims to a phone's width). A
 * bar marks your players (green) and your opponent's (blue), from the
 * same fantasy-impact data as the Fantasy Impact panel; a name opens the
 * player's card.
 */
export function BoxScore({ game, beta = false }: { game: LiveGame; beta?: boolean }) {
  const [box, setBox] = useState<GamecastBoxScore | null>(null);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [theirs, setTheirs] = useState<Set<string>>(new Set());
  const [teamIndex, setTeamIndex] = useState<number | null>(null);
  const { openPlayerCard } = usePlayerCard();

  function load() {
    getBoxScore(game.game_id).then((b) => b && setBox(b));
    getFantasyImpact(game.game_id).then((impact) => {
      if (!impact) return;
      setMine(new Set(impact.your_players.map((p) => p.player_id).filter((id): id is string => !!id)));
      setTheirs(new Set(impact.opponent_players.map((p) => p.player_id).filter((id): id is string => !!id)));
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.game_id, game.status]);
  // Live refreshes ride GameDayRefresher's app-refresh tick, same as FantasyImpact.
  useOnAppRefresh(load);

  if (!box || box.teams.length === 0 || box.teams.every((t) => t.categories.length === 0)) return null;

  // Opens on the team with your players in it, else the away team.
  const withMine = box.teams.findIndex((t) => t.categories.some((c) => c.athletes.some((a) => a.player_id && mine.has(a.player_id))));
  const shown = box.teams[teamIndex ?? Math.max(0, withMine)] ?? box.teams[0];

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl p-4 sm:p-5 ${beta ? "wl-card" : "neon-panel"}`}
      style={beta ? undefined : panelGlowStyle(SECTION_COLORS.gamecast)}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Box Score</h2>
        {(mine.size > 0 || theirs.size > 0) && (
          <span className="flex items-center gap-1.5 text-[11px] text-black/50 dark:text-white/50">
            <span className="h-3 w-[3px] rounded-full" style={{ backgroundColor: MINE }} /> Yours
            <span className="ml-1.5 h-3 w-[3px] rounded-full" style={{ backgroundColor: OPPONENT }} /> Opponent
          </span>
        )}
      </div>
      <div className="flex gap-2" role="tablist">
        {box.teams.map((t, i) => {
          const on = t === shown;
          return (
            <button
              key={t.abbr}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTeamIndex(i)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-sm font-bold ${
                on ? "border-black/30 bg-black/5 dark:border-white/30 dark:bg-white/10" : "border-black/10 text-black/50 dark:border-white/10 dark:text-white/50"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {t.logo && <img src={t.logo} alt="" className="h-5 w-5 object-contain" />}
              {t.abbr}
            </button>
          );
        })}
      </div>
      {shown.categories.map((category) => (
        <div key={category.key} className="flex flex-col gap-1">
          <h3 className="text-[13px] font-extrabold tracking-wide uppercase">{category.title}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="border-b border-black/10 text-[11px] text-black/50 dark:border-white/10 dark:text-white/50">
                  <th className="py-1 pl-2.5 text-left font-bold">PLAYER</th>
                  {category.labels.map((label, i) => (
                    <th key={i} className="px-1.5 py-1 text-right font-bold whitespace-nowrap">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {category.athletes.map((a, row) => {
                  const bar = a.player_id && mine.has(a.player_id) ? MINE : a.player_id && theirs.has(a.player_id) ? OPPONENT : "transparent";
                  return (
                    <tr key={a.espn_id ?? row} className={row % 2 === 0 ? "bg-black/[0.02] dark:bg-white/[0.03]" : ""}>
                      <td className="py-1.5 pr-2 whitespace-nowrap" style={{ boxShadow: `inset 3px 0 0 ${bar}` }}>
                        <span className="pl-2.5">
                          {a.player_id ? (
                            <button type="button" onClick={() => openPlayerCard(a.player_id!)} className="font-semibold hover:underline">
                              {a.short_name ?? a.name ?? "—"}
                            </button>
                          ) : (
                            <span className="font-semibold">{a.short_name ?? a.name ?? "—"}</span>
                          )}
                          {a.position && <span className="ml-1 text-[11px] text-black/50 dark:text-white/50">{a.position}</span>}
                        </span>
                      </td>
                      {category.labels.map((_, i) => (
                        <td key={i} className="px-1.5 py-1.5 text-right whitespace-nowrap">
                          {a.stats[i] ?? "–"}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {category.totals.length > 0 && (
                  <tr className="border-t border-black/10 text-xs font-bold text-black/50 dark:border-white/10 dark:text-white/50">
                    <td className="py-1.5 pl-2.5">TEAM</td>
                    {category.labels.map((_, i) => (
                      <td key={i} className="px-1.5 py-1.5 text-right whitespace-nowrap">
                        {category.totals[i] || ""}
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
