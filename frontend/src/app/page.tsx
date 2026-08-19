import { getStandings, listSeasons } from "@/lib/api";

export default async function DashboardPage() {
  const { seasons } = await listSeasons();
  const latestSeason = Math.max(...seasons);
  const { standings } = await getStandings(latestSeason);
  const top3 = standings.slice(0, 3);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <section className="rounded-lg border border-black/10 p-4 dark:border-white/10">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="font-medium">{latestSeason} Standings — Top 3</h2>
          <a href={`/standings?season=${latestSeason}`} className="text-sm text-black/60 hover:underline dark:text-white/60">
            View full standings
          </a>
        </div>
        <ol className="flex flex-col gap-2">
          {top3.map((row, i) => (
            <li key={row.team_id} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">
                <span className="mr-2 text-black/40 dark:text-white/40">{i + 1}.</span>
                {row.team_name}
                <span className="ml-2 text-black/50 dark:text-white/50">({row.owner_name})</span>
              </span>
              <span className="shrink-0 tabular-nums text-black/70 dark:text-white/70">
                {row.wins}-{row.losses}
                {row.ties > 0 ? `-${row.ties}` : ""}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-lg border border-black/10 p-4 dark:border-white/10">
        <h2 className="mb-3 font-medium">Seasons</h2>
        <ul className="flex flex-wrap gap-2">
          {[...seasons].reverse().map((season) => (
            <li key={season}>
              <a
                href={`/standings?season=${season}`}
                className="rounded-full border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
              >
                {season}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
