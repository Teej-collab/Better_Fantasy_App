"use client";

import { useState } from "react";
import type { PlayerGameLog } from "@/lib/playerCardApi";

// The game log like ESPN's (2026-10), same as the app's
// (mobile/src/components/players/GameLogTable.tsx): pick a category, then
// a row per game — week, opponent and result, our fantasy points, and that
// category's box-score line, in the columns ESPN's own app shows.
const COLUMNS: Record<string, string[]> = {
  passing: ["CMP", "ATT", "YDS", "TD", "INT"],
  rushing: ["CAR", "YDS", "TD", "LNG"],
  receiving: ["REC", "TGTS", "YDS", "TD"],
  fumbles: ["FUM", "LST"],
  fieldgoals: ["FG", "LNG", "FG%"],
  pats: ["XP", "PTS"],
};

function columnsFor(category: PlayerGameLog["categories"][number]): number[] {
  const wanted = COLUMNS[category.key] ?? [];
  const picked = wanted.map((label) => category.labels.indexOf(label)).filter((i) => i >= 0);
  return picked.length ? picked : category.labels.slice(0, 4).map((_, i) => i);
}

export function GameLogTable({ log }: { log: PlayerGameLog }) {
  const [selected, setSelected] = useState(0);
  const category = log.categories[selected] ?? log.categories[0];
  if (!category) return null;
  const columns = columnsFor(category);

  return (
    <div className="flex flex-col gap-2">
      {log.categories.length > 1 && (
        <div className="flex gap-2" role="tablist">
          {log.categories.map((c, i) => {
            const on = c === category;
            return (
              <button
                key={c.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setSelected(i)}
                className={`flex-1 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  on
                    ? "border-[var(--wl-accent)] bg-black/10 dark:bg-white/10"
                    : "border-black/10 text-black/60 dark:border-white/10 dark:text-white/60"
                }`}
              >
                {c.title}
              </button>
            );
          })}
        </div>
      )}
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="text-[0.65rem] font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
            <th className="pb-2 text-left">Wk</th>
            <th className="pb-2 text-left">Opp</th>
            <th className="pb-2 text-right">FPTS</th>
            {columns.map((i) => (
              <th key={i} className="pb-2 text-right">
                {category.labels[i]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-black/5 dark:divide-white/5">
          {log.games.map((game) => (
            <tr key={game.week}>
              <td className="py-2 text-black/60 dark:text-white/60">{game.week}</td>
              <td className="py-2">
                <span className="block">{game.opponent ?? "—"}</span>
                {game.result && <span className="block text-[0.65rem] text-black/50 dark:text-white/50">{game.result}</span>}
              </td>
              <td className="py-2 text-right font-semibold">{game.fantasy_points != null ? game.fantasy_points.toFixed(1) : "–"}</td>
              {columns.map((i) => (
                <td key={i} className="py-2 text-right">
                  {game.stats[category.key]?.[i] ?? "–"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
