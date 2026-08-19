import { getStandings, listSeasons } from "@/lib/api";

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Standings</h1>
        <div className="flex gap-2 text-sm">
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

      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left dark:border-white/10">
              <th className="py-2 pr-2">#</th>
              <th className="py-2 pr-2">Team</th>
              <th className="py-2 pr-2">Owner</th>
              <th className="py-2 pr-2 text-right">W-L-T</th>
              <th className="py-2 pr-2 text-right">PF</th>
              <th className="py-2 text-right">PA</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row, i) => (
              <tr key={row.team_id} className="border-b border-black/5 dark:border-white/5">
                <td className="py-2 pr-2 text-black/50 dark:text-white/50">{i + 1}</td>
                <td className="py-2 pr-2">
                  <a href={`/teams/${row.team_id}`} className="hover:underline">
                    {row.team_name}
                  </a>
                </td>
                <td className="py-2 pr-2 text-black/70 dark:text-white/70">{row.owner_name}</td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  {row.wins}-{row.losses}-{row.ties}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">{Number(row.points_for).toFixed(1)}</td>
                <td className="py-2 text-right tabular-nums">{Number(row.points_against).toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
