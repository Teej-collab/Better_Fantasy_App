import { listSeasons, listTeams } from "@/lib/api";

export default async function LeaguePage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { seasons } = await listSeasons();
  const latestSeason = Math.max(...seasons);
  const { season: seasonParam } = await searchParams;
  const season = seasonParam ? Number(seasonParam) : latestSeason;

  const { teams } = await listTeams(season);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">League</h1>
        <div className="flex gap-2 text-sm">
          {[...seasons].reverse().map((s) => (
            <a
              key={s}
              href={`/league?season=${s}`}
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

      <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
        {teams.map((team) => (
          <li key={team.team_id} className="flex items-center justify-between py-3">
            <a href={`/teams/${team.team_id}`} className="hover:underline">
              {team.team_name}
            </a>
            <span className="text-sm text-black/60 dark:text-white/60">{team.owner_name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
