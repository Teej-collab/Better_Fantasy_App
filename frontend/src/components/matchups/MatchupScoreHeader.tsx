import Link from "next/link";
import type { MatchupContextSide } from "@/lib/api";

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

// Team logo, live score, and both real totals beneath it — this
// week's starters-only projection (projected_total) and the real
// season-to-date total (season_points, standings' own points_for) —
// for one side of the matchup header.
function TeamScoreBlock({ side, align }: { side: MatchupContextSide; align: "left" | "right" }) {
  return (
    <div className={`flex min-w-0 flex-1 items-center gap-3 ${align === "right" ? "flex-row-reverse text-right" : "text-left"}`}>
      <TeamLogo side={side} />
      <div className="flex min-w-0 flex-col">
        <Link href={`/teams/${side.team_id}`} className="truncate text-sm font-medium hover:underline">
          {side.team_name}
        </Link>
        <span className="font-mono text-2xl font-semibold tabular-nums">
          {side.score !== null ? side.score.toFixed(1) : "0.0"}
        </span>
        <span className="text-xs text-black/50 tabular-nums dark:text-white/50">
          {side.season_points !== null && `Season ${side.season_points.toFixed(1)}`}
          {side.season_points !== null && side.projected_total !== null && " · "}
          {side.projected_total !== null && `Proj ${side.projected_total.toFixed(1)}`}
        </span>
      </div>
    </div>
  );
}

export function MatchupScoreHeader({ home, away }: { home: MatchupContextSide; away: MatchupContextSide }) {
  return (
    <div className="flex items-center gap-3">
      <TeamScoreBlock side={home} align="left" />
      <span className="shrink-0 text-xs text-black/40 dark:text-white/40">VS</span>
      <TeamScoreBlock side={away} align="right" />
    </div>
  );
}
