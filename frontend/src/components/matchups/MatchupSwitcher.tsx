"use client";

import type { WeekMatchupContextItem } from "@/lib/api";
import { LogoAvatar } from "@/components/matchups/MatchupScoreHeader";

// Reference: real ESPN matchup screen, 2026-09 — a horizontal strip of
// every matchup in the week, the active one outlined and the rest
// collapsed to just their two logos and current score, so switching
// matchups is "scroll/tap along the top" rather than a separate page.
// Each side shows the owner's uploaded logo, or the OWNER's initials
// when there isn't one (not the team name's, which rarely says who it
// is at a glance).
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

  // Elite pass (2026-10-31): each matchup a mini scoreboard, the one on
  // screen outlined orange.
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
            aria-label={`${m.home.team_name} ${(m.home.score ?? 0).toFixed(1)}, ${m.away.team_name} ${(m.away.score ?? 0).toFixed(1)}`}
            className={`flex w-36 shrink-0 flex-col gap-0.5 rounded-xl border bg-[#141a22] px-2.5 py-2 text-left text-[11.5px] font-bold text-[#f5f4ec] tabular-nums transition-colors ${
              active ? "border-[#ff7a1a] shadow-[0_0_12px_rgba(255,122,26,.35)]" : "border-white/[0.08] hover:border-white/20"
            }`}
          >
            {[m.home, m.away].map((side) => (
              <span key={side.team_id} className="flex justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <LogoAvatar logoUrl={side.logo_url} name={side.owner_name} size={16} tone="dark" />
                  <span className="truncate">{side.team_name}</span>
                </span>
                <span>{(side.score ?? 0).toFixed(1)}</span>
              </span>
            ))}
          </button>
        );
      })}
    </div>
  );
}
