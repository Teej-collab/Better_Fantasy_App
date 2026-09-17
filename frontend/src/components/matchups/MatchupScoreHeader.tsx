import Link from "next/link";
import type { MatchupContextSide } from "@/lib/api";
import { TeamRankBadge } from "@/components/TeamRankBadge";

function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "").concat(parts[1]?.[0] ?? "").toUpperCase() || "?";
}

export function TeamLogo({ side, size = 48 }: { side: MatchupContextSide; size?: number }) {
  if (side.logo_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a user-uploaded logo URL, not a static asset next/image can optimize.
      <img
        src={side.logo_url}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-black/10 text-sm font-semibold text-black/60 dark:bg-white/10 dark:text-white/60"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {initialsFor(side.team_name)}
    </span>
  );
}

// Logo on top, team name (with its power-rank badge) underneath, then
// the live score, then season-to-date/projected totals each on their
// own line — 2026-09-17 redesign, real ask: the old side-by-side logo
// + name row left too little width for a real team name once the
// score/season-proj text crowded in next to it, so a longer name
// either truncated hard or wrapped mid-phrase with "Season X · Proj Y"
// awkwardly breaking across two lines. Stacking vertically gives the
// name the block's full width to wrap across up to two lines instead
// of truncating, and separates season/projected onto their own lines
// (season muted, projected full-strength — the "what actually
// happened this season" vs. "what's about to happen this week"
// distinction now reads as a real visual hierarchy, not just two
// numbers mashed together with a middot).
function TeamScoreBlock({ side }: { side: MatchupContextSide }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center">
      <TeamLogo side={side} />
      <span className="flex min-w-0 max-w-full flex-wrap items-center justify-center gap-y-0.5">
        <Link
          href={`/teams/${side.team_id}`}
          className="line-clamp-2 min-w-0 text-sm leading-tight font-medium break-words hover:underline"
        >
          {side.team_name}
        </Link>
        <TeamRankBadge rank={side.power_rank} />
      </span>
      <span className="font-mono text-2xl font-semibold tabular-nums">
        {side.score !== null ? side.score.toFixed(1) : "0.0"}
      </span>
      <span className="flex flex-col items-center leading-tight">
        {side.season_points !== null && (
          <span className="text-xs tabular-nums text-black/40 dark:text-white/40">
            Season {side.season_points.toFixed(1)}
          </span>
        )}
        {side.projected_total !== null && (
          <span className="text-xs font-semibold tabular-nums text-black dark:text-white">
            Proj {side.projected_total.toFixed(1)}
          </span>
        )}
      </span>
    </div>
  );
}

export function MatchupScoreHeader({ home, away }: { home: MatchupContextSide; away: MatchupContextSide }) {
  return (
    <div className="flex items-center gap-3">
      <TeamScoreBlock side={home} />
      <span className="shrink-0 text-xs text-black/40 dark:text-white/40">VS</span>
      <TeamScoreBlock side={away} />
    </div>
  );
}
