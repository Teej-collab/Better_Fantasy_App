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
import { SignInCard } from "@/components/SignInCard";
import { StandingsViewTabs } from "@/components/standings/StandingsViewTabs";
import { WeekScoreboardBrowser } from "@/components/standings/WeekScoreboardBrowser";
import { TeamRankBadge } from "@/components/TeamRankBadge";
import { MovementBadge } from "@/components/MovementBadge";
import { ANTON, CutLine, ELITE, EliteCard, EliteSeasonChips, EliteTitle, Hex, StatTile } from "@/components/elite/Elite";

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
    listSeasons(sessionCookie),
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
  const myTeamId = powerRankings.find((r) => r.owner_id === me.owner_id)?.team_id ?? null;

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
      <EliteTitle kicker={season !== null ? `The ${season}` : "The"} title="Standings" />
      <EliteSeasonChips seasons={seasons} activeSeason={season} hrefFor={(s) => `/standings?season=${s}`} />

      <StandingsViewTabs
        standings={
          <div className="flex flex-col gap-4">
            {(showPlayoffLine || showToiletBowlLine || playoffOdds) && (
              <div className="flex gap-2">
                {showPlayoffLine && <StatTile value={`TOP ${playoffTeamCount}`} caption="make the playoffs" color={ELITE.green} />}
                {showToiletBowlLine && <StatTile value={`BOTTOM ${toiletBowlCount}`} caption="risk the Toilet Bowl" color={ELITE.peach} />}
                {playoffOdds && <StatTile value="10K" caption="simulated seasons" />}
              </div>
            )}
            {(isFinal || me.league_format?.matchup_type === "points" || me.league_format?.league_type === "guillotine") && (
              <p className="text-xs text-black/50 dark:text-white/50">
                {isFinal && "Final standings."}
                {(me.league_format?.matchup_type === "points" || me.league_format?.league_type === "guillotine") && " Ranked by total points."}
              </p>
            )}

            <EliteCard className="overflow-hidden">
              <ul className="flex flex-col">
                {standings.map((row, i) => (
                  <Fragment key={row.team_id}>
                    <StandingsListRow
                      row={row}
                      rank={i + 1}
                      teamCount={standings.length}
                      powerRank={powerRankByTeam.get(row.team_id)}
                      movement={betaLayout ? movementByTeam.get(row.team_id) : undefined}
                      playoffPct={playoffOdds ? playoffPctByTeam.get(row.team_id) : undefined}
                      mine={row.team_id === myTeamId}
                      zone={
                        showPlayoffLine && i + 1 <= playoffTeamCount!
                          ? "playoffs"
                          : showToiletBowlLine && i + 1 > standings.length - toiletBowlCount
                            ? "toilet"
                            : null
                      }
                    />
                    {showPlayoffLine && i + 1 === playoffTeamCount && <CutLine label="PLAYOFF LINE" color={ELITE.green} />}
                    {showToiletBowlLine && i + 1 === standings.length - toiletBowlCount && (
                      <CutLine label="TOILET BOWL ZONE" color={ELITE.orange} dashed />
                    )}
                  </Fragment>
                ))}
              </ul>
            </EliteCard>
          </div>
        }
        scoreboard={
          season !== null && currentWeek !== null ? (
            <WeekScoreboardBrowser season={season} initialWeek={currentWeek} initialMatchups={currentWeekMatchups} myOwnerId={me.owner_id} />
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

// The playoff line is a projected cutoff, not a guaranteed clinch — this
// app has no tiebreaker-aware "magic number" calculator; see
// get_playoff_team_count for why it uses last season's real bracket
// size. Drawn by CutLine (components/elite/Elite.tsx), elite pass
// 2026-10-31: glowing green, and the toilet-bowl cut dashed orange.

function StandingsListRow({
  row,
  rank,
  teamCount,
  powerRank,
  movement,
  playoffPct,
  mine,
  zone,
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
  mine: boolean;
  zone: "playoffs" | "toilet" | null;
}) {
  const games = row.wins + row.losses + row.ties;
  const ppg = games ? Number(row.points_for) / games : null;
  const isChampion = row.final_rank === 1;
  // Symmetric with the champion above — only lit up once a season is
  // actually final (final_rank populated for every row), same as
  // isChampion; last place in ESPN's own complete final ranking.
  const isLastPlace = row.final_rank !== null && row.final_rank === teamCount;
  const seedColor = mine
    ? ELITE.orange
    : isChampion
      ? "#fcd34d"
      : zone === "playoffs"
        ? ELITE.green
        : zone === "toilet"
          ? "rgba(255,122,26,.7)"
          : ELITE.grey;
  const pctColor = playoffPct === undefined ? ELITE.cream : playoffPct >= 75 ? ELITE.green : playoffPct <= 10 ? ELITE.peach : ELITE.cream;
  const meterColor = zone === "playoffs" ? ELITE.green : zone === "toilet" ? ELITE.orange : "rgba(245,244,236,.6)";
  return (
    <li
      className="flex items-center gap-3 border-t border-white/[0.06] px-3 py-3 first:border-t-0"
      style={{
        background: mine
          ? "rgba(255,122,26,.10)"
          : isChampion
            ? "rgba(251,191,36,.1)"
            : isLastPlace
              ? "rgba(139,90,43,.12)"
              : zone === "toilet"
                ? "rgba(255,122,26,.05)"
                : undefined,
      }}
    >
      <span className="flex shrink-0 flex-col items-center gap-0.5">
        <Hex size={38} color={seedColor} rim={2}>
          <span className={`${ANTON} text-lg`} style={{ color: mine || zone === "playoffs" ? seedColor : ELITE.cream }}>
            {rank}
          </span>
        </Hex>
        {movement !== undefined && (
          <span className="text-[10px]">
            <MovementBadge movement={movement} />
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <Link href={`/teams/${row.team_id}`} className="font-bold hover:underline">
          {row.team_name}
        </Link>
        <TeamRankBadge rank={powerRank} />
        {row.eliminated_week != null && (
          <span className="ml-2 inline-flex items-center rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-400">
            🪓 Cut Wk {row.eliminated_week}
          </span>
        )}
        {isChampion && (
          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-400/20 px-2 py-0.5 text-xs font-medium text-amber-300">
            🏆 Champion
          </span>
        )}
        {isLastPlace && (
          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-[#8b5a2b]/30 px-2 py-0.5 text-xs font-medium text-[#d9b98a]">
            💩 League Loser
          </span>
        )}
        <div className="min-w-0 wrap-break-word text-xs tabular-nums" style={{ color: ELITE.soft }}>
          {row.owner_name} · {ppg !== null ? ppg.toFixed(1) : "—"} PPG · PF {Number(row.points_for).toFixed(1)} · PA {Number(row.points_against).toFixed(1)}
        </div>
      </div>
      <span className={`${ANTON} shrink-0 text-xl tabular-nums`}>
        {row.wins}-{row.losses}
        {row.ties > 0 ? `-${row.ties}` : ""}
      </span>
      {playoffPct !== undefined && (
        <span
          className="flex w-16 shrink-0 flex-col items-end gap-1"
          title="Chance of making the playoffs, from simulating the rest of the season"
          aria-label={`${Math.round(playoffPct)} percent playoff chance`}
        >
          <b className="text-xs font-extrabold" style={{ color: pctColor }}>
            {playoffPct < 1 && playoffPct > 0 ? "<1" : Math.round(playoffPct)}%
          </b>
          <span className="h-[5px] w-16 overflow-hidden rounded-full bg-white/[0.12]">
            <span
              className="block h-full rounded-full"
              style={{ width: `${Math.max(2, Math.min(100, playoffPct))}%`, background: meterColor, boxShadow: zone === "playoffs" ? `0 0 6px ${ELITE.green}` : undefined }}
            />
          </span>
        </span>
      )}
    </li>
  );
}
