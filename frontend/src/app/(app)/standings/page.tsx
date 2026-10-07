import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import {
  awardsHrefFor,
  getActiveLeagueName,
  getCurrentWeek,
  getLatestPowerRankings,
  getMe,
  getMyPreferences,
  getPlayoffOdds,
  getStandings,
  getWeekMatchupContext,
  listSeasons,
  resolveWeek,
  safeLatestSeason,
  type StandingsRow,
} from "@/lib/api";
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { BracketExperience } from "@/components/bracket/BracketExperience";
import { SeasonTabs } from "@/components/nav/SeasonTabs";
import { SignInCard } from "@/components/SignInCard";
import { StandingsViewTabs } from "@/components/standings/StandingsViewTabs";
import { WeekScoreboardBrowser } from "@/components/standings/WeekScoreboardBrowser";
import { TeamRankBadge } from "@/components/TeamRankBadge";
import { MovementBadge } from "@/components/MovementBadge";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";

export const metadata: Metadata = { title: "Standings — The Weekend" };

export default async function StandingsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; view?: string; mode?: string; w?: string }>;
}) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  // listSeasons is public, so it runs alongside the auth check instead
  // of after it — every await below is a real round trip to the
  // backend, and they used to all run one after another (9 deep).
  const [me, { seasons }, { season: seasonParam, view, mode, w }] = await Promise.all([
    getMe(sessionCookie),
    listSeasons(),
    searchParams,
  ]);
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

  const latestSeason = safeLatestSeason(seasons);
  const season = seasonParam ? Number(seasonParam) : latestSeason;

  // Everything below only depends on `season`, so it all runs at once —
  // the few fetches that depend on another fetch's answer are chained
  // inside their own async block rather than holding up the rest.
  const [
    [{ standings, playoff_team_count: playoffTeamCount }, myPreferences, activeLeagueName],
    { rankings: powerRankings },
    { currentWeek, currentWeekMatchups },
    playoffOdds,
  ] = await Promise.all([
    Promise.all([
      season !== null ? getStandings(season, sessionCookie) : Promise.resolve({ standings: [], playoff_team_count: null }),
      getMyPreferences(sessionCookie),
      getActiveLeagueName(sessionCookie),
    ]),
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
    season !== null ? getLatestPowerRankings(season, sessionCookie) : Promise.resolve({ rankings: [] }),
    // Scoreboard tab (real ESPN League > Scoreboard, reference video
    // 2026-09-15: prev/next arrows through every week's matchups, right
    // alongside Standings and Playoffs as sibling tabs of the same
    // screen) — replaces the old standalone /seasons/[season]/weeks/
    // [week] route entirely; this fetches only the CURRENT week's
    // matchups up front (WeekScoreboardBrowser's own arrows page through
    // every other week client-side from here, see that component).
    (async () => {
      if (season === null) return { currentWeek: null, currentWeekMatchups: [] };
      const week = resolveWeek((await getCurrentWeek(season)).current_week);
      if (week === null) return { currentWeek: null, currentWeekMatchups: [] };
      const { matchups } = await getWeekMatchupContext(season, week, sessionCookie);
      return { currentWeek: week, currentWeekMatchups: matchups };
    })(),
    // Playoff chances (2026-10) — this season only, and never allowed to
    // break the page.
    season !== null && season === latestSeason
      ? getPlayoffOdds(season, sessionCookie)
          .then((r) => r.odds)
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  const playoffPctByTeam = new Map((playoffOdds?.teams ?? []).map((t) => [t.team_id, t.playoff_pct]));
  const betaLayout = Boolean(myPreferences?.beta_layout);
  const powerRankByTeam = new Map(powerRankings.map((r) => [r.team_id, r.power_rank]));
  const movementByTeam = new Map(powerRankings.map((r) => [r.team_id, r.movement]));

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
  // The bottom four play in the toilet bowl — a line above them, same
  // style as the playoff line. Needs at least one team above the line
  // that isn't also in the bottom four.
  const toiletBowlCount = 4;
  const showToiletBowlLine = !isFinal && standings.length > toiletBowlCount;


  return (
    <div className="flex flex-col gap-4">
      <LeagueSubNav active="standings" awardsHref={awardsHrefFor(latestSeason)} activeLeagueName={activeLeagueName} />
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold">Standings</h1>
        <SeasonTabs seasons={seasons} activeSeason={season} hrefFor={(s) => `/standings?season=${s}`} />
      </div>

      <StandingsViewTabs
        standings={
          <div className="flex flex-col gap-4">
            <p className="text-xs text-black/50 dark:text-white/50">
              {isFinal ? "Final standings." : "Season in progress."}
              {(me.league_format?.matchup_type === "points" || me.league_format?.league_type === "guillotine") &&
                " Ranked by total points."}
              {showPlayoffLine && ` Top ${playoffTeamCount} make the playoffs.`}
              {showToiletBowlLine && ` The bottom ${toiletBowlCount} risk the Toilet Bowl.`}
              {playoffOdds && " Playoff % comes from 10,000 simulated seasons."}
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
                <span className="w-16 shrink-0 text-right">PPG</span>
                <span className="w-16 shrink-0 text-right">PF</span>
                <span className="w-16 shrink-0 text-right">PA</span>
                {playoffOdds && <span className="w-20 shrink-0 text-right">Playoff %</span>}
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
                      playoffPct={playoffOdds ? playoffPctByTeam.get(row.team_id) : undefined}
                    />
                    {showPlayoffLine && i + 1 === playoffTeamCount && <PlayoffLine count={playoffTeamCount!} />}
                    {showToiletBowlLine && i + 1 === standings.length - toiletBowlCount && (
                      <ToiletBowlLine count={toiletBowlCount} />
                    )}
                  </Fragment>
                ))}
              </ul>
            </div>
          </div>
        }
        scoreboard={
          season !== null && currentWeek !== null ? (
            <WeekScoreboardBrowser season={season} initialWeek={currentWeek} initialMatchups={currentWeekMatchups} />
          ) : (
            <p className="text-sm text-black/50 dark:text-white/50">No schedule yet.</p>
          )
        }
        // The whole Bracket experience, right in the tab (2026-10): the
        // bracket, Your Path and the What-If Lab. ?view=playoffs (or a
        // shared what-if's ?mode=/?w=) opens straight onto it.
        playoffs={season !== null ? <BracketExperience season={season} myOwnerId={me.owner_id} initialMode={mode} initialW={w} /> : null}
        initialTab={view === "playoffs" || mode || w ? "Playoffs" : view === "scoreboard" ? "Scoreboard" : "Standings"}
      />
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

// Mirror of PlayoffLine for the other end of the table — the bottom
// four's toilet bowl. Rendered right after the fifth-from-last row.
function ToiletBowlLine({ count }: { count: number }) {
  return (
    <li aria-hidden className="relative py-0">
      <div className="absolute inset-x-0 top-1/2 border-t-2 border-dashed border-amber-700 dark:border-amber-600" />
      <span className="relative mx-auto block w-fit -translate-y-1/2 rounded-full bg-amber-700 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase dark:bg-amber-600">
        🚽 Toilet bowl — bottom {count}
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
  playoffPct,
}: {
  row: StandingsRow;
  rank: number;
  teamCount: number;
  powerRank: number | undefined;
  // Settings > Labs > "Try the new look" — undefined (not just null)
  // when the beta layout is off, so the column never renders at all
  // for the legacy page rather than showing an empty dash everywhere.
  movement?: number | null;
  // Simulated playoff chance (undefined when there are no odds to show).
  playoffPct?: number;
}) {
  const games = row.wins + row.losses + row.ties;
  const ppg = games ? Number(row.points_for) / games : null;
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
        <span className="flex w-6 shrink-0 flex-col items-start tabular-nums text-black/50 dark:text-white/50">
          {rank}
          {movement !== undefined && (
            <span className="text-[10px] sm:hidden">
              <MovementBadge movement={movement} />
            </span>
          )}
        </span>
        <div className="min-w-0">
          <Link href={`/teams/${row.team_id}`} className="font-medium hover:underline">
            {row.team_name}
          </Link>
          <TeamRankBadge rank={powerRank} />
          {row.eliminated_week != null && (
            <span className="ml-2 inline-flex items-center rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">
              🪓 Cut Wk {row.eliminated_week}
            </span>
          )}
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
          <div className="min-w-0 wrap-break-word text-xs text-black/50 dark:text-white/50">{row.owner_name}</div>
        </div>
      </div>
      {/* Phones: one row of labelled cells (2026-10 — the old inline
          numbers wrapped into an unlabelled jumble). sm+: the table's
          columns, labelled by the header row. */}
      <div
        className={`grid gap-1 pl-8 text-sm sm:flex sm:gap-0 sm:pl-0 ${playoffPct !== undefined ? "grid-cols-5" : "grid-cols-4"}`}
      >
        {movement !== undefined && (
          <span className="hidden text-xs tabular-nums sm:block sm:w-14 sm:shrink-0 sm:text-right">
            <MovementBadge movement={movement} />
          </span>
        )}
        <StatCell label="W-L-T" className="font-medium sm:w-20">
          {row.wins}-{row.losses}-{row.ties}
        </StatCell>
        <StatCell label="PPG" className="text-black/60 sm:w-16 dark:text-white/60">
          {ppg !== null ? ppg.toFixed(1) : "—"}
        </StatCell>
        <StatCell label="PF" className="text-black/60 sm:w-16 dark:text-white/60">
          {Number(row.points_for).toFixed(1)}
        </StatCell>
        <StatCell label="PA" className="text-black/60 sm:w-16 dark:text-white/60">
          {Number(row.points_against).toFixed(1)}
        </StatCell>
        {playoffPct !== undefined && (
          <StatCell
            label="PLAYOFFS"
            className="font-semibold sm:w-20"
            style={{ color: playoffPct >= 75 ? "#16a34a" : playoffPct <= 10 ? "#b45309" : undefined }}
            title="Chance of making the playoffs, from simulating the rest of the season"
          >
            {playoffPct < 1 && playoffPct > 0 ? "<1" : Math.round(playoffPct)}%
          </StatCell>
        )}
      </div>
    </li>
  );
}

/** One standings number: labelled on phones, a plain right-aligned
 *  table cell from sm up (the header row labels it there). */
function StatCell({
  label,
  className,
  style,
  title,
  children,
}: {
  label: string;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={`flex min-w-0 flex-col tabular-nums sm:block sm:shrink-0 sm:text-right ${className ?? ""}`} style={style} title={title}>
      <span className="text-[10px] font-normal tracking-wide text-black/45 sm:hidden dark:text-white/45">{label}</span>
      <span className="whitespace-nowrap">{children}</span>
    </span>
  );
}

