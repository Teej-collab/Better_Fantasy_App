import Link from "next/link";
import type { MatchupContextSide } from "@/lib/api";
import { TeamRankBadge } from "@/components/TeamRankBadge";
import { LiveProjectionValue } from "@/components/matchups/liveProjection";
import { WinProbabilityBar } from "@/components/matchups/WinProbabilityBar";

function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "").concat(parts[1]?.[0] ?? "").toUpperCase() || "?";
}

// A team's logo from a raw URL + name — shared by TeamLogo below and
// the homepage's Your Week card, which only has the flat YourWeek
// fields rather than a full MatchupContextSide.
export function LogoAvatar({
  logoUrl,
  name,
  size = 48,
  tone = "default",
}: {
  logoUrl: string | null;
  name: string;
  size?: number;
  tone?: "default" | "dark";
}) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a user-uploaded logo URL, not a static asset next/image can optimize.
      <img
        src={logoUrl}
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
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${
        tone === "dark" ? "bg-white/10 text-white/60" : "bg-black/10 text-black/60 dark:bg-white/10 dark:text-white/60"
      }`}
      style={{ width: size, height: size, fontSize: Math.max(12, Math.round(size / 3)) }}
      aria-hidden
    >
      {initialsFor(name)}
    </span>
  );
}

export function TeamLogo({ side, size = 48 }: { side: MatchupContextSide; size?: number }) {
  return <LogoAvatar logoUrl={side.logo_url} name={side.team_name} size={size} />;
}

// "2-0 (W2)" — the streak colored by result, ESPN-style.
export function RecordWithStreak({ record, streak }: { record: string | null; streak: string | null }) {
  if (!record) return null;
  const color = streak?.startsWith("W")
    ? "text-emerald-600 dark:text-emerald-400"
    : streak?.startsWith("L")
      ? "text-red-500 dark:text-red-400"
      : "";
  return (
    <span className="tabular-nums">
      {record}
      {streak && <span className={`ml-1 ${color}`}>({streak})</span>}
    </span>
  );
}

// 2026-09-25 redesign, real ask (reference: real ESPN matchup screen
// screenshot) — big logo pinned to each side's outer edge with a big
// score beside it and the live projection underneath, then the team
// name, then "owner • record (streak)" on its own line. Home/left sits
// on the left edge, away/right mirrors it on the right (via
// flex-row-reverse). Whichever side the viewer owns is always passed in
// as `home` (see orientMatchupForViewer).
function TeamScoreBlock({ side, align }: { side: MatchupContextSide; align: "left" | "right" }) {
  const isRight = align === "right";
  return (
    <div className={`flex min-w-0 flex-1 flex-col gap-1.5 ${isRight ? "items-end text-right" : "items-start text-left"}`}>
      <div className={`flex items-center gap-2 sm:gap-3 ${isRight ? "flex-row-reverse" : ""}`}>
        <TeamLogo side={side} size={56} />
        <div className={`flex flex-col leading-none ${isRight ? "items-end" : "items-start"}`}>
          <span className="font-mono text-3xl font-bold tabular-nums sm:text-4xl">
            {side.score !== null ? side.score.toFixed(1) : "0.0"}
          </span>
          {side.projected_total !== null && (
            <span className="mt-1 text-sm text-black/50 dark:text-white/50">
              <LiveProjectionValue live={side.projected_total} pregame={side.pregame_projected_total} />
            </span>
          )}
        </div>
      </div>
      <span
        className={`flex min-w-0 max-w-full flex-wrap items-center gap-y-0.5 ${isRight ? "justify-end" : "justify-start"}`}
      >
        <Link
          href={`/teams/${side.team_id}`}
          className="line-clamp-2 min-w-0 text-base leading-tight font-semibold break-words hover:underline sm:text-lg"
        >
          {side.team_name}
        </Link>
        <TeamRankBadge rank={side.power_rank} />
      </span>
      <span className="text-sm leading-tight text-black/50 dark:text-white/50">
        <Link href={`/owners/${side.owner_id}`} className="hover:underline">
          {side.owner_name}
        </Link>
        {side.record && (
          <>
            {" • "}
            <RecordWithStreak record={side.record} streak={side.result_streak} />
          </>
        )}
      </span>
      {side.season_points !== null && (
        <span className="text-xs tabular-nums text-black/40 dark:text-white/40">
          Season {side.season_points.toFixed(1)}
        </span>
      )}
    </div>
  );
}

export function MatchupScoreHeader({ home, away }: { home: MatchupContextSide; away: MatchupContextSide }) {
  const hasWinProbability = home.win_probability !== null && away.win_probability !== null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <TeamScoreBlock side={home} align="left" />
        <TeamScoreBlock side={away} align="right" />
      </div>
      {hasWinProbability && (
        <WinProbabilityBar
          leftWinProbability={home.win_probability!}
          rightWinProbability={away.win_probability!}
          label="Win Probability"
        />
      )}
    </div>
  );
}
