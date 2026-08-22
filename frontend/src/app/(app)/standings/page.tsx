import { getStandings, listSeasons, type StandingsRow } from "@/lib/api";
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";

export default async function StandingsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { seasons } = await listSeasons();
  const latestSeason = Math.max(...seasons);
  const { season: seasonParam } = await searchParams;
  const season = seasonParam ? Number(seasonParam) : latestSeason;

  const { standings } = await getStandings(season);
  // Already ordered by final_rank (ESPN's real final-season rank, full
  // playoff bracket) when the season's complete, falling back to
  // regular-season record when it's not — see app/queries/league.py.
  const isFinal = standings.length > 0 && standings[0].final_rank !== null;

  return (
    <div className="flex flex-col gap-4">
      <LeagueSubNav active="standings" awardsHref={`/seasons/${latestSeason}/awards`} />
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold">Standings</h1>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {[...seasons].reverse().map((s) => (
            <a
              key={s}
              href={`/standings?season=${s}`}
              className={
                s === season
                  ? "font-semibold underline"
                  : "text-black/60 hover:underline dark:text-white/60"
              }
            >
              {s}
            </a>
          ))}
        </div>
      </div>

      <p className="text-xs text-black/50 dark:text-white/50">
        {isFinal ? "Final standings (ESPN)." : "Regular season record — season in progress."}
      </p>

      {/* Column headers only from sm up — on mobile each row labels itself */}
      <div className="hidden border-b border-black/10 px-1 pb-2 text-xs text-black/50 sm:flex dark:border-white/10 dark:text-white/50">
        <span className="w-6 shrink-0" />
        <span className="flex-1">Team</span>
        <span className="w-20 shrink-0 text-right">W-L-T</span>
        <span className="w-16 shrink-0 text-right">PF</span>
        <span className="w-16 shrink-0 text-right">PA</span>
      </div>

      <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
        {standings.map((row, i) => (
          <StandingsListRow key={row.team_id} row={row} rank={i + 1} />
        ))}
      </ul>
    </div>
  );
}

function StandingsListRow({ row, rank }: { row: StandingsRow; rank: number }) {
  const isChampion = row.final_rank === 1;
  return (
    <li
      className={
        "flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:gap-0" +
        (isChampion ? " bg-amber-50 dark:bg-amber-400/10" : "")
      }
    >
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="w-6 shrink-0 tabular-nums text-black/40 dark:text-white/40">{rank}</span>
        <div className="min-w-0">
          <a href={`/teams/${row.team_id}`} className="font-medium hover:underline">
            {row.team_name}
          </a>
          {isChampion && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-200 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-400/20 dark:text-amber-300">
              🏆 Champion
            </span>
          )}
          <div className="truncate text-xs text-black/50 dark:text-white/50">{row.owner_name}</div>
        </div>
      </div>
      <div className="flex gap-4 pl-8 text-sm sm:gap-0 sm:pl-0">
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
