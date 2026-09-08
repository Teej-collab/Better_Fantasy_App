import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import {
  awardsHrefFor,
  getLatestPowerRankingsWeek,
  getMe,
  getMyPreferences,
  getPlayoffBracket,
  getStandings,
  getWeekPowerRankings,
  listSeasons,
  safeLatestSeason,
  type StandingsRow,
} from "@/lib/api";
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { PlayoffBracket } from "@/components/PlayoffBracket";
import { SeasonTabs } from "@/components/nav/SeasonTabs";
import { SignInCard } from "@/components/SignInCard";
import { TeamRankBadge } from "@/components/TeamRankBadge";
import { MovementBadge } from "@/components/MovementBadge";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";

export const metadata: Metadata = { title: "Standings — Weekend League" };

export default async function StandingsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  const me = await getMe(sessionCookie);
  if (!me) {
    return (
      <div className="flex justify-center py-6">
        <SignInCard />
      </div>
    );
  }
  if (me.active_league_id === null) {
    return <NeedsLeagueCard />;
  }

  const { seasons } = await listSeasons();
  const latestSeason = safeLatestSeason(seasons);
  const { season: seasonParam } = await searchParams;
  const season = seasonParam ? Number(seasonParam) : latestSeason;

  const [{ standings, playoff_team_count: playoffTeamCount }, myPreferences] = await Promise.all([
    season !== null ? getStandings(season, sessionCookie) : Promise.resolve({ standings: [], playoff_team_count: null }),
    getMyPreferences(sessionCookie),
  ]);
  const betaLayout = Boolean(myPreferences?.beta_layout);

  // Power-rank badges next to each team name — a separate fetch/merge
  // by team_id rather than joining onto get_standings itself, since
  // standings' own ordering (win/loss record, or final_rank once a
  // season's done) is a different concept from the weekly power-rank
  // composite (app/domain/weekly_team_stats.py's compute_power_ranks).
  // Settings > Labs > "Try the new look" also reuses this same fetch's
  // `movement` field per row — Documentation/UX/00_UX_Audit.md's P2
  // finding was that Standings doesn't convey momentum despite
  // MovementBadge already existing and being wired into Power Rankings
  // — this is a pure reuse, not a new data source.
  let powerRankByTeam = new Map<number, number>();
  let movementByTeam = new Map<number, number | null>();
  if (season !== null) {
    const { week: latestPowerWeek } = await getLatestPowerRankingsWeek(season, sessionCookie);
    if (latestPowerWeek !== null) {
      const { rankings } = await getWeekPowerRankings(season, latestPowerWeek, sessionCookie);
      powerRankByTeam = new Map(rankings.map((r) => [r.team_id, r.power_rank]));
      movementByTeam = new Map(rankings.map((r) => [r.team_id, r.movement]));
    }
  }
  // Already ordered by final_rank (ESPN's real final-season rank, full
  // playoff bracket) when the season's complete, falling back to
  // regular-season record when it's not — see app/queries/league.py.
  const isFinal = standings.length > 0 && standings[0].final_rank !== null;
  // Only meaningful for a season still in progress — a finished
  // season's rows are already the real final playoff-accounted order,
  // so a projected line on top of that would be redundant at best,
  // wrong at worst (see app/queries/league.py's get_playoff_team_count
  // — 2026-08-31 audit: "no visible playoff-picture indicator").
  const showPlayoffLine =
    !isFinal && playoffTeamCount !== null && playoffTeamCount > 0 && playoffTeamCount < standings.length;

  // The real in-app bracket (backend/app/domain/playoffs.py) — empty
  // nodes before a commissioner has generated one for this season,
  // in which case PlayoffBracket itself renders nothing.
  const { nodes: bracketNodes } =
    season !== null ? await getPlayoffBracket(season, sessionCookie) : { nodes: [] };

  return (
    <div className="flex flex-col gap-4">
      <LeagueSubNav active="standings" awardsHref={awardsHrefFor(latestSeason)} />
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold">Standings</h1>
        <SeasonTabs seasons={seasons} activeSeason={season} hrefFor={(s) => `/standings?season=${s}`} />
      </div>

      <p className="text-xs text-black/50 dark:text-white/50">
        {isFinal ? "Final standings (ESPN)." : "Regular season record — season in progress."}
        {showPlayoffLine &&
          ` The line below the top ${playoffTeamCount} marks last season's real playoff cutoff — a preview, not a guaranteed clinch.`}
      </p>

      <div
        className={
          betaLayout
            ? "wl-card flex flex-col rounded-lg px-4"
            : "neon-panel flex flex-col rounded-lg bg-black/[0.015] px-4 dark:bg-white/[0.03]"
        }
        style={betaLayout ? undefined : panelGlowStyle(SECTION_COLORS.standings)}
      >
        {/* Column headers only from sm up — on mobile each row labels itself */}
        <div className="hidden border-b border-black/10 px-1 pb-2 text-xs text-black/50 sm:flex dark:border-white/10 dark:text-white/50">
          <span className="w-6 shrink-0" />
          <span className="flex-1">Team</span>
          {betaLayout && <span className="w-14 shrink-0 text-right">Trend</span>}
          <span className="w-20 shrink-0 text-right">W-L-T</span>
          <span className="w-16 shrink-0 text-right">PF</span>
          <span className="w-16 shrink-0 text-right">PA</span>
        </div>

        <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
          {standings.map((row, i) => (
            <Fragment key={row.team_id}>
              <StandingsListRow
                row={row}
                rank={i + 1}
                teamCount={standings.length}
                powerRank={powerRankByTeam.get(row.team_id)}
                movement={betaLayout ? movementByTeam.get(row.team_id) : undefined}
              />
              {showPlayoffLine && i + 1 === playoffTeamCount && <PlayoffLine count={playoffTeamCount!} />}
            </Fragment>
          ))}
        </ul>
      </div>

      <PlayoffBracket nodes={bracketNodes} />
    </div>
  );
}

// A projected playoff cutoff line, not a guaranteed clinch — this app
// has no real tiebreaker-aware "magic number" clinch calculator (that
// needs each team's remaining schedule and a real combinatorial
// scenario check, a much bigger feature than a standings-page divider
// — see get_playoff_team_count's own docstring for why this uses last
// season's real bracket size instead). Still real, honest signal: "no
// visible playoff-picture indicator at all" was the actual gap named
// in the 2026-08-31 audit, and a line grounded in this league's own
// real history beats either nothing or an invented number.
function PlayoffLine({ count }: { count: number }) {
  return (
    <li aria-hidden className="relative py-0">
      <div className="absolute inset-x-0 top-1/2 border-t-2 border-dashed" style={{ borderColor: "var(--user-accent, var(--wl-accent))" }} />
      <span
        className="relative mx-auto block w-fit -translate-y-1/2 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase"
        style={{
          background: "var(--user-accent, var(--wl-accent))",
          color: "#06110a",
        }}
      >
        Playoff line — top {count}
      </span>
    </li>
  );
}

function StandingsListRow({
  row,
  rank,
  teamCount,
  powerRank,
  movement,
}: {
  row: StandingsRow;
  rank: number;
  teamCount: number;
  powerRank: number | undefined;
  // Settings > Labs > "Try the new look" — undefined (not just null)
  // when the beta layout is off, so the column never renders at all
  // for the legacy page rather than showing an empty dash everywhere.
  movement?: number | null;
}) {
  const isChampion = row.final_rank === 1;
  // Symmetric with the champion above — only lit up once a season is
  // actually final (final_rank populated for every row), same as
  // isChampion; last place in ESPN's own complete final ranking.
  const isLastPlace = row.final_rank !== null && row.final_rank === teamCount;
  return (
    <li
      className={
        "flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:gap-0" +
        (isChampion ? " bg-amber-50 dark:bg-amber-400/10" : isLastPlace ? " bg-[#f2e8dc] dark:bg-[#8b5a2b]/10" : "")
      }
    >
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="w-6 shrink-0 tabular-nums text-black/50 dark:text-white/50">{rank}</span>
        <div className="min-w-0">
          <Link href={`/teams/${row.team_id}`} className="font-medium hover:underline">
            {row.team_name}
          </Link>
          <TeamRankBadge rank={powerRank} />
          {isChampion && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-200 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-400/20 dark:text-amber-300">
              🏆 Champion
            </span>
          )}
          {isLastPlace && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-[#d9b98a] px-2 py-0.5 text-xs font-medium text-[#5c3a1e] dark:bg-[#8b5a2b]/30 dark:text-[#d9b98a]">
              💩 League Loser
            </span>
          )}
          <div className="truncate text-xs text-black/50 dark:text-white/50">{row.owner_name}</div>
        </div>
      </div>
      <div className="flex gap-4 pl-8 text-sm sm:gap-0 sm:pl-0">
        {movement !== undefined && (
          <span className="text-xs tabular-nums sm:w-14 sm:shrink-0 sm:text-right">
            <MovementBadge movement={movement} />
          </span>
        )}
        <span className="tabular-nums font-medium sm:w-20 sm:shrink-0 sm:text-right">
          {row.wins}-{row.losses}-{row.ties}
        </span>
        <span className="tabular-nums text-black/60 sm:w-16 sm:shrink-0 sm:text-right dark:text-white/60">
          {Number(row.points_for).toFixed(1)}
        </span>
        <span className="tabular-nums text-black/60 sm:w-16 sm:shrink-0 sm:text-right dark:text-white/60">
          {Number(row.points_against).toFixed(1)}
        </span>
      </div>
    </li>
  );
}
