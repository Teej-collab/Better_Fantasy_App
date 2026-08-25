import Link from "next/link";
import { listSeasons, listTeams } from "@/lib/api";
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";

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
      <LeagueSubNav active="overview" awardsHref={`/seasons/${latestSeason}/awards`} />
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold">League</h1>
        <div className="flex gap-x-3 text-sm">
          {[...seasons].reverse().map((s) => (
            <Link
              key={s}
              href={`/league?season=${s}`}
              className={
                s === season
                  ? "font-semibold underline"
                  : "text-black/60 hover:underline dark:text-white/60"
              }
            >
              {s}
            </Link>
          ))}
        </div>
      </div>

      <div
        className="neon-panel flex flex-col rounded-lg bg-black/[0.015] px-4 dark:bg-white/[0.03]"
        style={panelGlowStyle(SECTION_COLORS.league)}
      >
        <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
          {teams.map((team) => (
            <li key={team.team_id} className="flex items-center justify-between gap-3 py-3">
              <Link href={`/teams/${team.team_id}`} className="min-w-0 truncate hover:underline">
                {team.team_name}
              </Link>
              <span className="shrink-0 text-sm text-black/60 dark:text-white/60">{team.owner_name}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
