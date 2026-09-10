import Link from "next/link";
import type { MatchupContextSide, WeekMatchupContextItem } from "@/lib/api";
import { TeamLogo } from "@/components/matchups/MatchupScoreHeader";
import { GameOfWeekBadge, RivalryBadge } from "@/components/matchups/MatchupBadges";
import { PlayoffBadge } from "@/components/PlayoffBadge";

const STREAK_ICON: Record<string, string> = { hot: "\u{1F525}", cold: "\u{1F976}", neutral: "" };

/**
 * Flat, compact scoreboard — reference: real ESPN "League Scores"
 * sheet, 2026-09 ask ("ours look chunky", comparing against the
 * per-matchup neon-panel accordion this replaces). This app's default
 * matchups-page render as of 2026-09-10 (previously Labs-gated; the
 * old accordion had no remaining callers once this was promoted, see
 * MatchupCard.tsx's own remaining usage on the homepage only). One row
 * per TEAM (not one block per matchup), grouped in
 * pairs by a matchup, each row linking straight to the full matchup
 * page instead of expanding inline — the detail that used to live
 * inside the accordion (narrative, head-to-head, full rosters) already
 * has a real home there, so a flat list reads far less busy without
 * actually losing anything.
 *
 * 2026-09-10 fix, real report: the first version put every team row
 * from every matchup in one continuous divided list — the divider
 * between two teams IN a matchup and the divider between two different
 * MATCHUPS looked identical, so the whole week read as one undifferen-
 * tiated column of teams with no visible sense of who's actually
 * playing whom. Each matchup is now its own bounded card with real
 * gaps between cards — the card boundary itself is what says "these
 * two teams play each other," not a shared divider line doing double
 * duty.
 *
 * Deliberately doesn't attempt ESPN's own "In Play / To Play / Mins"
 * line or a live trend arrow — both need real per-play, tick-over-tick
 * data (a stored previous score to compare against, live play-by-play
 * attribution) this app doesn't track yet. Showing a fabricated trend
 * arrow would be worse than not having one.
 */
export function WeekScoreboardList({ matchups }: { matchups: WeekMatchupContextItem[] }) {
  return (
    <div className="flex flex-col gap-3">
      {matchups.map((m) => (
        <div key={m.matchup_id} className="wl-card overflow-hidden rounded-lg">
          {(m.is_game_of_the_week || m.is_rivalry || m.is_playoff) && (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-black/5 px-3 py-2 dark:border-white/5">
              {m.is_game_of_the_week && <GameOfWeekBadge />}
              {m.is_rivalry && m.rivalry && <RivalryBadge rivalry={m.rivalry} />}
              {m.is_playoff && <PlayoffBadge />}
            </div>
          )}
          <ScoreboardRow matchupId={m.matchup_id} side={m.home} opponent={m.away} />
          <div className="flex items-center gap-3 px-3">
            <div className="w-9 shrink-0" aria-hidden />
            <div className="flex-1 border-t border-black/10 dark:border-white/10" />
            <span className="shrink-0 text-[10px] font-semibold tracking-wide text-black/30 dark:text-white/30">VS</span>
            <div className="flex-1 border-t border-black/10 dark:border-white/10" />
            <div className="w-[3.5rem] shrink-0" aria-hidden />
          </div>
          <ScoreboardRow matchupId={m.matchup_id} side={m.away} opponent={m.home} />
        </div>
      ))}
    </div>
  );
}

function ScoreboardRow({
  matchupId,
  side,
  opponent,
}: {
  matchupId: number;
  side: MatchupContextSide;
  opponent: MatchupContextSide;
}) {
  // "Winning right now" — only a meaningful signal once both sides
  // have a real score to compare, same started/no-fake-50-50 gate
  // win_probability already uses elsewhere on this page's data.
  const leading = side.score !== null && opponent.score !== null && side.score > opponent.score;

  return (
    <Link
      href={`/matchups/${matchupId}`}
      className="flex items-center gap-3 px-3 py-3 hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
    >
      <TeamLogo side={side} size={36} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate text-sm ${leading ? "font-semibold" : "font-medium text-black/70 dark:text-white/70"}`}>
          {side.team_name}
          {STREAK_ICON[side.streak] && <span className="ml-1">{STREAK_ICON[side.streak]}</span>}
        </span>
        <span className="truncate text-xs text-black/50 dark:text-white/50">
          {side.owner_name}
          {side.record && ` · ${side.record}`}
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-end leading-tight">
        <span className={`font-mono text-lg tabular-nums ${leading ? "font-bold" : "font-semibold text-black/70 dark:text-white/70"}`}>
          {side.score !== null ? side.score.toFixed(1) : "—"}
        </span>
        {side.projected_total !== null && (
          <span className="text-[11px] tabular-nums text-black/40 dark:text-white/40">
            Proj {side.projected_total.toFixed(1)}
          </span>
        )}
      </div>
    </Link>
  );
}
