import Image from "next/image";
import Link from "next/link";
import type { YourWeek } from "@/lib/api";
import { TeamRankBadge } from "@/components/TeamRankBadge";
import {
  LogoAvatar,
  RecordWithStreak,
} from "@/components/matchups/MatchupScoreHeader";
import { WinProbabilityBar } from "@/components/matchups/WinProbabilityBar";

/**
 * The homepage's "Your Week" hero (2026-09-25 redesign, reference: the
 * ESPN app's league card) — league header with a week pill, both teams'
 * logos and big scores with live projections under them, the split
 * win-probability bar, then each team's name, "owner • record
 * (streak)", and how many starters are yet to play / in play. The
 * viewer's own team is always on the left.
 *
 * Shared by the legacy homepage and HomePageBeta — `surfaceClass` is
 * the only thing that differs between the two (their card chrome).
 */
export function YourWeekCard({
  myWeek,
  isGameDay,
  leagueName,
  surfaceClass,
  showLineupLink = false,
}: {
  myWeek: YourWeek;
  isGameDay: boolean;
  leagueName: string | null;
  surfaceClass: string;
  showLineupLink?: boolean;
}) {
  const m = myWeek.matchup!;
  const isLive = m.started && isGameDay;
  const winning =
    m.my_score !== null &&
    m.opponent_score !== null &&
    m.my_score >= m.opponent_score;

  return (
    <section
      className={`flex flex-col gap-4 rounded-xl p-4 text-white ${surfaceClass}`}
    >
      <div className="flex items-center gap-3">
        <Image
          src="/images/weekend-league-emblem.png"
          alt=""
          width={36}
          height={36}
          className="shrink-0"
        />
        <span className="font-display min-w-0 flex-1 truncate text-lg font-bold tracking-wide uppercase">
          {leagueName ?? "Your Week"}
        </span>
        {isLive && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-bold text-red-400 uppercase">
            <span className="live-dot" aria-hidden />
            Live
          </span>
        )}
        {myWeek.week !== null && (
          <span className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-white/70">
            {m.is_playoff ? "Playoffs · " : ""}Week {myWeek.week}
          </span>
        )}
      </div>

      <Link href={`/matchups/${m.matchup_id}`} className="flex flex-col gap-4">
        <div className="border-t border-dotted border-white/20" />

        <div className="flex items-center justify-between gap-3">
          <ScoreBlock
            name={myWeek.team_name}
            logoUrl={m.my_logo_url}
            score={m.my_score}
            projected={m.my_projected_total}
            lead={winning}
          />
          <ScoreBlock
            name={m.opponent_team_name}
            logoUrl={m.opponent_logo_url}
            score={m.opponent_score}
            projected={m.opponent_projected_total}
            lead={!winning}
            align="right"
          />
        </div>

        {m.win_probability !== null && (
          <WinProbabilityBar
            leftWinProbability={m.win_probability}
            rightWinProbability={
              Math.round((100 - m.win_probability) * 10) / 10
            }
            tone="dark"
          />
        )}

        <div className="border-t border-dotted border-white/20" />

        <div className="flex items-start justify-between gap-3">
          <TeamInfo
            name={myWeek.team_name}
            powerRank={myWeek.power_rank}
            ownerName={m.my_owner_name}
            record={m.record}
            streak={m.my_result_streak}
            yetToPlay={m.my_yet_to_play}
            inPlay={m.my_in_play}
          />
          <TeamInfo
            name={m.opponent_team_name}
            powerRank={m.opponent_power_rank}
            ownerName={m.opponent_owner_name}
            record={m.opponent_record}
            streak={m.opponent_result_streak}
            yetToPlay={m.opponent_yet_to_play}
            inPlay={m.opponent_in_play}
            align="right"
          />
        </div>
      </Link>

      <div className="flex items-center gap-4">
        <Link
          href={`/matchups/${m.matchup_id}`}
          className="text-sm text-[var(--wl-accent)] hover:underline"
        >
          View full matchup →
        </Link>
        {showLineupLink && (
          <Link href="/team" className="text-sm text-white/50 hover:underline">
            My lineup →
          </Link>
        )}
      </div>
    </section>
  );
}

function ScoreBlock({
  name,
  logoUrl,
  score,
  projected,
  lead,
  align = "left",
}: {
  name: string;
  logoUrl: string | null;
  score: number | null;
  projected: number;
  lead: boolean;
  align?: "left" | "right";
}) {
  const isRight = align === "right";
  return (
    <div
      className={`flex min-w-0 items-center gap-2 sm:gap-3 ${
        isRight ? "flex-row-reverse" : ""
      }`}
    >
      <LogoAvatar logoUrl={logoUrl} name={name} size={56} tone="dark" />
      <div
        className={`flex flex-col leading-none ${
          isRight ? "items-end" : "items-start"
        }`}
      >
        <span
          className={`score-pop font-mono text-3xl font-bold tabular-nums sm:text-4xl ${
            lead ? "text-white" : "text-white/70"
          }`}
        >
          {score !== null ? score.toFixed(1) : "0.0"}
        </span>
        <span className="mt-1 text-sm text-white/50 tabular-nums">
          {projected.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

function TeamInfo({
  name,
  powerRank,
  ownerName,
  record,
  streak,
  yetToPlay,
  inPlay,
  align = "left",
}: {
  name: string;
  powerRank: number | null;
  ownerName: string | null;
  record: string | null;
  streak: string | null;
  yetToPlay: number;
  inPlay: number;
  align?: "left" | "right";
}) {
  const isRight = align === "right";
  return (
    <div
      className={`flex min-w-0 flex-1 flex-col gap-0.5 ${
        isRight ? "items-end text-right" : "items-start"
      }`}
    >
      <span className="line-clamp-2 text-base leading-tight font-semibold break-words text-white/80">
        {name}
        <TeamRankBadge rank={powerRank} variant="dark" />
      </span>
      <span className="text-sm text-white/50">
        {ownerName}
        {ownerName && record && " • "}
        <RecordWithStreak record={record} streak={streak} />
      </span>
      {/* Guarded so a frontend deployed ahead of the backend that
          adds these counts doesn't render empty "()" */}
      {typeof yetToPlay === "number" && (
        <span className="text-sm text-white/50">
          Yet to Play{" "}
          <span className="font-semibold text-white/70">({yetToPlay})</span> |
          In Play{" "}
          <span className="font-semibold text-white/70">({inPlay})</span>
        </span>
      )}
    </div>
  );
}
