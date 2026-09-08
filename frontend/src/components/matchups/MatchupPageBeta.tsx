import type { MatchupContextSide, TeamTouchdown, WeekMatchupContextItem } from "@/lib/api";
import { PlayoffBadge } from "@/components/PlayoffBadge";
import { BenchCrimeBadge, ClutchChokeBadge, GameOfWeekBadge, RivalryBadge } from "@/components/matchups/MatchupBadges";
import { HeadToHeadSection } from "@/components/matchups/HeadToHeadSection";
import { WinProbabilityBar } from "@/components/matchups/WinProbabilityBar";
import { MatchupScoreHeader } from "@/components/matchups/MatchupScoreHeader";
import { StarterComparisonTable } from "@/components/matchups/StarterComparisonTable";
import { BackButton } from "@/components/BackButton";

/**
 * Settings > Labs > "Try the new look" render of the matchup detail
 * page — Documentation/UX/00_UX_Audit.md's Matchups finding: the score
 * header and win-probability bar already answer "am I winning, by how
 * much" in under two seconds, but "why" (the starter-by-starter
 * comparison) sat at the very bottom of the page, under a narrative
 * section that rendered a permanent "coming later" placeholder even
 * with nothing to say. This reorders the page so the lineup comparison
 * comes right after the score, and the narrative simply doesn't render
 * at all when there's no real write-up yet (Documentation/UX/
 * 01_Design_System.md section 16's EmptyState rule) instead of taking
 * prime real estate for a dead placeholder. Everything else keeps its
 * exact existing data/logic — only order and card treatment change.
 */
export function MatchupPageBeta({ matchup }: { matchup: WeekMatchupContextItem }) {
  const { home, away } = matchup;
  const hasWinProbability = home.win_probability !== null && away.win_probability !== null;
  const hasDetail = Boolean(home.clutch_choke || home.bench_crime || away.clutch_choke || away.bench_crime);
  const hasTouchdowns = home.touchdowns.length > 0 || away.touchdowns.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <BackButton fallbackHref={`/seasons/${matchup.season}/weeks/${matchup.week}`} label="Matchups" />

        {(matchup.is_game_of_the_week || matchup.is_rivalry || matchup.is_playoff) && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
            {matchup.is_game_of_the_week && <GameOfWeekBadge />}
            {matchup.is_rivalry && matchup.rivalry && <RivalryBadge rivalry={matchup.rivalry} />}
            {matchup.is_playoff && <PlayoffBadge />}
          </div>
        )}

        <h1 className="font-display text-2xl font-semibold tracking-wide uppercase">
          {matchup.season} — Week {matchup.week}
        </h1>

        <div className="mt-3">
          <MatchupScoreHeader home={home} away={away} />
        </div>

        {hasWinProbability && (
          <div className="mt-3">
            <WinProbabilityBar homeWinProbability={home.win_probability!} awayWinProbability={away.win_probability!} />
          </div>
        )}
      </div>

      {/* The "why" — moved from the bottom of the page to right after
          the score. This is the single biggest ordering fix from the
          audit. */}
      <div className="wl-card rounded-lg p-4">
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
          Starting Lineups
        </h2>
        <StarterComparisonTable home={home.roster} away={away.roster} />
      </div>

      {/* Only renders with a real write-up — no permanent "coming
          later" placeholder taking space when there's nothing to say. */}
      {matchup.narrative && (
        <div className="rounded-md bg-black/[0.03] px-3 py-2 text-sm italic text-black/50 dark:bg-white/[0.03] dark:text-white/50">
          {matchup.narrative}
        </div>
      )}

      {hasTouchdowns && (
        <div className="wl-card rounded-lg p-4">
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
            Touchdowns
          </h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <TouchdownList teamName={home.team_name} touchdowns={home.touchdowns} />
            <TouchdownList teamName={away.team_name} touchdowns={away.touchdowns} align="right" />
          </div>
        </div>
      )}

      {hasDetail && (
        <div className="wl-card grid grid-cols-1 gap-4 rounded-lg p-4 sm:grid-cols-2">
          <TeamDetailSummary side={home} />
          <TeamDetailSummary side={away} />
        </div>
      )}

      <div className="wl-card rounded-lg p-4">
        <HeadToHeadSection headToHead={matchup.head_to_head} home={home} away={away} />
      </div>
    </div>
  );
}

function TouchdownList({
  teamName,
  touchdowns,
  align = "left",
}: {
  teamName: string;
  touchdowns: TeamTouchdown[];
  align?: "left" | "right";
}) {
  return (
    <div className={`flex flex-col gap-1 ${align === "right" ? "items-end text-right" : "items-start text-left"}`}>
      <span className="text-xs text-black/50 dark:text-white/50">{teamName}</span>
      {touchdowns.length === 0 ? (
        <span className="text-black/40 dark:text-white/40">No touchdowns yet</span>
      ) : (
        touchdowns.map((td) => (
          <span key={td.player_name}>
            {"\u{1F3C8}"} {td.player_name}
            {td.touchdowns > 1 && ` ×${td.touchdowns}`}
          </span>
        ))
      )}
    </div>
  );
}

function TeamDetailSummary({ side }: { side: MatchupContextSide }) {
  if (!side.clutch_choke && !side.bench_crime) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
        {side.team_name}
      </span>
      <div className="flex flex-wrap gap-1.5 text-xs">
        {side.clutch_choke && <ClutchChokeBadge status={side.clutch_choke} />}
        {side.bench_crime && <BenchCrimeBadge crime={side.bench_crime} />}
      </div>
    </div>
  );
}
