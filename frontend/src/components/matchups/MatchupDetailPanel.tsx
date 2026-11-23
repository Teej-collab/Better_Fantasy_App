import Link from "next/link";
import type { MatchupContextSide, TeamTouchdown, WeekMatchupContextItem } from "@/lib/api";
import { PlayoffBadge } from "@/components/PlayoffBadge";
import { BenchCrimeBadge, ClutchChokeBadge, GameOfWeekBadge, HeadlineBadge, RivalryBadge } from "@/components/matchups/MatchupBadges";
import { LogoAvatar, RecordWithStreak } from "@/components/matchups/MatchupScoreHeader";
import { MatchupWriteUps } from "@/components/matchups/MatchupWriteUps";
import { StarterComparisonTable } from "@/components/matchups/StarterComparisonTable";
import { LiveProjectionValue } from "@/components/matchups/liveProjection";
import { ANTON, ELITE, EliteCard, EliteLabel, EliteWinBar, HEX_CLIP, Hex, SATISFY } from "@/components/elite/Elite";

/**
 * One matchup's full detail — score header, win probability, lineup
 * comparison (starters + bench), touchdowns, and head-to-head history.
 * Extracted out of what used to be the whole matchup page (MatchupPageBeta)
 * so MatchupCarousel.tsx can render one of these per matchup in the
 * week, swiped between instead of navigated between — the page-level
 * chrome (BackButton, the week plate) stays at the page level since
 * it's identical for every matchup in the same week.
 *
 * Elite pass (2026-10-31, mockup A "Jumbotron"): the score is a marquee
 * plate, the lineups duel across a slot cell lit for whoever's winning
 * it, and the series is a row of W/L cells. The viewer's own team is
 * always `home` (orientMatchupForViewer), so left is orange.
 */
export function MatchupDetailPanel({ matchup, myOwnerId = null }: { matchup: WeekMatchupContextItem; myOwnerId?: number | null }) {
  const { home, away } = matchup;
  const hasDetail = Boolean(home.clutch_choke || home.bench_crime || away.clutch_choke || away.bench_crime);
  const hasTouchdowns = home.touchdowns.length > 0 || away.touchdowns.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <Jumbotron matchup={matchup} myOwnerId={myOwnerId} />

      <MatchupWriteUps narrative={matchup.narrative} preview={matchup.preview} week={matchup.week} elite />

      <EliteCard className="px-3.5 pt-3.5 pb-1">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <EliteLabel>Head to Head</EliteLabel>
          <span className="text-xs" style={{ color: ELITE.soft }}>
            Tap points for the breakdown
          </span>
        </div>
        <StarterComparisonTable home={home.roster} away={away.roster} season={matchup.season} week={matchup.week} />
      </EliteCard>

      {hasTouchdowns && (
        <EliteCard className="flex flex-col gap-3 p-4">
          <EliteLabel>Touchdowns</EliteLabel>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <TouchdownList teamName={home.team_name} touchdowns={home.touchdowns} color={ELITE.orange} />
            <TouchdownList teamName={away.team_name} touchdowns={away.touchdowns} color={ELITE.green} align="right" />
          </div>
        </EliteCard>
      )}

      {hasDetail && (
        <EliteCard className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
          <TeamDetailSummary side={home} />
          <TeamDetailSummary side={away} />
        </EliteCard>
      )}

      <Series matchup={matchup} />
    </div>
  );
}

function Jumbotron({ matchup, myOwnerId }: { matchup: WeekMatchupContextItem; myOwnerId: number | null }) {
  const { home, away } = matchup;
  const homeMine = home.owner_id === myOwnerId;
  const awayMine = away.owner_id === myOwnerId;
  const odds = home.win_probability !== null && away.win_probability !== null;
  return (
    <EliteCard tone="orange" className="relative flex flex-col gap-4 p-4 pt-5" style={{ background: "radial-gradient(80% 60% at 50% 0%, rgba(255,122,26,.12), transparent 70%), #07090c" }}>
      <i aria-hidden className="elite-bulbs pointer-events-none absolute inset-1.5 rounded-[18px] border-2 border-dotted" />
      {(matchup.headline || matchup.is_game_of_the_week || matchup.is_rivalry || matchup.is_playoff) && (
        <div className="relative flex flex-wrap items-center justify-center gap-1.5 text-xs">
          {matchup.headline && <HeadlineBadge headline={matchup.headline} />}
          {matchup.is_game_of_the_week && <GameOfWeekBadge />}
          {matchup.is_rivalry && matchup.rivalry && <RivalryBadge rivalry={matchup.rivalry} />}
          {matchup.is_playoff && <PlayoffBadge />}
        </div>
      )}
      <div className="relative grid grid-cols-[1fr_auto_1fr] items-start gap-1.5">
        <TeamBlock side={home} week={matchup.week} ring={homeMine ? ELITE.orange : ELITE.grey} />
        <span className={`${SATISFY} pt-6 text-2xl`} style={{ color: ELITE.peach }}>
          vs
        </span>
        <TeamBlock side={away} week={matchup.week} ring={awayMine ? ELITE.orange : ELITE.grey} />
      </div>
      <div className="relative grid grid-cols-2 gap-2.5 text-center">
        <ScoreTile side={home} opponent={away} mine={homeMine} />
        <ScoreTile side={away} opponent={home} mine={awayMine} />
      </div>
      {odds && (
        <div className="relative">
          <EliteWinBar
            left={home.win_probability!}
            right={away.win_probability!}
            leftColor={homeMine || !awayMine ? ELITE.orange : ELITE.green}
            rightColor={awayMine ? ELITE.orange : ELITE.green}
            leftLabel={`${Math.round(home.win_probability!)}% TO WIN`}
            rightLabel={`${Math.round(away.win_probability!)}%`}
          />
        </div>
      )}
      {(home.season_points !== null || away.season_points !== null) && (
        <div className="relative flex justify-between text-xs tabular-nums" style={{ color: ELITE.soft }}>
          <span>{home.season_points !== null && `Season ${home.season_points.toFixed(1)} pts`}</span>
          <span>{away.season_points !== null && `Season ${away.season_points.toFixed(1)} pts`}</span>
        </div>
      )}
    </EliteCard>
  );
}

// The logo and name open that team's roster on this matchup's week
// (2026-10, like ESPN's team sheet).
function TeamBlock({ side, week, ring }: { side: MatchupContextSide; week: number; ring: string }) {
  const teamHref = `/teams/${side.team_id}?week=${week}`;
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5 text-center">
      <Link href={teamHref} aria-label={`${side.team_name} roster`} className="hover:opacity-85">
        <Hex size={66} color={ring} glow={ring === ELITE.orange}>
          <LogoAvatar logoUrl={side.logo_url} name={side.owner_name ?? side.team_name} size={46} tone="dark" />
        </Hex>
      </Link>
      <Link href={teamHref} className="line-clamp-2 text-[15px] leading-tight font-extrabold break-words hover:underline">
        {side.team_name}
      </Link>
      <span className="text-xs leading-tight" style={{ color: ELITE.soft }}>
        <Link href={`/owners/${side.owner_id}`} className="hover:underline">
          {side.owner_name}
        </Link>
        {side.record && (
          <>
            {" · "}
            <RecordWithStreak record={side.record} streak={side.result_streak} />
          </>
        )}
        {side.power_rank ? ` · #${side.power_rank}` : ""}
      </span>
    </div>
  );
}

function ScoreTile({ side, opponent, mine }: { side: MatchupContextSide; opponent: MatchupContextSide; mine: boolean }) {
  const leading = side.score !== null && opponent.score !== null && side.score > opponent.score;
  return (
    <div
      className="rounded-2xl bg-[#0f141b] px-1 py-2.5"
      style={{ border: `1px solid ${leading ? "rgba(57,255,20,.35)" : mine ? "rgba(255,122,26,.35)" : ELITE.line}` }}
    >
      <div
        className={`${ANTON} text-5xl leading-tight tracking-[2px] tabular-nums sm:text-6xl`}
        style={
          leading
            ? { color: ELITE.green, textShadow: "0 0 12px rgba(57,255,20,.7)" }
            : mine
              ? { color: ELITE.peach, textShadow: "0 0 12px rgba(255,122,26,.7)" }
              : undefined
        }
      >
        {side.score !== null ? side.score.toFixed(1) : "0.0"}
      </div>
      {side.projected_total !== null && (
        <div className="text-xs" style={{ color: ELITE.soft }}>
          Proj <LiveProjectionValue live={side.projected_total} pregame={side.pregame_projected_total} />
        </div>
      )}
    </div>
  );
}

function TouchdownList({
  teamName,
  touchdowns,
  color,
  align = "left",
}: {
  teamName: string;
  touchdowns: TeamTouchdown[];
  color: string;
  align?: "left" | "right";
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${align === "right" ? "items-end text-right" : "items-start text-left"}`}>
      <span className="text-xs" style={{ color: ELITE.soft }}>
        {teamName}
      </span>
      {touchdowns.length === 0 ? (
        <span style={{ color: ELITE.grey }}>No touchdowns yet</span>
      ) : (
        touchdowns.map((td) => (
          <span key={td.player_name} className={`flex items-center gap-2 font-semibold ${align === "right" ? "flex-row-reverse" : ""}`}>
            <i aria-hidden className="h-[21px] w-[18px] shrink-0" style={{ clipPath: HEX_CLIP, background: color }} />
            <span>
              {td.player_name}
              {td.touchdowns > 1 && <span style={{ color: ELITE.soft }}> ×{td.touchdowns}</span>}
            </span>
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
      <span className={`${ANTON} text-lg uppercase`}>{side.team_name}</span>
      <div className="flex flex-wrap gap-1.5 text-xs">
        {side.clutch_choke && <ClutchChokeBadge status={side.clutch_choke} />}
        {side.bench_crime && <BenchCrimeBadge crime={side.bench_crime} />}
      </div>
    </div>
  );
}

// The all-time series (option B, picked 2026-11-23): who leads in plain
// words, a bar split by each side's wins (and ties), and the latest
// meetings with the winner's initials, like the app's. It used to be W/L
// cells "from the left team's side". Orange is the left team, green the
// right, like the lineup rows.
const SMALL_WORDS = new Set(["the", "a", "an", "of", "is", "and", "&"]);

function teamInitials(name: string): string {
  const words = name.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w) && !SMALL_WORDS.has(w.toLowerCase()));
  if (words.length === 0) return name.slice(0, 2).toUpperCase();
  if (words.length === 1) return words[0].replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

const SHOWN_MEETINGS = 3;

function Series({ matchup }: { matchup: WeekMatchupContextItem }) {
  const h = matchup.head_to_head;
  const { home, away } = matchup;
  const total = h.wins_home + h.wins_away + h.ties;
  let homeTag = teamInitials(home.team_name);
  let awayTag = teamInitials(away.team_name);
  if (homeTag === awayTag) {
    homeTag = home.team_name.slice(0, 3).toUpperCase();
    awayTag = away.team_name.slice(0, 3).toUpperCase();
  }
  const record = `${Math.max(h.wins_home, h.wins_away)}–${Math.min(h.wins_home, h.wins_away)}${h.ties ? `–${h.ties}` : ""}`;
  const leader = h.wins_home > h.wins_away ? home : h.wins_away > h.wins_home ? away : null;
  const meetings = [...h.recent_meetings].reverse();
  const meeting = (g: (typeof meetings)[number], i: number) => {
    const color = g.tie ? ELITE.cream : g.home_won ? ELITE.orange : ELITE.green;
    const tint = g.tie ? "rgba(245,244,236,.05)" : g.home_won ? "rgba(255,122,26,.08)" : "rgba(57,255,20,.07)";
    const rim = g.tie ? "rgba(245,244,236,.18)" : g.home_won ? "rgba(255,122,26,.3)" : "rgba(57,255,20,.3)";
    return (
      <li key={i} className="flex items-center gap-2.5 rounded-[10px] border px-2.5 py-2" style={{ background: tint, borderColor: rim }}>
        <span className="w-14 text-xs" style={{ color: ELITE.soft }}>
          ’{String(g.season).slice(-2)} W{g.week}
        </span>
        <span className="flex-1 text-[13px] font-bold" style={{ color }}>
          {g.tie ? "Tie" : `${g.home_won ? homeTag : awayTag} won`}
        </span>
        <span className="text-xs tabular-nums" style={{ color: ELITE.soft }}>
          {Math.max(g.home_score, g.away_score).toFixed(1)}–{Math.min(g.home_score, g.away_score).toFixed(1)}
        </span>
      </li>
    );
  };
  return (
    <EliteCard tone="deep" className="flex flex-col gap-3.5 p-4">
      <span className="text-center text-[11px] font-extrabold tracking-[2px]" style={{ color: ELITE.soft }}>
        ALL-TIME SERIES{h.last_season !== null ? ` · LAST MET ${h.last_season} WK ${h.last_week}` : ""}
      </span>
      {total === 0 ? (
        <p className="text-center text-sm" style={{ color: ELITE.soft }}>
          First meeting between these two.
        </p>
      ) : (
        <>
          <p className={`${ANTON} text-center text-[26px] leading-tight uppercase`}>
            {leader ? (
              <>
                <span style={{ color: leader === home ? ELITE.orange : ELITE.green }}>{leader.team_name}</span> leads {record}
              </>
            ) : (
              `Series tied ${record}`
            )}
          </p>
          <div className="flex flex-col gap-1.5" aria-label={`${home.team_name} ${h.wins_home} wins, ${away.team_name} ${h.wins_away} wins${h.ties ? `, ${h.ties} ties` : ""}`}>
            <div className="flex justify-between gap-2 text-xs font-bold">
              <span style={{ color: ELITE.orange }}>
                {homeTag} · {h.wins_home} {h.wins_home === 1 ? "win" : "wins"}
              </span>
              {h.ties > 0 && <span style={{ color: ELITE.soft }}>{h.ties} {h.ties === 1 ? "tie" : "ties"}</span>}
              <span style={{ color: ELITE.green }}>
                {h.wins_away} {h.wins_away === 1 ? "win" : "wins"} · {awayTag}
              </span>
            </div>
            <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-white/[0.08]">
              {h.wins_home > 0 && <div style={{ flex: h.wins_home, background: ELITE.orange }} />}
              {h.ties > 0 && <div style={{ flex: h.ties, background: "#5a5f66" }} />}
              {h.wins_away > 0 && <div style={{ flex: h.wins_away, background: ELITE.green }} />}
            </div>
            <div className="flex justify-between gap-2 text-[11px]" style={{ color: ELITE.soft }}>
              <span>{home.team_name}</span>
              <span className="text-right">{away.team_name}</span>
            </div>
          </div>
          {meetings.length > 0 && (
            <ol className="flex flex-col gap-1.5">
              {meetings.slice(0, SHOWN_MEETINGS).map(meeting)}
              {meetings.length > SHOWN_MEETINGS && (
                <li>
                  <details className="group">
                    <summary className="cursor-pointer list-none py-1.5 text-center text-xs" style={{ color: ELITE.soft }}>
                      <span className="group-open:hidden">Show {meetings.length - SHOWN_MEETINGS} more</span>
                      <span className="hidden group-open:inline">Show fewer</span>
                    </summary>
                    <ol className="flex flex-col gap-1.5">{meetings.slice(SHOWN_MEETINGS).map(meeting)}</ol>
                  </details>
                </li>
              )}
            </ol>
          )}
        </>
      )}
    </EliteCard>
  );
}
