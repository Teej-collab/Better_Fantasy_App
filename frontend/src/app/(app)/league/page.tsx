import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { awardsHrefFor, getMe, listSeasons, listTeamsServer, safeLatestSeason } from "@/lib/api";
import { LeagueSubNav } from "@/components/nav/LeagueSubNav";
import { NeedsLeagueCard } from "@/components/NeedsLeagueCard";
import { SeasonTabs } from "@/components/nav/SeasonTabs";
import { SignInCard } from "@/components/SignInCard";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";

export const metadata: Metadata = { title: "League — Weekend League" };

export default async function LeaguePage({
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

  const { teams } = season !== null ? await listTeamsServer(sessionCookie, season) : { teams: [] };

  return (
    <div className="flex flex-col gap-4">
      <LeagueSubNav active="league" awardsHref={awardsHrefFor(latestSeason)} />
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold">League</h1>
        <SeasonTabs seasons={seasons} activeSeason={season} hrefFor={(s) => `/league?season=${s}`} />
      </div>

      {me.is_commissioner && (
        <Link href="/commissioner" className="w-fit text-sm text-black/60 hover:underline dark:text-white/60">
          ⚙ Commissioner Tools
        </Link>
      )}

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
