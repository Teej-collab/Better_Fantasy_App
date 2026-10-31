import Link from "next/link";
import type { MatchupContextSide, WeekMatchupContextItem } from "@/lib/api";
import { TeamLogo } from "@/components/matchups/MatchupScoreHeader";
import { GameOfWeekBadge, HeadlineBadge, RivalryBadge } from "@/components/matchups/MatchupBadges";
import { PlayoffBadge } from "@/components/PlayoffBadge";
import { TeamRankBadge } from "@/components/TeamRankBadge";
import { LiveProjectionValue } from "@/components/matchups/liveProjection";
import { ANTON, ELITE, EliteCard, EliteWinBar } from "@/components/elite/Elite";

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
export function WeekScoreboardList({ matchups, myOwnerId = null }: { matchups: WeekMatchupContextItem[]; myOwnerId?: number | null }) {
  // Elite pass (2026-10-31): your own matchup pinned first and lit
  // orange, the leader's score lit green, and the win-chance bar once
  // the game has real scores.
  const isMine = (m: WeekMatchupContextItem) => myOwnerId !== null && (m.home.owner_id === myOwnerId || m.away.owner_id === myOwnerId);
  const ordered = [...matchups].sort((a, b) => Number(isMine(b)) - Number(isMine(a)));
  return (
    <div className="flex flex-col gap-3">
      {ordered.map((m) => {
        const mine = isMine(m);
        const homeMine = m.home.owner_id === myOwnerId;
        const awayMine = m.away.owner_id === myOwnerId;
        const odds = m.home.win_probability !== null && m.away.win_probability !== null;
        return (
          <EliteCard key={m.matchup_id} tone={mine ? "orange" : "plain"} className="overflow-hidden py-1">
            {(mine || m.headline || m.is_game_of_the_week || m.is_rivalry || m.is_playoff) && (
              <div className="flex flex-wrap items-center gap-1.5 px-3.5 pt-2">
                {mine && (
                  <span className="text-[11px] font-extrabold tracking-[2px]" style={{ color: ELITE.peach }}>
                    YOUR MATCHUP
                  </span>
                )}
                {m.headline && <HeadlineBadge headline={m.headline} />}
                {m.is_game_of_the_week && <GameOfWeekBadge />}
                {m.is_rivalry && m.rivalry && <RivalryBadge rivalry={m.rivalry} />}
                {m.is_playoff && <PlayoffBadge />}
              </div>
            )}
            <ScoreboardRow matchupId={m.matchup_id} side={m.home} opponent={m.away} />
            <ScoreboardRow matchupId={m.matchup_id} side={m.away} opponent={m.home} />
            {odds && (
              <div className="px-3.5 pb-2.5">
                <EliteWinBar
                  left={m.home.win_probability!}
                  right={m.away.win_probability!}
                  leftColor={homeMine ? ELITE.orange : ELITE.green}
                  rightColor={awayMine ? ELITE.orange : homeMine ? ELITE.green : ELITE.blue}
                  leftLabel={`${Math.round(m.home.win_probability!)}%${homeMine ? " to win" : ""}`}
                  rightLabel={`${Math.round(m.away.win_probability!)}%${awayMine ? " to win" : ""}`}
                />
              </div>
            )}
          </EliteCard>
        );
      })}
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
    <Link href={`/matchups/${matchupId}`} className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-white/[0.04]">
      <TeamLogo side={side} size={40} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={`min-w-0 wrap-break-word text-[15px] font-bold ${leading ? "" : "text-[#f5f4ec]/75"}`}>
          {side.team_name}
          {STREAK_ICON[side.streak] && <span className="ml-1">{STREAK_ICON[side.streak]}</span>}
          <TeamRankBadge rank={side.power_rank} />
        </span>
        <span className="min-w-0 wrap-break-word text-xs" style={{ color: ELITE.soft }}>
          {side.owner_name}
          {side.record && ` · ${side.record}`}
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-end leading-tight">
        <span
          className={`${ANTON} text-[26px] tracking-wide tabular-nums`}
          style={leading ? { color: ELITE.green, textShadow: "0 0 10px rgba(57,255,20,.6)" } : undefined}
        >
          {side.score !== null ? side.score.toFixed(1) : "—"}
        </span>
        {side.projected_total !== null && (
          <span className="text-[11px] tabular-nums" style={{ color: ELITE.soft }}>
            Proj <LiveProjectionValue live={side.projected_total} pregame={side.pregame_projected_total} />
          </span>
        )}
      </div>
    </Link>
  );
}
