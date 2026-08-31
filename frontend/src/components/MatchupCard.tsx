"use client";

import { useState } from "react";
import Link from "next/link";
import type { WeekMatchupContextItem } from "@/lib/api";
import { RosterList } from "@/components/RosterList";
import { PlayoffBadge } from "@/components/PlayoffBadge";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";
import { GameOfWeekBadge, RivalryBadge } from "@/components/matchups/MatchupBadges";
import { NarrativeSection } from "@/components/matchups/NarrativeSection";
import { TeamSummary } from "@/components/matchups/TeamSummary";
import { HeadToHeadSection } from "@/components/matchups/HeadToHeadSection";

const STREAK_ICON: Record<string, string> = { hot: " \u{1F525}", cold: " \u{1F976}", neutral: "" };

// Client component so expand/collapse is free, local UI state — every
// matchup's full context (rosters, head-to-head, streaks, etc.) is
// already fetched in one batched call by the server-rendered parent
// page, so opening a card never triggers a fetch. Every sub-section
// here (narrative, team summary, head-to-head, rosters) is a shared
// component under components/matchups/ — the full matchup detail page
// (/matchups/[matchupId]) renders the exact same pieces from the exact
// same data shape, so the two views can never quietly drift apart.
export function MatchupCard({ matchup }: { matchup: WeekMatchupContextItem }) {
  const [open, setOpen] = useState(false);
  const { home, away } = matchup;

  return (
    <div className="neon-panel rounded-lg" style={panelGlowStyle(SECTION_COLORS.matchups)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full flex-col gap-2 px-3 py-3 text-left"
      >
        {(matchup.is_game_of_the_week || matchup.is_rivalry || matchup.is_playoff) && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {matchup.is_game_of_the_week && <GameOfWeekBadge />}
            {matchup.is_rivalry && matchup.rivalry && <RivalryBadge rivalry={matchup.rivalry} />}
            {matchup.is_playoff && <PlayoffBadge />}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-2">
            <span className="truncate">
              {home.team_name}
              {STREAK_ICON[home.streak]}
            </span>
            <span className="text-xs text-black/40 sm:text-sm dark:text-white/40">vs</span>
            <span className="truncate">
              {away.team_name}
              {STREAK_ICON[away.streak]}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="font-mono tabular-nums text-black/70 dark:text-white/70">
              {home.score !== null ? home.score.toFixed(1) : "—"} –{" "}
              {away.score !== null ? away.score.toFixed(1) : "—"}
            </span>
            <span
              className={`text-black/40 transition-transform dark:text-white/40 ${open ? "rotate-180" : ""}`}
              aria-hidden
            >
              ▾
            </span>
          </span>
        </div>
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t border-black/10 px-3 py-4 dark:border-white/10">
          <NarrativeSection narrative={matchup.narrative} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TeamSummary side={home} />
            <TeamSummary side={away} />
          </div>

          <HeadToHeadSection headToHead={matchup.head_to_head} home={home} away={away} />

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <RosterList title={home.team_name} players={home.roster} showProjected />
            <RosterList title={away.team_name} players={away.roster} showProjected />
          </div>

          <Link
            href={`/matchups/${matchup.matchup_id}`}
            className="self-start text-sm font-medium text-black/60 hover:underline dark:text-white/60"
          >
            View full matchup →
          </Link>
        </div>
      )}
    </div>
  );
}
