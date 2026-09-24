import Link from "next/link";
import type { MatchupContextSide } from "@/lib/api";
import { TeamRankBadge } from "@/components/TeamRankBadge";
import { LiveProjectionValue } from "@/components/matchups/liveProjection";

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

// 2026-09-18 redesign, real ask (reference: real ESPN matchup screen
// screenshot) — the logo moves back out of the centered top-of-block
// spot from the previous redesign, small now (32px, was 48) and
// pinned to each side's own OUTER edge: home's logo sits left of its
// score (screen's far left), away's sits right of its score (screen's
// far right, via flex-row-reverse) — "exponent" positioning, not
// centered above the name. Name/rank badge/season/projected all stay
// each on their own line underneath (2026-09-17's fix for long names
// truncating and Season/Proj cramming onto one line), just now aligned
// to each side's own outer edge (left for home, right for away)
// instead of centered, matching where the logo now sits.
function TeamScoreBlock({ side, align }: { side: MatchupContextSide; align: "left" | "right" }) {
  const isRight = align === "right";
  return (
    <div className={`flex min-w-0 flex-1 flex-col gap-1 ${isRight ? "items-end text-right" : "items-start text-left"}`}>
      <div className={`flex items-center gap-2 ${isRight ? "flex-row-reverse" : ""}`}>
        <TeamLogo side={side} size={32} />
        <span className="font-mono text-2xl font-semibold tabular-nums">
          {side.score !== null ? side.score.toFixed(1) : "0.0"}
        </span>
      </div>
      <span
        className={`flex min-w-0 max-w-full flex-wrap items-center gap-y-0.5 ${isRight ? "justify-end" : "justify-start"}`}
      >
        <Link
          href={`/teams/${side.team_id}`}
          className="line-clamp-2 min-w-0 text-sm leading-tight font-medium break-words hover:underline"
        >
          {side.team_name}
        </Link>
        <TeamRankBadge rank={side.power_rank} />
      </span>
      <span className={`flex flex-col leading-tight ${isRight ? "items-end" : "items-start"}`}>
        {side.season_points !== null && (
          <span className="text-xs tabular-nums text-black/40 dark:text-white/40">
            Season {side.season_points.toFixed(1)}
          </span>
        )}
        {side.projected_total !== null && (
          <span className="text-xs font-semibold tabular-nums text-black dark:text-white">
            Proj <LiveProjectionValue live={side.projected_total} pregame={side.pregame_projected_total} />
          </span>
        )}
      </span>
    </div>
  );
}

export function MatchupScoreHeader({ home, away }: { home: MatchupContextSide; away: MatchupContextSide }) {
  return (
    <div className="flex items-start gap-3">
      <TeamScoreBlock side={home} align="left" />
      <span className="mt-1.5 shrink-0 text-xs text-black/40 dark:text-white/40">VS</span>
      <TeamScoreBlock side={away} align="right" />
    </div>
  );
}
