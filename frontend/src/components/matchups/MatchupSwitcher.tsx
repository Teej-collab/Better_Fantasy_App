"use client";

import type { WeekMatchupContextItem } from "@/lib/api";
import { TeamLogo } from "@/components/matchups/MatchupScoreHeader";

// Reference: real ESPN matchup screen, 2026-09 — a horizontal strip of
// every matchup in the week, the active one outlined and the rest
// collapsed to just their two logos and current score, so switching
// matchups is "scroll/tap along the top" rather than a separate page.
export function MatchupSwitcher({
  matchups,
  activeIndex,
  onSelect,
}: {
  matchups: WeekMatchupContextItem[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  if (matchups.length <= 1) return null;

  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {matchups.map((m, i) => {
        const active = i === activeIndex;
        return (
          <button
            key={m.matchup_id}
            type="button"
            onClick={() => onSelect(i)}
            aria-current={active}
            className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium tabular-nums transition-colors ${
              active
                ? "border-black/30 bg-black/5 dark:border-white/40 dark:bg-white/10"
                : "border-transparent bg-black/[0.03] text-black/60 hover:bg-black/5 dark:bg-white/[0.04] dark:text-white/60 dark:hover:bg-white/10"
            }`}
          >
            <TeamLogo side={m.home} size={20} />
            {active ? (
              <span className="text-black/40 dark:text-white/40">vs</span>
            ) : (
              <span>
                {(m.home.score ?? 0).toFixed(0)}-{(m.away.score ?? 0).toFixed(0)}
              </span>
            )}
            <TeamLogo side={m.away} size={20} />
          </button>
        );
      })}
    </div>
  );
}
