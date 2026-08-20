"use client";

import { useState } from "react";
import type { MatchupContextSide, MatchupRivalry, WeekMatchupContextItem } from "@/lib/api";
import { RosterList } from "@/components/RosterList";
import { PlayoffBadge } from "@/components/PlayoffBadge";

const STREAK_ICON: Record<string, string> = { hot: " \u{1F525}", cold: " \u{1F976}", neutral: "" };

// Client component so expand/collapse is free, local UI state — every
// matchup's full context (rosters, head-to-head, streaks, etc.) is
// already fetched in one batched call by the server-rendered parent
// page, so opening a card never triggers a fetch.
export function MatchupCard({ matchup }: { matchup: WeekMatchupContextItem }) {
  const [open, setOpen] = useState(false);
  const { home, away } = matchup;

  return (
    <div className="rounded-lg border border-black/10 dark:border-white/10">
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

          <HeadToHeadSection matchup={matchup} />

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <RosterList title={home.team_name} players={home.roster} showProjected />
            <RosterList title={away.team_name} players={away.roster} showProjected />
          </div>
        </div>
      )}
    </div>
  );
}

function NarrativeSection({ narrative }: { narrative: string | null }) {
  return (
    <div className="rounded-md bg-black/[0.03] px-3 py-2 text-sm italic text-black/50 dark:bg-white/[0.03] dark:text-white/50">
      {narrative ?? "Recap & preview writeups aren't turned on yet — coming later."}
    </div>
  );
}

function TeamSummary({ side }: { side: MatchupContextSide }) {
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <a href={`/teams/${side.team_id}`} className="font-medium hover:underline">
        {side.team_name}
      </a>
      <a href={`/owners/${side.owner_id}`} className="text-black/50 hover:underline dark:text-white/50">
        {side.owner_name}
      </a>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-black/60 dark:text-white/60">
        {side.record && <span>{side.record}</span>}
        {side.streak !== "neutral" && (
          <span>{side.streak === "hot" ? "\u{1F525} Hot streak" : "\u{1F976} Cold streak"}</span>
        )}
        {side.projected_total !== null && <span>Proj {side.projected_total.toFixed(1)}</span>}
      </div>
    </div>
  );
}

function HeadToHeadSection({ matchup }: { matchup: WeekMatchupContextItem }) {
  const { head_to_head: h2h, home, away, rivalry } = matchup;
  const totalGames = h2h.wins_home + h2h.wins_away + h2h.ties;

  return (
    <div className="text-sm">
      <h3 className="mb-1 font-medium text-black/60 dark:text-white/60">All-time head-to-head</h3>
      {totalGames === 0 ? (
        <p className="text-black/50 dark:text-white/50">First meeting between these two.</p>
      ) : (
        <p>
          {home.team_name} {h2h.wins_home} – {h2h.wins_away} {away.team_name}
          {h2h.ties > 0 && ` (${h2h.ties} tie${h2h.ties > 1 ? "s" : ""})`}
          {h2h.last_season !== null && (
            <span className="text-black/50 dark:text-white/50">
              {" "}
              &middot; last met {h2h.last_season} Wk {h2h.last_week}
            </span>
          )}
        </p>
      )}
      {rivalry?.description && (
        <p className="mt-1 text-black/60 dark:text-white/60">
          {rivalry.tagline && <span className="italic">&ldquo;{rivalry.tagline}&rdquo; </span>}
          {rivalry.description}
        </p>
      )}
    </div>
  );
}

function GameOfWeekBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-400/20 dark:text-amber-300">
      {"⭐"} Game of the Week
    </span>
  );
}

function RivalryBadge({ rivalry }: { rivalry: MatchupRivalry }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 font-medium text-rose-800 dark:bg-rose-400/20 dark:text-rose-300">
      {rivalry.emoji ?? "\u{1F525}"} {rivalry.name}
    </span>
  );
}
